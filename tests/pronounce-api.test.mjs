// Tests /api/pronounce against the real Worker module: its guards, the exact
// request it sends to Azure AI Speech (the reference text has to survive
// base64 as UTF-8 — it is Chinese), and the reshaped response the practice
// page renders. The upstream is stubbed; no key or network is needed.
// Run: node tests/pronounce-api.test.mjs

import assert from 'node:assert/strict';
import worker from '../worker/src/index.js';
import { fakeDb } from './fake-d1.mjs';

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
const keyed = (db = fakeDb()) => ({ DB: db, AZURE_SPEECH_KEY: 'k', AZURE_SPEECH_REGION: 'eastus' });
const KEYED = keyed();
const WAV = new Uint8Array(2048); // shape doesn't matter; the Worker forwards bytes

function post(text = '你好', body = WAV, headers = {}) {
  const url = `https://example.com/api/pronounce?text=${encodeURIComponent(text)}`;
  return new Request(url, {
    method: 'POST',
    headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'audio/wav', ...headers },
    body,
  });
}

// Stands in for Azure; records the request so we can assert on the headers.
function stubAzure(payload, status = 200) {
  const seen = [];
  const real = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    seen.push({ url: String(url), init });
    return new Response(typeof payload === 'string' ? payload : JSON.stringify(payload), {
      status, headers: { 'content-type': 'application/json' },
    });
  };
  return { seen, restore: () => { globalThis.fetch = real; } };
}

const SUCCESS = {
  RecognitionStatus: 'Success',
  DisplayText: '你好吗',
  NBest: [{
    Display: '你好吗',
    PronunciationAssessment: {
      PronScore: 82.4, AccuracyScore: 88.6, FluencyScore: 79.1, CompletenessScore: 100,
    },
    Words: [
      { Word: '你', PronunciationAssessment: { AccuracyScore: 95.2, ErrorType: 'None' } },
      { Word: '好', PronunciationAssessment: { AccuracyScore: 71, ErrorType: 'Mispronunciation' } },
      { Word: '吗', PronunciationAssessment: { AccuracyScore: 0, ErrorType: 'Omission' } },
      { Word: '啊', PronunciationAssessment: { AccuracyScore: 40, ErrorType: 'Insertion' } },
    ],
  }],
};

await test('rejects a request with no bearer token', async () => {
  const res = await worker.fetch(post('你好', WAV, { authorization: '' }), KEYED);
  assert.equal(res.status, 401);
});

await test('rejects anything but POST', async () => {
  const res = await worker.fetch(
    new Request('https://example.com/api/pronounce', { method: 'GET' }), KEYED);
  assert.equal(res.status, 405);
});

// The page keys its "finish setup" message off exactly this status.
await test('reports a clear 503 when the Azure Speech secrets are missing', async () => {
  const res = await worker.fetch(post(), { DB: fakeDb() });
  assert.equal(res.status, 503);
  assert.match((await res.json()).error, /not configured/);
});

await test('rejects a request with no reference text', async () => {
  const res = await worker.fetch(post('   '), KEYED);
  assert.equal(res.status, 400);
});

await test('rejects an empty body', async () => {
  const res = await worker.fetch(post('你好', new Uint8Array(0)), KEYED);
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /audio/);
});

await test('rejects audio past the size cap', async () => {
  const res = await worker.fetch(post('你好', new Uint8Array(5 * 1024 * 1024)), KEYED);
  assert.equal(res.status, 413);
});

