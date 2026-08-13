// Whether the app can tell the learner that their API key is the problem.
//
// Four features run on a model, and each used to meet a missing or rejected
// key by failing inside itself with a sentence only that page showed — "could
// not reach the examiner", over a Worker that was simply out of date. Both
// halves of the fix are checked here:
//
//   the Worker  says whether a deployment has a key of its own and whether it
//               expects the caller to bring one, without spending a model call
//               to say it; and distinguishes a provider REFUSING a key from a
//               provider having a bad afternoon.
//   the client  turns those two facts into one verdict, and — the property
//               that matters most — stays quiet when a deployment pays for its
//               own calls, because nagging somebody to paste a key they do not
//               need is worse than saying nothing.
//
// Run: node tests/aistatus.test.mjs

import assert from 'node:assert/strict';
import worker from '../worker/src/index.js';
import { fakeDb, stubModel } from './fake-d1.mjs';

let passed = 0;
const failures = [];
async function test(name, fn) {
  try {
    await fn();
    passed++;
  } catch (e) {
    failures.push(`${name}\n    ${e.message.split('\n')[0]}`);
  }
}

// ---------------------------------------------------------------------------
// A browser, as far as lib/aistatus.js is concerned
// ---------------------------------------------------------------------------

const SERVER = 'https://worker.example';
const TOKEN = 'a'.repeat(32);

// The module reads and writes chrome.storage.local and fetches /api/health.
// Both are installed before it is imported, because it captures neither at
// module scope — but the import must still not throw in Node.
function fakeChrome(store = {}) {
  const listeners = [];
  return {
    store,
    listeners,
    storage: {
      local: {
        async get(keys) {
          const names = typeof keys === 'string' ? [keys]
            : Array.isArray(keys) ? keys : Object.keys(keys || {});
          const out = {};
          for (const name of names) if (name in store) out[name] = store[name];
          return out;
        },
        async set(update) {
          const changes = {};
          for (const [k, v] of Object.entries(update)) {
            changes[k] = { oldValue: store[k], newValue: v };
            store[k] = v;
          }
          for (const fn of listeners) fn(changes, 'local');
        },
        async remove(key) {
          delete store[key];
          for (const fn of listeners) fn({ [key]: {} }, 'local');
        },
      },
      onChanged: { addListener: (fn) => listeners.push(fn) },
    },
  };
}

// /api/health answers whatever the current deployment is pretending to be.
function stubHealth(ai, { fail = false } = {}) {
  const real = globalThis.fetch;
  const seen = [];
  globalThis.fetch = async (url, init) => {
    seen.push(String(url));
    if (fail) throw new Error('offline');
    if (String(url).endsWith('/api/health')) {
      return new Response(JSON.stringify(ai === null ? { ok: true } : { ok: true, ai }), {
        headers: { 'content-type': 'application/json' },
      });
    }
    return real(url, init);
  };
  return { seen, restore: () => { globalThis.fetch = real; } };
}

const paired = () => ({ syncMeta: { token: TOKEN, serverUrl: SERVER, cursor: 0, lastPushAt: 0 } });

// Imported fresh per test: the module caches nothing across calls, but the
// `chrome` global it reads has to exist before the first one.
async function loadStatus(store) {
  globalThis.chrome = fakeChrome(store);
  return import(`../extension/lib/aistatus.js?t=${Math.random()}`);
}

// ---------------------------------------------------------------------------
// The Worker half
// ---------------------------------------------------------------------------

await test('health says whether this deployment has a key and whether it wants yours', async () => {
  const shared = await worker.fetch(
    new Request('https://example.com/api/health'),
    { DB: fakeDb(), REQUIRE_USER_KEY: 'true' });
  assert.deepEqual((await shared.json()).ai, { configured: false, requiresUserKey: true });

  const private_ = await worker.fetch(
    new Request('https://example.com/api/health'),
    { DB: fakeDb(), OPENAI_API_KEY: 'k' });
  assert.deepEqual((await private_.json()).ai, { configured: true, requiresUserKey: false });

  const bare = await worker.fetch(new Request('https://example.com/api/health'), { DB: fakeDb() });
  assert.deepEqual((await bare.json()).ai, { configured: false, requiresUserKey: false });
});

await test('health costs no model call', async () => {
  const stub = stubModel('should never be reached');
  try {
    await worker.fetch(new Request('https://example.com/api/health'),
      { DB: fakeDb(), OPENAI_API_KEY: 'k' });
    assert.equal(stub.seen.length, 0);
  } finally {
    stub.restore();
  }
});

// A provider that refuses the key, on each endpoint that can hit one.
function stubRejectingProvider(status = 401) {
  const real = globalThis.fetch;
  globalThis.fetch = async () => new Response(
    JSON.stringify({ error: { message: 'Incorrect API key provided', code: 'invalid_api_key' } }),
    { status });
  return { restore: () => { globalThis.fetch = real; } };
}

