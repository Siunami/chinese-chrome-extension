// Tests /api/translate against the real Worker module. The endpoint exists so
// a sentence that is in no dictionary — one highlighted in an article, or one
// the tutor just wrote — gets an English back that says what it MEANS, rather
// than the word-by-word gloss the client falls back to.
// Run: node tests/translate.test.mjs

import assert from 'node:assert/strict';
import worker from '../worker/src/index.js';
import { fakeDb, stubModel, stubBrokenModel } from './fake-d1.mjs';

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

const post = (body, headers = {}) => new Request('https://example.com/api/translate', {
  method: 'POST',
  headers: { 'content-type': 'application/json', ...headers },
  body: JSON.stringify(body),
});

const TOKEN = 'a'.repeat(32);
const auth = { authorization: `Bearer ${TOKEN}` };
const reply = (o) => JSON.stringify(o);

await test('rejects a request with no bearer token', async () => {
  const res = await worker.fetch(post({ text: '看了两次电影' }), { DB: fakeDb() });
  assert.equal(res.status, 401);
});

await test('rejects anything but POST', async () => {
  const res = await worker.fetch(
    new Request('https://example.com/api/translate', { method: 'GET' }), { DB: fakeDb() });
  assert.equal(res.status, 405);
});

await test('reports a clear 503 when no model provider is configured', async () => {
  const res = await worker.fetch(post({ text: '看了两次电影' }, auth), { DB: fakeDb() });
  assert.equal(res.status, 503);
  assert.match((await res.json()).error, /not configured/);
});

await test('rejects empty and non-Chinese input', async () => {
  const env = { DB: fakeDb(), OPENAI_API_KEY: 'k' };
  assert.equal((await worker.fetch(post({ text: '   ' }, auth), env)).status, 400);
  const english = await worker.fetch(post({ text: 'just some english' }, auth), env);
  assert.equal(english.status, 400);
  assert.match((await english.json()).error, /not Chinese/);
});

await test('refuses text far longer than a flashcard', async () => {
  const res = await worker.fetch(post({ text: '好'.repeat(500) }, auth),
    { DB: fakeDb(), OPENAI_API_KEY: 'k' });
  assert.equal(res.status, 413);
});

await test('translates a sentence and logs it against the hourly cap', async () => {
  const model = stubModel(reply({ translation: 'I watched the movie twice.', literal: '' }));
  const db = fakeDb();
  try {
    const res = await worker.fetch(post({ text: '看了两次电影' }, auth),
      { DB: db, OPENAI_API_KEY: 'k' });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.translation, 'I watched the movie twice.');
    assert.equal(body.literal, '');
    assert.ok(Number.isInteger(body.generatedAt));
    assert.equal(db.countOf('translate'), 1);
    // The sentence itself is what the model is asked about.
    assert.ok(model.seen[0].input.includes('看了两次电影'));
  } finally {
    model.restore();
  }
});

await test('a literal rendering rides along when the model offers one', async () => {
  const model = stubModel(reply({
    translation: 'I watched the movie twice.',
    literal: 'watch-PAST two times movie',
  }));
  try {
    const res = await worker.fetch(post({ text: '看了两次电影' }, auth),
      { DB: fakeDb(), OPENAI_API_KEY: 'k' });
    assert.equal((await res.json()).literal, 'watch-PAST two times movie');
  } finally {
    model.restore();
  }
});

// An empty translation is how the prompt tells the model to say "this is not
// translatable". Writing that onto a card would replace a usable gloss with
// nothing at all.
await test('an empty translation is refused rather than written to the card', async () => {
  const model = stubModel(reply({ translation: '   ', literal: '' }));
  const db = fakeDb();
  try {
    // Real hanzi, so it gets past the is-this-Chinese guard and the model is
    // the one deciding there is nothing to translate.
    const res = await worker.fetch(post({ text: '啊啊啊啊' }, auth),
      { DB: db, OPENAI_API_KEY: 'k' });
    assert.equal(res.status, 422);
    assert.equal(db.countOf('translate'), 0, 'a refusal must not spend the quota');
  } finally {
    model.restore();
  }
});

await test('clamps an over-long answer instead of trusting the model', async () => {
  const model = stubModel(reply({ translation: 'x'.repeat(5000), literal: 'y'.repeat(5000) }));
  try {
    const res = await worker.fetch(post({ text: '看了两次电影' }, auth),
      { DB: fakeDb(), OPENAI_API_KEY: 'k' });
    const body = await res.json();
    assert.ok(body.translation.length <= 400, `translation was ${body.translation.length} chars`);
    assert.ok(body.literal.length <= 400);
  } finally {
    model.restore();
  }
});

await test('caps translations per user per hour', async () => {
  const model = stubModel(reply({ translation: 'ok', literal: '' }));
  const db = fakeDb();
  const env = { DB: db, OPENAI_API_KEY: 'k' };
  try {
    for (let i = 0; i < 200; i++) {
      const res = await worker.fetch(post({ text: `第${i}句话，很好。` }, auth), env);
      assert.equal(res.status, 200, `request ${i} should have been translated`);
    }
    const res = await worker.fetch(post({ text: '再来一句。' }, auth), env);
    assert.equal(res.status, 429);
    assert.match((await res.json()).error, /200 per hour/);
    assert.equal(db.countOf('translate'), 200);
  } finally {
    model.restore();
  }
});

// The two model endpoints must not share a budget: saving a run of sentences
// should never be the reason the tutor stops answering.
await test('translating does not spend the tutor\'s hourly allowance', async () => {
  const model = stubModel(reply({ translation: 'ok', literal: '' }));
  const db = fakeDb();
  const env = { DB: db, OPENAI_API_KEY: 'k' };
  try {
    for (let i = 0; i < 50; i++) {
      await worker.fetch(post({ text: `第${i}句话，很好。` }, auth), env);
    }
    assert.equal(db.countOf('translate'), 50);
    assert.equal(db.countOf('ask'), 0);
    const asked = await worker.fetch(new Request('https://example.com/api/ask', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...auth },
      body: JSON.stringify({ question: 'still there?' }),
    }), env);
    assert.equal(asked.status, 200, 'the tutor was rate limited by translations');
  } finally {
    model.restore();
  }
});

await test('a provider failure surfaces as 502, not a crash', async () => {
  const model = stubBrokenModel();
  try {
    const res = await worker.fetch(post({ text: '看了两次电影' }, auth),
      { DB: fakeDb(), OPENAI_API_KEY: 'k' });
    assert.equal(res.status, 502);
    assert.match((await res.json()).detail, /openai 500/);
  } finally {
    model.restore();
  }
});

await test('a non-JSON answer surfaces as 502 rather than a broken card', async () => {
  const model = stubModel('I watched the movie twice.');
  try {
    const res = await worker.fetch(post({ text: '看了两次电影' }, auth),
      { DB: fakeDb(), OPENAI_API_KEY: 'k' });
    assert.equal(res.status, 502);
  } finally {
    model.restore();
  }
});

if (failures.length) {
  console.error(`\n${failures.length} failing check(s):\n`);
  for (const f of failures) console.error(`  ✗ ${f}\n`);
  process.exit(1);
}
console.log(`translate.test.mjs: ${passed} tests passed`);
