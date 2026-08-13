// Just enough of D1 for the Worker's model-backed endpoints: user lookup with
// self-provisioning, and the usage_log the hourly rate limits count. Shared by
// tests/ask.test.mjs and tests/translate.test.mjs so both agree on the schema
// they are pretending to be.

export function fakeDb({ users = [], usage = [], news = new Map() } = {}) {
  const statement = (sql, args = []) => ({
    bind: (...bound) => statement(sql, bound),
    async first() {
      if (sql.includes('FROM users WHERE token_hash')) {
        return users.find((u) => u.token_hash === args[0]) || null;
      }
      if (sql.includes('COUNT(*) AS recent FROM users')) return { recent: 0 };
      // The per-user news cache. Empty by default, so a test asks the model.
      if (sql.includes('FROM news WHERE user_id')) return news.get(args[0]) || null;
      if (sql.includes('COUNT(*) AS recent FROM usage_log')) {
        const [userId, kind, since] = args;
        return {
          recent: usage.filter(
            (r) => r.user_id === userId && r.kind === kind && r.created_at > since,
          ).length,
        };
      }
      throw new Error(`unexpected first(): ${sql.slice(0, 60)}`);
    },
    async run() {
      if (sql.startsWith('INSERT INTO users')) {
        users.push({ id: users.length + 1, version: 0, token_hash: args[0] });
      } else if (sql.startsWith('INSERT INTO usage_log')) {
        usage.push({ user_id: args[0], kind: args[1], created_at: args[2] });
      } else if (sql.startsWith('INSERT INTO news')) {
        news.set(args[0], { doc: args[1], created_at: args[3] });
      }
      return { meta: { changes: 1 } };
    },
    async all() { return { results: [] }; },
  });
  return {
    prepare: (sql) => statement(sql),
    batch: async (statements) => statements.map(() => ({ meta: { changes: 1 } })),
    _usage: usage,
    // Calls of one kind, for asserting that a rejected request was not logged.
    countOf: (kind) => usage.filter((r) => r.kind === kind).length,
  };
}

// Stands in for the model provider; records the prompts it was asked for in
// `seen`, and the whole request (url + headers) in `calls` for the tests that
// care which credentials the Worker chose.
export function stubModel(reply) {
  const seen = [];
  const calls = [];
  const real = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    seen.push(JSON.parse(init.body));
    calls.push({ url: String(url), headers: new Headers(init.headers) });
    return new Response(JSON.stringify({ output_text: reply }), {
      headers: { 'content-type': 'application/json' },
    });
  };
  return { seen, calls, restore: () => { globalThis.fetch = real; } };
}

// A provider that always fails, for the 502 path.
export function stubBrokenModel(status = 500, body = 'upstream exploded') {
  const real = globalThis.fetch;
  globalThis.fetch = async () => new Response(body, { status });
  return { restore: () => { globalThis.fetch = real; } };
}