const ENDPOINTS = [
  ['/api/ask', { question: 'why?' }],
  ['/api/placement', { target: 3, history: [] }],
  ['/api/translate', { text: '你好世界' }],
  ['/api/news', { profile: { savedWords: 3 }, force: true }],
];

await test('a refused key is reported as a refused key, on every endpoint', async () => {
  for (const [path, body] of ENDPOINTS) {
    const stub = stubRejectingProvider(401);
    try {
      const res = await worker.fetch(new Request(`https://example.com${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` },
        body: JSON.stringify(body),
      }), { DB: fakeDb(), OPENAI_API_KEY: 'k' });
      const data = await res.json();
      assert.equal(data.code, 'provider_auth', `${path} did not name the key as the problem`);
      assert.match(data.error, /API key/i, `${path}: ${data.error}`);
    } finally {
      stub.restore();
    }
  }
});

await test('a key out of quota is told apart from a key that is wrong', async () => {
  const stub = stubRejectingProvider(429);
  try {
    const res = await worker.fetch(new Request('https://example.com/api/ask', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify({ question: 'why?' }),
    }), { DB: fakeDb(), OPENAI_API_KEY: 'k' });
    const data = await res.json();
    assert.equal(data.code, 'provider_quota');
    assert.match(data.error, /quota/i);
  } finally {
    stub.restore();
  }
});

await test('an ordinary upstream wobble is not blamed on the key', async () => {
  const real = globalThis.fetch;
  globalThis.fetch = async () => new Response('upstream exploded', { status: 500 });
  try {
    const res = await worker.fetch(new Request('https://example.com/api/ask', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify({ question: 'why?' }),
    }), { DB: fakeDb(), OPENAI_API_KEY: 'k' });
    const data = await res.json();
    assert.equal(data.code, undefined, 'a 500 was reported as a key problem');
    assert.match(data.error, /try again shortly/);
  } finally {
    globalThis.fetch = real;
  }
});

await test('a refused key is surfaced even when a cached digest could be served', async () => {
  // News falls back to yesterday's passage when generation fails. That is the
  // right call for a hiccup and the wrong one for a rejected key: silently
  // serving the cache is how a key stays broken for a week.
  const stub = stubRejectingProvider(401);
  const db = fakeDb({
    users: [{ id: 1, token_hash: await sha256(TOKEN) }],
    news: new Map([[1, { doc: JSON.stringify({ title: 'yesterday' }), created_at: 1 }]]),
  });
  try {
    const res = await worker.fetch(new Request('https://example.com/api/news', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify({ profile: { savedWords: 3 }, force: true }),
    }), { DB: db, OPENAI_API_KEY: 'k' });
    const data = await res.json();
    assert.equal(data.code, 'provider_auth');
    assert.notEqual(data.title, 'yesterday', 'the stale digest hid a rejected key');
  } finally {
    stub.restore();
  }
});

// ---------------------------------------------------------------------------
// The client half — the decision table
// ---------------------------------------------------------------------------

await test('an unpaired browser is not nagged about a key', async () => {
  const { getAiStatus, AI_UNPAIRED } = await loadStatus({});
  assert.equal((await getAiStatus()).code, AI_UNPAIRED);
});

await test('a deployment that pays its own way never asks for a key', async () => {
  const stub = stubHealth({ configured: true, requiresUserKey: false });
  try {
    const { getAiStatus, AI_OK } = await loadStatus({ ...paired() });
    assert.equal((await getAiStatus()).code, AI_OK);
  } finally {
    stub.restore();
  }
});

await test('a deployment that requires your key, with none set, asks for one', async () => {
  const stub = stubHealth({ configured: false, requiresUserKey: true });
  try {
    const { getAiStatus, AI_NO_KEY } = await loadStatus({ ...paired() });
    assert.equal((await getAiStatus()).code, AI_NO_KEY);
  } finally {
    stub.restore();
  }
});

await test('a deployment with no provider at all asks for one', async () => {
  const stub = stubHealth({ configured: false, requiresUserKey: false });
  try {
    const { getAiStatus, AI_NO_KEY } = await loadStatus({ ...paired() });
    assert.equal((await getAiStatus()).code, AI_NO_KEY);
  } finally {
    stub.restore();
  }
});

await test('a key that is set is taken at face value until a provider says otherwise', async () => {
  const stub = stubHealth({ configured: false, requiresUserKey: true });
  try {
    const { getAiStatus, AI_OK } = await loadStatus({ ...paired(), aiKey: 'sk-something' });
    assert.equal((await getAiStatus()).code, AI_OK);
  } finally {
    stub.restore();
  }
});

await test('an unreachable server says nothing rather than blaming the key', async () => {
  const stub = stubHealth(null, { fail: true });
  try {
    const { getAiStatus, AI_OK } = await loadStatus({ ...paired() });
    assert.equal((await getAiStatus()).code, AI_OK, 'being offline was read as a key problem');
  } finally {
    stub.restore();
  }
});

