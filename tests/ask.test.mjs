// Tests the study-guide tutor endpoint against the real Worker module: its
// guards, its per-user rate limit, and — the part that matters for
// highlight-to-ask — that the text the learner pointed at actually reaches the
// model prompt.
// Run: node tests/ask.test.mjs

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

const post = (body, headers = {}) => new Request('https://example.com/api/ask', {
  method: 'POST',
  headers: { 'content-type': 'application/json', ...headers },
  body: JSON.stringify(body),
});

const TOKEN = 'a'.repeat(32);
const auth = { authorization: `Bearer ${TOKEN}` };

await test('rejects a request with no bearer token', async () => {
  const res = await worker.fetch(post({ question: 'why?' }), { DB: fakeDb() });
  assert.equal(res.status, 401);
});

await test('rejects anything but POST', async () => {
  const res = await worker.fetch(
    new Request('https://example.com/api/ask', { method: 'GET' }), { DB: fakeDb() });
  assert.equal(res.status, 405);
});

await test('reports a clear 503 when no model provider is configured', async () => {
  const res = await worker.fetch(post({ question: 'why?' }, auth), { DB: fakeDb() });
  assert.equal(res.status, 503);
  assert.match((await res.json()).error, /not configured/);
});

await test('rejects an empty question', async () => {
  const res = await worker.fetch(post({ question: '   ' }, auth),
    { DB: fakeDb(), OPENAI_API_KEY: 'k' });
  assert.equal(res.status, 400);
});

await test('answers a question and logs it against the hourly cap', async () => {
  const model = stubModel('The 了 here marks a change of state.');
  const db = fakeDb();
  try {
    const res = await worker.fetch(
      post({ question: 'What does 了 do here?' }, auth), { DB: db, OPENAI_API_KEY: 'k' });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.match(body.answer, /change of state/);
    assert.ok(Number.isInteger(body.generatedAt));
    assert.equal(db.countOf('ask'), 1);
  } finally {
    model.restore();
  }
});

await test('the highlighted passage reaches the prompt, marked as the target', async () => {
  const model = stubModel('The 了 here marks a change of state.');
  try {
    await worker.fetch(post({
      question: 'Why 把 here?',
      selection: '他把书放在桌子上了。',
      context: { level: 3, section: 'Grammar', text: 'A section about 把 sentences.' },
      history: [
        { role: 'user', content: 'earlier question' },
        { role: 'assistant', content: 'earlier answer' },
      ],
    }, auth), { DB: fakeDb(), OPENAI_API_KEY: 'k' });

    const prompt = model.seen[0].input;
    assert.match(prompt, /HIGHLIGHTED/, 'the selection was not flagged as the target');
    assert.ok(prompt.includes('他把书放在桌子上了。'), 'the selection is missing from the prompt');
    assert.match(prompt, /HSK 3 study guide/, 'the level is missing');
    assert.match(prompt, /"Grammar" section/, 'the section is missing');
    assert.ok(prompt.includes('A section about 把 sentences.'), 'the surrounding text is missing');
    assert.match(prompt, /Learner: earlier question/, 'history is missing');
    assert.match(prompt, /Question: Why 把 here\?/, 'the question is missing');
  } finally {
    model.restore();
  }
});

// The tutor is no longer only about study guides; a flashcard has to say so or
// the model answers as though it were reading a syllabus.
await test('a non-guide surface describes itself in the prompt', async () => {
  const model = stubModel('The 了 here marks a change of state.');
  try {
    await worker.fetch(post({
      question: 'How is this actually used?',
      context: {
        where: 'a flashcard they are reviewing',
        section: 'Word card',
        text: 'Word card: 学习\nPinyin: xué xí\nDictionary gloss: to learn; to study',
      },
    }, auth), { DB: fakeDb(), OPENAI_API_KEY: 'k' });
    const prompt = model.seen[0].input;
    assert.match(prompt, /looking at a flashcard they are reviewing/);
    assert.doesNotMatch(prompt, /study guide/, 'it still claims to be a study guide');
    assert.ok(prompt.includes('Dictionary gloss: to learn; to study'));
  } finally {
    model.restore();
  }
});

await test('a question with no highlight carries no selection block', async () => {
  const model = stubModel('The 了 here marks a change of state.');
  try {
    await worker.fetch(post({ question: 'How do I study this level?', context: { level: 5 } }, auth),
      { DB: fakeDb(), OPENAI_API_KEY: 'k' });
    const prompt = model.seen[0].input;
    assert.doesNotMatch(prompt, /HIGHLIGHTED/);
    assert.match(prompt, /HSK 5 study guide/);
  } finally {
    model.restore();
  }
});

await test('caps questions per user per hour', async () => {
  const model = stubModel('The 了 here marks a change of state.');
  const db = fakeDb();
  const env = { DB: db, OPENAI_API_KEY: 'k' };
  try {
    for (let i = 0; i < 40; i++) {
      const res = await worker.fetch(post({ question: `q${i}` }, auth), env);
      assert.equal(res.status, 200, `request ${i} should have been answered`);
    }
    const res = await worker.fetch(post({ question: 'one too many' }, auth), env);
    assert.equal(res.status, 429);
    assert.match((await res.json()).error, /40 per hour/);
    assert.equal(db.countOf('ask'), 40, 'the rejected question must not be logged');
  } finally {
    model.restore();
  }
});

await test('a provider failure surfaces as 502, not a crash', async () => {
  const real = globalThis.fetch;
  globalThis.fetch = async () => new Response('upstream exploded', { status: 500 });
  try {
    const res = await worker.fetch(post({ question: 'why?' }, auth),
      { DB: fakeDb(), OPENAI_API_KEY: 'k' });
    assert.equal(res.status, 502);
    assert.match((await res.json()).detail, /openai 500/);
  } finally {
    globalThis.fetch = real;
  }
});

await test('oversized input is clamped rather than rejected', async () => {
  const model = stubModel('The 了 here marks a change of state.');
  try {
    await worker.fetch(post({
      question: 'q'.repeat(5000),
      selection: '好'.repeat(5000),
      context: { level: 1, text: '字'.repeat(20000) },
    }, auth), { DB: fakeDb(), OPENAI_API_KEY: 'k' });
    const prompt = model.seen[0].input;
    assert.ok(prompt.length < 12000, `prompt was ${prompt.length} chars`);
  } finally {
    model.restore();
  }
});

if (failures.length) {
  console.error(`\n${failures.length} failing check(s):\n`);
  for (const f of failures) console.error(`  ✗ ${f}\n`);
  process.exit(1);
}
console.log(`ask.test.mjs: ${passed} tests passed`);
