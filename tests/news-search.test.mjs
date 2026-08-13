// Searching the news, browsing it by category, and what the cache may answer.
//
// The News page stopped being one button that overwrites yesterday's passage:
// you can search for a topic, press a category the model suggested, and every
// article that comes back is kept. Three things have to hold for that, and none
// of them are visible from the page:
//
//   - a requested topic must reach BOTH model calls — the search plan and the
//     writing — or you get a passage labelled 环境 that is about something else;
//   - the per-user cache must answer only the request it was asked, or the
//     second category you press hands back the first one's article;
//   - a topic search that finds nothing must say so, rather than quietly
//     writing about whatever is on the front page.
//
// Run: node tests/news-search.test.mjs

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
  studyingWords: ['海洋', '保护'],
  recentWords: ['天气'],
  strugglingWords: ['虽然'],
};

const PLAN = JSON.stringify({ hsk: 2, topics: ['环境保护'], queries: ['环境 新闻'] });
const DIGEST = JSON.stringify({
  title: '海边的塑料越来越少',
  article: '这个星期，很多人一起去海边捡垃圾。\n\n他们说，海水比去年干净了一些。',
  glossary: [{ word: '垃圾', pinyin: 'lā jī', meaning: 'rubbish' }],
  englishSummary: 'Volunteers cleaned a beach.',
  sources: [{ title: 'A real article', url: 'https://example.com/a' }],
});

const rss = (titles) => new Response(
  `<rss><channel>${titles.map((t, i) => `<item><title>${t}</title>
    <link>https://example.com/${i}</link><source>Example</source></item>`).join('')}
   </channel></rss>`,
  { headers: { 'content-type': 'application/xml' } },
);

// The Worker gathers headlines itself, so a run touches Google News as well as
// the model. `search` is what a topical query finds — an array for "whatever
// was asked", or a function of the query itself, for the tests about which
// words were searched. `top` is the front page it falls back to, kept separate
// because the whole point of a topic search is that it must NOT fall back.
function stub({ replies = [PLAN, DIGEST], search = ['Beach cleanup'], top = ['Front page story'] } = {}) {
  const calls = [];
  const searched = [];
  const real = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    const href = String(url);
    if (href.includes('news.google.com/rss/search')) {
      const query = decodeURIComponent(new URL(href).searchParams.get('q') || '');
      searched.push(query);
      return rss(typeof search === 'function' ? search(query) : search);
    }
    if (href.includes('news.google.com/rss')) return rss(top);
    if (href.includes('bbci.co.uk') || href.includes('rss.dw.com')) return rss([]);
    calls.push(JSON.parse(init.body));
    return Response.json({ output_text: replies[Math.min(calls.length - 1, replies.length - 1)] });
  };
  return { calls, searched, restore: () => { globalThis.fetch = real; } };
}

const post = (path, body) => new Request(`https://example.com${path}`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` },
  body: JSON.stringify(body),
});

const newsRequest = (extra = {}) => post('/api/news', { profile: PROFILE, force: true, ...extra });

// One run of an endpoint against a fresh fake D1. Returns the parsed body, the
// status, and every prompt the model was handed.
async function run(request, { db = fakeDb(), ...stubOpts } = {}) {
  const stubbed = stub(stubOpts);
  try {
    const res = await worker.fetch(request, { DB: db, OPENAI_API_KEY: 'k' });
    return {
      status: res.status,
      body: await res.json(),
      calls: stubbed.calls,
      searched: stubbed.searched,
      db,
    };
  } finally {
    stubbed.restore();
  }
}

// A cached article, as the Worker stores it: one row per user, and it remembers
// what was asked for.
const cachedRow = (doc, ageMs = 5000) => new Map([[1, {
  doc: JSON.stringify(doc),
  created_at: Date.now() - ageMs,
}]]);

// --- a topic reaching the model --------------------------------------------

await test('a searched topic steers the search plan and the writing', async () => {
  const { status, body, calls } = await run(
    newsRequest({ topic: { label: '环境', query: '环境 新闻' } }));
  assert.equal(status, 200, JSON.stringify(body).slice(0, 200));
  assert.match(String(calls[0].input), /REQUESTED TOPIC: 环境/,
    'the planner was not told what to search for, so it searched the deck instead');
  assert.match(String(calls[1].input), /ASKED FOR NEWS ABOUT: 环境/,
    'the writer was not told the topic, so a broad search can wander off it');
  assert.equal(body.topic.label, '环境', 'the article does not say what it answers');
  assert.equal(body.topics[0], '环境', 'the requested topic should lead the chips');
});