await test('sends Mandarin audio to the region endpoint with a UTF-8 config header', async () => {
  const azure = stubAzure(SUCCESS);
  try {
    await worker.fetch(post('你好吗'), KEYED);
    const { url, init } = azure.seen[0];
    assert.match(url, /^https:\/\/eastus\.stt\.speech\.microsoft\.com\//);
    assert.match(url, /language=zh-CN/);
    assert.match(url, /format=detailed/);
    assert.equal(init.headers['Ocp-Apim-Subscription-Key'], 'k');
    assert.match(init.headers['Content-Type'], /samplerate=16000/);
    // btoa() on the raw string would have thrown or mangled the hanzi.
    const config = JSON.parse(Buffer.from(init.headers['Pronunciation-Assessment'], 'base64').toString('utf8'));
    assert.equal(config.ReferenceText, '你好吗');
    assert.equal(config.GradingSystem, 'HundredMark');
    assert.equal(config.EnableMiscue, true);
  } finally {
    azure.restore();
  }
});

await test('reshapes a scored take into per-word statuses and rounded overalls', async () => {
  const azure = stubAzure(SUCCESS);
  try {
    const res = await worker.fetch(post('你好吗'), KEYED);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.recognized, true);
    assert.equal(body.display, '你好吗');
    assert.deepEqual(body.overall, { pron: 82, accuracy: 89, fluency: 79, completeness: 100 });
    // The insertion is dropped: the page maps this list onto the card's
    // characters in order, so an extra entry would shift every later score.
    assert.deepEqual(body.words, [
      { word: '你', accuracy: 95, status: 'good' },
      { word: '好', accuracy: 71, status: 'warn' },
      { word: '吗', accuracy: 0, status: 'miss' },
    ]);
  } finally {
    azure.restore();
  }
});

await test('a take Azure could not recognize comes back as recognized: false', async () => {
  const azure = stubAzure({ RecognitionStatus: 'NoMatch' });
  try {
    const res = await worker.fetch(post(), KEYED);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.recognized, false);
    assert.equal(body.status, 'NoMatch');
  } finally {
    azure.restore();
  }
});

// A bad key is a setup problem, and "try again" would be wrong advice.
await test('a rejected key surfaces as 502 naming the key or region', async () => {
  const azure = stubAzure('{"error":"denied"}', 401);
  try {
    const res = await worker.fetch(post(), KEYED);
    assert.equal(res.status, 502);
    assert.match((await res.json()).error, /key or region/);
  } finally {
    azure.restore();
  }
});

await test('an upstream failure surfaces as 502, not a crash', async () => {
  const azure = stubAzure('upstream exploded', 500);
  try {
    const res = await worker.fetch(post(), KEYED);
    assert.equal(res.status, 502);
    assert.match((await res.json()).error, /speech service error \(500\)/);
  } finally {
    azure.restore();
  }
});

await test('a network failure surfaces as 502, not a crash', async () => {
  const real = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('connection reset'); };
  try {
    const res = await worker.fetch(post(), KEYED);
    assert.equal(res.status, 502);
    assert.match((await res.json()).error, /could not reach/);
  } finally {
    globalThis.fetch = real;
  }
});

// Azure Speech has no bring-your-own-key path, so every take on a shared
// deployment is the Worker owner's money — the hourly cap is the only thing
// standing between a stuck page and their bill.
await test('a user past the hourly cap is refused before Azure is called', async () => {
  const now = Date.now();
  const usage = Array.from({ length: 120 }, () => ({ user_id: 1, kind: 'pronounce', created_at: now }));
  const azure = stubAzure(SUCCESS);
  try {
    const res = await worker.fetch(post(), keyed(fakeDb({ usage })));
    assert.equal(res.status, 429);
    assert.match((await res.json()).error, /pronunciation limit/);
    assert.equal(azure.seen.length, 0, 'Azure was called anyway');
  } finally {
    azure.restore();
  }
});

await test('a scored take is logged against the cap', async () => {
  const db = fakeDb();
  const azure = stubAzure(SUCCESS);
  try {
    await worker.fetch(post(), keyed(db));
    assert.equal(db.countOf('pronounce'), 1);
  } finally {
    azure.restore();
  }
});

if (failures.length) {
  console.error(`\n${failures.length} failing check(s):\n`);
  for (const f of failures) console.error(`  ✗ ${f}\n`);
  process.exit(1);
}
console.log(`pronounce-api.test.mjs: ${passed} tests passed`);