await test('a server too old to answer the question is assumed to pay its own way', async () => {
  // It predates the field, not the feature. Guessing the other way would put a
  // "add your API key" banner over every older deployment that works fine.
  const stub = stubHealth(null);
  try {
    const { getAiStatus, AI_OK } = await loadStatus({ ...paired() });
    assert.equal((await getAiStatus()).code, AI_OK);
  } finally {
    stub.restore();
  }
});

await test('a recorded refusal outranks a key that looks fine', async () => {
  const stub = stubHealth({ configured: true, requiresUserKey: false });
  try {
    const { getAiStatus, AI_BAD_KEY } = await loadStatus({
      ...paired(), aiKey: 'sk-wrong', aiState: { code: 'bad-key', at: 1, detail: 'refused' },
    });
    assert.equal((await getAiStatus()).code, AI_BAD_KEY);
  } finally {
    stub.restore();
  }
});

await test('changing the key clears the old verdict but not a stale-server one', async () => {
  const store = { ...paired(), aiState: { code: 'bad-key', at: 1, detail: '' } };
  const { clearAiFailure } = await loadStatus(store);
  await clearAiFailure();
  assert.equal(store.aiState, undefined, 'a refusal survived the key being changed');

  const store2 = { ...paired(), aiState: { code: 'stale', at: 1, detail: '' } };
  const mod2 = await loadStatus(store2);
  await mod2.clearAiFailure();
  assert.ok(store2.aiState, 'pasting a key does not redeploy the server');
});

// ---------------------------------------------------------------------------
// The client half — postAi, which is where a verdict is recorded
// ---------------------------------------------------------------------------

function stubPost(status, body) {
  const real = globalThis.fetch;
  globalThis.fetch = async () => new Response(
    body === null ? 'not json' : JSON.stringify(body), { status });
  return { restore: () => { globalThis.fetch = real; } };
}

const META = { token: TOKEN, serverUrl: SERVER };

await test('a 404 is reported as an out-of-date server, not as "not found"', async () => {
  // This is the exact failure that reached a learner: the Worker's catch-all,
  // rendered as the word "not found" beside a Try again button that could
  // never work.
  const store = { ...paired() };
  const { postAi, AI_STALE_SERVER } = await loadStatus(store);
  const stub = stubPost(404, { error: 'not found' });
  try {
    await assert.rejects(
      postAi(META, '/api/placement', {}),
      (err) => {
        assert.equal(err.code, AI_STALE_SERVER);
        assert.match(err.message, /older build/);
        return true;
      });
    assert.equal(store.aiState.code, AI_STALE_SERVER, 'the navbar was never told');
  } finally {
    stub.restore();
  }
});

await test('a refused key is recorded so every page shows it, not just this one', async () => {
  const store = { ...paired(), aiKey: 'sk-wrong' };
  const { postAi, AI_BAD_KEY } = await loadStatus(store);
  const stub = stubPost(502, { error: 'the AI provider rejected the API key in use', code: 'provider_auth' });
  try {
    await assert.rejects(postAi(META, '/api/ask', {}), (err) => err.code === AI_BAD_KEY);
    assert.equal(store.aiState.code, AI_BAD_KEY);
  } finally {
    stub.restore();
  }
});

await test('a call that works clears a standing complaint', async () => {
  const store = { ...paired(), aiKey: 'sk-new', aiState: { code: 'bad-key', at: 1, detail: '' } };
  const { postAi } = await loadStatus(store);
  const stub = stubPost(200, { answer: 'fine' });
  try {
    assert.deepEqual(await postAi(META, '/api/ask', {}), { answer: 'fine' });
    assert.equal(store.aiState, undefined, 'a working call left the old warning up');
  } finally {
    stub.restore();
  }
});

await test('being offline is not recorded as anything about the key', async () => {
  const store = { ...paired(), aiKey: 'sk-fine' };
  const { postAi } = await loadStatus(store);
  const real = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('network down'); };
  try {
    await assert.rejects(postAi(META, '/api/ask', {}), (err) => err.code === 'offline');
    assert.equal(store.aiState, undefined);
  } finally {
    globalThis.fetch = real;
  }
});

await test('a 503 from a Worker with no key of its own asks for one', async () => {
  const store = { ...paired() };
  const { postAi, AI_NO_KEY } = await loadStatus(store);
  const stub = stubPost(503, { error: 'The placement interview runs on your own AI key.' });
  try {
    await assert.rejects(postAi(META, '/api/placement', {}), (err) => err.code === AI_NO_KEY);
    assert.equal(store.aiState.code, AI_NO_KEY);
  } finally {
    stub.restore();
  }
});

async function sha256(text) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

if (failures.length) {
  console.error(`\n${failures.length} failing:\n  - ${failures.join('\n  - ')}\n`);
  process.exit(1);
}
console.log(`aistatus: ${passed} passing`);
