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

// Who the tutor is talking to. Without this the answer can only be general,
// and a general answer to "how is this actually used?" is a dictionary with a
// friendlier voice.
const PROFILE = {
  hskLevel: 3,
  savedWords: 212,
  reviewedWords: 140,
  matureWords: 61,
  studyingWords: ['顺便', '恰好'],
  knownWords: ['喜欢', '习惯'],
  strugglingWords: ['舍不得'],
  recentWords: ['迟早'],
  placement: { level: 4, summary: 'Comfortable on everyday topics, thin on abstract ones.' },
};

await test('the learner\'s level, deck and placement reach the prompt', async () => {
  const model = stubModel('顺便 rides along with something you are already doing.');
  try {
    await worker.fetch(post({ question: 'How is 顺便 used?', profile: PROFILE }, auth),
      { DB: fakeDb(), OPENAI_API_KEY: 'k' });
    const prompt = model.seen[0].input;
    assert.match(prompt, /Working at about HSK 3/, 'the level is missing');
    assert.match(prompt, /placement interview put them at HSK 4: Comfortable on everyday/,
      'the interview result is missing');
    assert.match(prompt, /212 words saved, 140 in review, 61 of those well established/);
    assert.match(prompt, /Drilling this week[^\n]*顺便、恰好/);
    assert.match(prompt, /Knows reliably[^\n]*喜欢、习惯/);
    assert.match(prompt, /Keeps failing[^\n]*舍不得/);
  } finally {
    model.restore();
  }
});

await test('a huge deck is clamped rather than shipped whole', async () => {
  const model = stubModel('ok');
  try {
    await worker.fetch(post({
      question: 'q',
      profile: { studyingWords: Array.from({ length: 400 }, (_, i) => `词${i}`) },
    }, auth), { DB: fakeDb(), OPENAI_API_KEY: 'k' });
    const line = model.seen[0].input.split('\n').find((l) => l.startsWith('- Drilling'));
    assert.equal(line.split('、').length, 40, `sent ${line.split('、').length} words`);
  } finally {
    model.restore();
  }
});

await test('a question with no profile still works', async () => {
  const model = stubModel('ok');
  try {
    const res = await worker.fetch(post({ question: 'why?' }, auth),
      { DB: fakeDb(), OPENAI_API_KEY: 'k' });
    assert.equal(res.status, 200);
    assert.doesNotMatch(model.seen[0].input, /Who you are talking to/);
  } finally {
    model.restore();
  }
});

// Looking things up. A question about a song, a place, or something in this
// week's news is one a learner will actually ask, and "I cannot know that" is a
// worse answer than a search.
await test('the tutor is given the web-search tool, unless it is switched off', async () => {
  const model = stubModel('ok');
  try {
    await worker.fetch(post({ question: 'q' }, auth), { DB: fakeDb(), OPENAI_API_KEY: 'k' });
    assert.deepEqual(model.seen[0].tools, [{ type: 'web_search' }]);

    await worker.fetch(post({ question: 'q' }, auth),
      { DB: fakeDb(), OPENAI_API_KEY: 'k', ASK_WEB_SEARCH: 'false' });
    assert.equal(model.seen[1].tools, undefined, 'the tool was sent with search switched off');
  } finally {
    model.restore();
  }
});

// The tool has been spelled two ways across versions of the Responses API, and
// some models have neither — a question must not fail over that.
await test('a provider that refuses the search tool still answers', async () => {
  const real = globalThis.fetch;
  const seen = [];
  globalThis.fetch = async (url, init) => {
    const body = JSON.parse(init.body);
    seen.push(body.tools?.[0]?.type || 'none');
    if (body.tools) {
      return new Response(JSON.stringify({ error: { message: 'Unsupported tool web_search' } }),
        { status: 400 });
    }
    return new Response(JSON.stringify({ output_text: 'answered anyway' }),
      { headers: { 'content-type': 'application/json' } });
  };
  try {
    const res = await worker.fetch(post({ question: 'q' }, auth),
      { DB: fakeDb(), OPENAI_API_KEY: 'k' });
    assert.equal(res.status, 200);
    assert.equal((await res.json()).answer, 'answered anyway');
    assert.deepEqual(seen, ['web_search', 'web_search_preview', 'none'],
      'it should try each spelling, then go without');
  } finally {
    globalThis.fetch = real;
  }
});