await test('a question typed in English is passed through as asked', async () => {
  const asked = 'what is happening with electric cars';
  const { body, calls } = await run(newsRequest({ topic: { label: asked } }));
  assert.match(String(calls[0].input), new RegExp(`REQUESTED TOPIC: ${asked}`),
    'the typed question never reached the planner, which is what turns it into Chinese search terms');
  assert.equal(body.topic.query, asked, 'with no query of its own, the text typed is the query');
});

await test('a plain generate carries no topic at all', async () => {
  const { body, calls } = await run(newsRequest());
  assert.doesNotMatch(String(calls[0].input), /REQUESTED TOPIC/);
  assert.equal(body.topic, null, 'an article nobody asked a topic for must not claim one');
});

// --- what happens when a topic finds nothing --------------------------------

// Pressing 音乐 and being told there is no music news is absurd. It happened
// because the planner narrowed the chip to something nobody published today.
await test('a plan too narrow to find anything is retried with the topic itself', async () => {
  const { status, body, searched, calls } = await run(
    newsRequest({ topic: { label: '音乐', query: '音乐 新闻' } }),
    {
      replies: [JSON.stringify({ hsk: 2, topics: ['音乐'], queries: ['华语乐坛 新歌发布'] }), DIGEST],
      // Only the plain words find anything, which is the real Google News.
      search: (q) => (q === '音乐' ? ['Music news'] : []),
    });
  assert.ok(searched.includes('音乐'),
    `the bare topic was never searched; tried ${searched.join(', ')}`);
  assert.equal(status, 200, `pressing a category must not dead-end: ${JSON.stringify(body).slice(0, 160)}`);
  assert.equal(calls.length, 2, 'the passage should have been written from the retry');
});

await test('the retry only runs when the first pass came up empty', async () => {
  const { searched } = await run(
    newsRequest({ topic: { label: '音乐', query: '音乐 新闻' } }),
    { replies: [JSON.stringify({ hsk: 2, topics: ['音乐'], queries: ['音乐'] }), DIGEST] });
  assert.deepEqual(searched, ['音乐'], `one query was enough; searched ${searched.join(', ')}`);
});

await test('a topic search that finds nothing says so, and does not use the front page', async () => {
  const { status, body, calls } = await run(
    newsRequest({ topic: { label: '环境', query: '环境 新闻' } }),
    { search: [], top: ['Front page story'] });
  assert.equal(status, 502);
  assert.match(String(body.detail), /环境/, 'the failure should name the topic that came up empty');
  assert.equal(calls.length, 1, 'nothing should have been written from unrelated headlines');
});

await test('a plain generate still falls back to the front page', async () => {
  const { status, calls } = await run(newsRequest(), { search: [], top: ['Front page story'] });
  assert.equal(status, 200, '"write me something" is answerable from today\'s top stories');
  assert.equal(calls.length, 2);
});

// --- the cache --------------------------------------------------------------

await test('a different topic is not answered from the last article', async () => {
  const db = fakeDb({ news: cachedRow({ title: '球赛', difficulty: 'normal', topic: { label: '体育' } }) });
  const { body, calls } = await run(
    newsRequest({ topic: { label: '环境', query: '环境 新闻' } }), { db });
  assert.equal(calls.length, 2, 'the cached 体育 article was served for a 环境 search');
  assert.equal(body.cached, false);
  assert.equal(body.topic.label, '环境');
});

await test('asking for the same thing twice in a minute reuses what was written', async () => {
  const db = fakeDb({ news: cachedRow({ title: '球赛', difficulty: 'normal', topic: { label: '体育' } }) });
  const { body, calls } = await run(
    newsRequest({ topic: { label: '体育', query: '体育 新闻' } }), { db });
  assert.equal(calls.length, 0, 'a double-press should not spend a second model call');
  assert.equal(body.cached, true);
  assert.equal(body.title, '球赛');
});

await test('a different level is a different article too', async () => {
  const db = fakeDb({ news: cachedRow({ title: '球赛', difficulty: 'normal' }) });
  const { calls } = await run(newsRequest({ difficulty: 'harder' }), { db });
  assert.equal(calls.length, 2, 'the level dial did nothing until the floor expired');
});

