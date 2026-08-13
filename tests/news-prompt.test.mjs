// What actually reaches the model when a news digest is generated.
//
// A native speaker read a generated passage and said it "reads like English
// translated Chinese", pointing at 美丽的自然故事 — a phrase where every word is
// real, the grammar parses, and no Chinese person would write it. The rules
// added to stop that are the whole value of the endpoint: a passage that reads
// as a translation teaches a learner to speak like one. They are easy to lose
// in a later edit of a 40-line prompt string and nothing else would notice, so
// they are pinned here.
//
// Run: node tests/news-prompt.test.mjs

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

const PROFILE = {
  savedWords: 40,
  reviewedWords: 20,
  knownWords: ['学校', '朋友'],
  studyingWords: ['海洋', '保护', '科学家'],
  recentWords: ['天气'],
  strugglingWords: ['虽然'],
};

const DIGEST = JSON.stringify({
  title: '科学家发现新的海洋动物',
  article: '科学家在海里发现了一种新的动物。\n\n这种动物很小，住在很深的水里。',
  glossary: [{ word: '海洋', pinyin: 'hǎi yáng', meaning: 'ocean' }],
  englishSummary: 'Scientists found a new sea animal.',
  sources: [{ title: 'A real article', url: 'https://example.com/a' }],
});

// Captures every model call. The Worker gathers headlines from Google News RSS
// before it writes, so the RSS fetches are answered too — the synthesis call is
// the last one, and the one this file is about.
function stubEverything() {
  const calls = [];
  const real = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    const href = String(url);
    if (href.includes('news.google.com')) {
      return new Response(
        `<rss><channel><item><title>Sea life discovery</title>
         <link>https://example.com/a</link><source>Example</source>
         <pubDate>Mon, 01 Jan 2029 00:00:00 GMT</pubDate></item></channel></rss>`,
        { headers: { 'content-type': 'application/xml' } },
      );
    }
    const body = JSON.parse(init.body);
    calls.push(body);
    // Two model calls, in order: the first plans topics and search queries,
    // the second writes the passage from the headlines gathered in between.
    // Told apart by position, not by sniffing the prompt — the synthesis
    // prompt legitimately talks about topics too.
    return Response.json({
      output_text: calls.length === 1
        ? JSON.stringify({ hsk: 2, topics: ['海洋'], queries: ['ocean animal'] })
        : DIGEST,
    });
  };
  return { calls, restore: () => { globalThis.fetch = real; } };
}

const request = () => new Request('https://example.com/api/news', {
  method: 'POST',
  headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` },
  body: JSON.stringify({ profile: PROFILE, force: true }),
});

const env = () => ({ DB: fakeDb(), OPENAI_API_KEY: 'k' });

let synth = null;
{
  const stub = stubEverything();
  try {
    const res = await worker.fetch(request(), env());
    if (res.status !== 200) {
      const body = await res.text();
      throw new Error(`news generation failed (${res.status}): ${body.slice(0, 200)}`);
    }
    synth = stub.calls.at(-1);
  } finally {
    stub.restore();
  }
}

const system = String(synth?.instructions || '');
const user = String(synth?.input || '');

await test('the passage prompt names 翻译腔 and the phrase that exposed it', () => {
  assert.match(system, /翻译腔/, 'the failure mode is not named');
  assert.match(system, /美丽的自然故事/, 'the example a native speaker flagged is gone');
});

await test('it gives the junior-school register as the model to write to', () => {
  assert.match(system, /小学|初中|少儿新闻/,
    'no register model, so "simple" will be read as "news with short words"');
});

await test('it rules out English-shaped noun phrases', () => {
  assert.match(system, /VERB/i, 'nothing says Chinese leans on verbs where English piles up nouns');
  assert.match(system, /的/, 'no guidance on stacking modifiers before a noun');
});

await test('natural phrasing is ranked above hitting the vocabulary list', () => {
  // Both instructions exist, and the ordering between them has to be explicit
  // or the model trades one off against the other however it likes.
  assert.match(system, /OUTRANKS EVERYTHING BELOW|outranks every vocabulary/i,
    'nothing says natural Chinese wins when the two goals conflict');
  assert.match(system, /REREAD EVERY SENTENCE|would a Chinese person say it this way/i,
    'no self-check pass before answering');
});

await test('the words in the review queue reach the prompt, first and marked', () => {
  for (const word of PROFILE.studyingWords) {
    assert.ok(user.includes(word), `${word} is in the review queue but not in the prompt`);
  }
  assert.match(user, /REVIEW QUEUE RIGHT NOW/,
    'the drilled words are not distinguished from everything else');
  // Ahead of the other vocabulary lists, because that is the priority claimed.
  assert.ok(user.indexOf('REVIEW QUEUE RIGHT NOW') < user.indexOf('Known words'),
    'the review queue should be listed before the known words');
});

await test('the learner has to be told the level and the real headlines', () => {
  assert.match(user, /TARGET HSK band: \d/);
  assert.match(user, /Sea life discovery/, 'the real headline never reached the model');
});

if (failures.length) {
  console.error(`\n${failures.length} failing check(s):\n`);
  for (const f of failures) console.error(`  ✗ ${f}\n`);
  process.exit(1);
}
console.log(`news-prompt.test.mjs: ${passed} tests passed`);