await test('a rejected key is not retried as a tool problem', async () => {
  const real = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return new Response('invalid api key', { status: 401 });
  };
  try {
    const res = await worker.fetch(post({ question: 'q' }, auth),
      { DB: fakeDb(), OPENAI_API_KEY: 'k' });
    assert.equal(res.status, 502);
    assert.equal((await res.json()).code, 'provider_auth');
    assert.equal(calls, 1, 'a bad key was retried');
  } finally {
    globalThis.fetch = real;
  }
});

// Attached images. The learner pastes a photo of a sign or a screenshot of a
// sentence the extension does not run on; it has to reach the model as an
// image, not be quietly dropped on the way.
const PIXEL = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

await test('an attached image is sent to the model with the question', async () => {
  const model = stubModel('The sign says 小心地滑 — careful, slippery floor.');
  try {
    const res = await worker.fetch(post({
      question: 'What does this sign say?',
      images: [{ mime: 'image/png', data: PIXEL }],
    }, auth), { DB: fakeDb(), OPENAI_API_KEY: 'k' });
    assert.equal(res.status, 200);
    const { input } = model.seen[0];
    assert.ok(Array.isArray(input), 'the image did not turn the input into message parts');
    const parts = input[0].content;
    assert.equal(parts[0].type, 'input_text');
    assert.match(parts[0].text, /attached an image/, 'the prompt does not mention the attachment');
    assert.match(parts[0].text, /Question: What does this sign say\?/);
    assert.equal(parts[1].type, 'input_image');
    assert.equal(parts[1].image_url, `data:image/png;base64,${PIXEL}`);
    // The extension needs to know the picture actually landed: a Worker
    // deployed before images existed accepts the request and drops them.
    assert.equal((await res.json()).sawImages, 1);
  } finally {
    model.restore();
  }
});

// A picture stays in the conversation. The client resends the last one with
// follow-up questions, and the prompt has to say so, or the model announces a
// newly-arrived photograph every turn.
await test('an image carried over from an earlier turn is described as such', async () => {
  const model = stubModel('It says 小心地滑.');
  try {
    await worker.fetch(post({
      question: 'What was the second line again?',
      images: [{ mime: 'image/png', data: PIXEL }],
      imagesFromEarlier: true,
    }, auth), { DB: fakeDb(), OPENAI_API_KEY: 'k' });
    const text = model.seen[0].input[0].content[0].text;
    assert.match(text, /sent an image earlier in this conversation/);
    assert.match(text, /still about it/);
    assert.doesNotMatch(text, /attached an image with this question/);
  } finally {
    model.restore();
  }
});

await test('a question with no image is still sent as plain text', async () => {
  const model = stubModel('yes');
  try {
    await worker.fetch(post({ question: 'why?' }, auth), { DB: fakeDb(), OPENAI_API_KEY: 'k' });
    assert.equal(typeof model.seen[0].input, 'string');
  } finally {
    model.restore();
  }
});

await test('refuses more images than the cap, an unknown type, and non-base64', async () => {
  const env = { DB: fakeDb(), OPENAI_API_KEY: 'k' };
  const four = Array.from({ length: 4 }, () => ({ mime: 'image/png', data: PIXEL }));
  const tooMany = await worker.fetch(post({ question: 'q', images: four }, auth), env);
  assert.equal(tooMany.status, 400);
  assert.match((await tooMany.json()).error, /at most 3 images/);

  const wrongType = await worker.fetch(post({
    question: 'q', images: [{ mime: 'application/pdf', data: PIXEL }],
  }, auth), env);
  assert.equal(wrongType.status, 400);
  assert.match((await wrongType.json()).error, /unsupported image type/);

  const notBase64 = await worker.fetch(post({
    question: 'q', images: [{ mime: 'image/png', data: 'data:image/png;base64,oops!' }],
  }, auth), env);
  assert.equal(notBase64.status, 400);

  const huge = await worker.fetch(post({
    question: 'q', images: [{ mime: 'image/jpeg', data: 'A'.repeat(1_600_001) }],
  }, auth), env);
  assert.equal(huge.status, 413);
});

// A refused attachment must not cost the learner one of their forty questions.
await test('a rejected image is not logged against the hourly cap', async () => {
  const db = fakeDb();
  await worker.fetch(post({
    question: 'q', images: [{ mime: 'image/tiff', data: PIXEL }],
  }, auth), { DB: db, OPENAI_API_KEY: 'k' });
  assert.equal(db.countOf('ask'), 0);
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