await test('a failed topic search does not fall back to an unrelated cached article', async () => {
  const db = fakeDb({ news: cachedRow({ title: '球赛', difficulty: 'normal', topic: { label: '体育' } }) });
  const { status, body } = await run(
    newsRequest({ topic: { label: '环境', query: '环境 新闻' } }),
    { db, search: [], top: [] });
  assert.equal(status, 502, 'yesterday\'s 体育 passage is not an answer to a 环境 search');
  assert.match(String(body.detail), /环境/);
});

// --- the ceiling ------------------------------------------------------------

await test('generation stops at the hourly ceiling', async () => {
  const now = Date.now();
  const usage = Array.from({ length: 30 }, () => ({ user_id: 1, kind: 'news', created_at: now - 1000 }));
  const { status, body, calls } = await run(newsRequest(), { db: fakeDb({ usage }) });
  assert.equal(status, 429);
  assert.match(body.error, /per hour/);
  assert.equal(calls.length, 0, 'a refused request must not reach the model');
});

await test('a generated article is counted against that ceiling', async () => {
  const { db } = await run(newsRequest());
  assert.equal(db.countOf('news'), 1);
});

// --- suggested categories ---------------------------------------------------

const CATEGORIES = JSON.stringify({
  categories: [
    { label: '环境', pinyin: 'huán jìng', english: 'Environment', query: '环境 新闻' },
    { label: '环境', pinyin: 'huán jìng', english: 'Environment', query: '环境 新闻' }, // duplicate
    { label: '体育', pinyin: 'tǐ yù', english: 'Sport' }, // no query of its own
    { pinyin: 'wú', english: 'Nameless' }, // no label at all
    ...Array.from({ length: 9 }, (_, i) => ({ label: `科技${i}`, english: 'Tech', query: 'q' })),
  ],
});

await test('suggested categories come back named, deduped and capped', async () => {
  const { status, body, calls } = await run(
    post('/api/news/categories', { profile: PROFILE }), { replies: [CATEGORIES] });
  assert.equal(status, 200, JSON.stringify(body).slice(0, 200));
  assert.equal(calls.length, 1, 'one short call, not the two a digest takes');
  assert.ok(body.categories.length <= 8, `${body.categories.length} chips is a wall, not a row`);
  const labels = body.categories.map((c) => c.label);
  assert.equal(new Set(labels).size, labels.length, 'the same section is offered twice');
  assert.ok(!labels.includes(''), 'a nameless category would render as an empty chip');
  assert.equal(body.categories[0].label, '环境');
  assert.equal(body.categories[0].english, 'Environment', 'the English gloss is what a beginner reads');
  const sport = body.categories.find((c) => c.label === '体育');
  assert.equal(sport.query, '体育', 'a category with no query of its own searches for its own name');
});

// The other half of the same failure: a chip nobody could have news for. The
// instruction is easy to lose in an edit of a 20-line prompt, and the only
// symptom is a learner pressing a category and being told there is none.
await test('the categories prompt asks for sections, not subjects', async () => {
  const { calls } = await run(
    post('/api/news/categories', { profile: PROFILE }), { replies: [CATEGORIES] });
  const system = String(calls[0]?.instructions || '');
  assert.match(system, /SECTION, NOT A SUBJECT|section, not a subject/i,
    'nothing stops a chip being as narrow as the deck that suggested it');
  assert.match(system, /独立摇滚|音乐节/,
    'the too-narrow example that made this rule necessary is gone');
});

await test('suggesting categories is capped per hour of its own', async () => {
  const now = Date.now();
  const usage = Array.from({ length: 20 }, () => ({ user_id: 1, kind: 'news_topics', created_at: now - 1000 }));
  const { status, calls } = await run(
    post('/api/news/categories', { profile: PROFILE }),
    { db: fakeDb({ usage }), replies: [CATEGORIES] });
  assert.equal(status, 429);
  assert.equal(calls.length, 0);
});

await test('the categories endpoint needs a token and a profile like every other', async () => {
  const noToken = new Request('https://example.com/api/news/categories', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}',
  });
  const bare = await run(noToken, { replies: [CATEGORIES] });
  assert.equal(bare.status, 401);
  const noProfile = await run(post('/api/news/categories', {}), { replies: [CATEGORIES] });
  assert.equal(noProfile.status, 400);
});

if (failures.length) {
  console.error(`\n${failures.length} failing check(s):\n`);
  for (const f of failures) console.error(`  ✗ ${f}\n`);
  process.exit(1);
}
console.log(`news-search.test.mjs: ${passed} tests passed`);
