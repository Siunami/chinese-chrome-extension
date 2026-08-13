// Tests bring-your-own-key routing (resolveModel in worker/src/index.js) — the
// thing that lets one shared Worker serve everybody without serving them the
// owner's model bill. The properties that matter:
//
//   * a caller key is what actually reaches the provider,
//   * a caller key REPLACES the Worker's own credentials rather than merging
//     with them, so no request can half-authenticate as the owner,
//   * with REQUIRE_USER_KEY set, a keyless request is refused even though the
//     Worker has perfectly good secrets of its own,
//   * without it, a private deployment still works exactly as it did before.
//
// Run: node tests/provider-key.test.mjs

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

const TOKEN = 'a'.repeat(32);
const USER_KEY = `sk-${'u'.repeat(40)}`;
const FAL_KEY = '4f1c2b3a-1111-2222-3333-444455556666:0123456789abcdef0123456789abcdef';

const ask = (headers = {}) => new Request('https://example.com/api/ask', {
  method: 'POST',
  headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}`, ...headers },
  body: JSON.stringify({ question: 'What does 了 do here?' }),
});

const translate = (headers = {}) => new Request('https://example.com/api/translate', {
  method: 'POST',
  headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}`, ...headers },
  body: JSON.stringify({ text: '我明天去北京' }),
});

const news = (headers = {}) => new Request('https://example.com/api/news', {
  method: 'POST',
  headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}`, ...headers },
  body: JSON.stringify({ profile: { total: 10 } }),
});

const SHARED = { REQUIRE_USER_KEY: 'true' };

// --- The shared deployment: no key, no service -----------------------------

for (const [name, req] of [['ask', ask], ['translate', translate], ['news', news]]) {
  await test(`${name}: a keyless request on a shared Worker is refused, not billed`, async () => {
    const model = stubModel('should never be called');
    try {
      // Note the owner's key IS set: the point is that REQUIRE_USER_KEY stops
      // it being spent, not that the Worker has nothing to spend.
      const res = await worker.fetch(req(), { ...SHARED, DB: fakeDb(), OPENAI_API_KEY: 'owner-key' });
      assert.equal(res.status, 503);
      assert.match((await res.json()).error, /your own AI key/);
      assert.equal(model.calls.length, 0, 'the provider was called anyway');
    } finally {
      model.restore();
    }
  });
}

await test('a caller key is the one that reaches OpenAI', async () => {
  const model = stubModel('The 了 here marks a change of state.');
  try {
    const res = await worker.fetch(
      ask({ 'x-provider-key': USER_KEY }),
      { ...SHARED, DB: fakeDb(), OPENAI_API_KEY: 'owner-key' },
    );
    assert.equal(res.status, 200);
    assert.equal(model.calls.length, 1);
    assert.equal(model.calls[0].headers.get('authorization'), `Bearer ${USER_KEY}`);
  } finally {
    model.restore();
  }
});

await test("a caller's OpenAI key does not inherit the owner's Azure group", async () => {
  const model = stubModel('answer');
  try {
    // An Azure-configured Worker prefers Azure — unless the caller brought a
    // key, in which case only the caller's provider may be used.
    await worker.fetch(ask({ 'x-provider-key': USER_KEY }), {
      ...SHARED,
      DB: fakeDb(),
      AZURE_OPENAI_KEY: 'owner-azure',
      AZURE_OPENAI_ENDPOINT: 'https://owner.openai.azure.com',
      AZURE_OPENAI_DEPLOYMENT: 'gpt-4o',
    });
    assert.match(model.calls[0].url, /^https:\/\/api\.openai\.com\//);
    assert.equal(model.calls[0].headers.get('api-key'), null, "the owner's Azure key leaked");
  } finally {
    model.restore();
  }
});

await test('a fal.ai key is recognized and routed to fal', async () => {
  const real = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), headers: new Headers(init.headers) });
    return Response.json({ output: 'an answer' });
  };
  try {
    const res = await worker.fetch(
      ask({ 'x-provider-key': FAL_KEY }), { ...SHARED, DB: fakeDb() },
    );
    assert.equal(res.status, 200);
    assert.match(calls[0].url, /fal\.run/);
    assert.equal(calls[0].headers.get('authorization'), `Key ${FAL_KEY}`);
  } finally {
    globalThis.fetch = real;
  }
});

await test('a key of no recognized shape is a 400 that says so, before any spend', async () => {
  const model = stubModel('never');
  try {
    const res = await worker.fetch(
      ask({ 'x-provider-key': 'hunter2' }), { ...SHARED, DB: fakeDb(), OPENAI_API_KEY: 'owner-key' },
    );
    assert.equal(res.status, 400);
    assert.match((await res.json()).error, /OpenAI key/);
    assert.equal(model.calls.length, 0);
  } finally {
    model.restore();
  }
});

// --- The private deployment: unchanged behaviour ---------------------------

await test("without REQUIRE_USER_KEY a keyless request still runs on the Worker's key", async () => {
  const model = stubModel('The 了 here marks a change of state.');
  try {
    const res = await worker.fetch(ask(), { DB: fakeDb(), OPENAI_API_KEY: 'owner-key' });
    assert.equal(res.status, 200);
    assert.equal(model.calls[0].headers.get('authorization'), 'Bearer owner-key');
  } finally {
    model.restore();
  }
});

await test('a private Worker with no key at all still reports the old 503', async () => {
  const res = await worker.fetch(ask(), { DB: fakeDb() });
  assert.equal(res.status, 503);
  assert.match((await res.json()).error, /not configured/);
});

await test('a caller key still wins on a private Worker', async () => {
  const model = stubModel('answer');
  try {
    await worker.fetch(ask({ 'x-provider-key': USER_KEY }), { DB: fakeDb(), OPENAI_API_KEY: 'owner-key' });
    assert.equal(model.calls[0].headers.get('authorization'), `Bearer ${USER_KEY}`);
  } finally {
    model.restore();
  }
});

// --- The header has to survive the browser ---------------------------------

await test('CORS preflight allows the provider-key header', async () => {
  const res = await worker.fetch(
    new Request('https://example.com/api/ask', { method: 'OPTIONS' }), { DB: fakeDb() },
  );
  assert.match(res.headers.get('access-control-allow-headers'), /x-provider-key/);
});

if (failures.length) {
  console.error(`\n${failures.length} failing check(s):\n`);
  for (const f of failures) console.error(`  ✗ ${f}\n`);
  process.exit(1);
}
console.log(`provider-key.test.mjs: ${passed} tests passed`);
