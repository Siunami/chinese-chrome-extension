// The pictures in the README, taken from the running extension.
//
// They go through scripts/harness.mjs — the same fake browser the smoke test
// drives — so what you see in the README is the shipped pages rendering the
// real dictionary, not a mockup that quietly stops being true. Rerun it after
// anything that changes how a page looks:
//
//   node scripts/screenshots.mjs        -> docs/shots/*.png
//   CHROME=/path/to/chrome              override the browser
//
// The learner in these shots is invented — a deck of everyday words at a
// plausible spread of ages, one generated passage, one conversation. Nobody's
// real library or chat history is in here, and none of it is anyone's writing:
// the passage and the tutor's reply below are fixtures, not model output.

import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { base, openPage } from './harness.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'docs', 'shots');
mkdirSync(outDir, { recursive: true });

const DAY = 86400000;
const now = Date.now();

// --- the invented learner ---------------------------------------------------

// A few months in: a core of words that have stuck, a handful still wobbling,
// some saved yesterday and never studied. `ivl` is the interval in days, which
// is what decides the stage a card is shown in.
const card = (simp, trad, pinyin, defs, opts = {}) => ({
  cardType: opts.cardType || 'word',
  simp,
  trad: trad || '',
  pinyin,
  defs,
  savedAt: now - (opts.savedDaysAgo ?? 30) * DAY,
  lastSavedAt: now - (opts.savedDaysAgo ?? 30) * DAY,
  touches: opts.touches ?? 1,
  srs: opts.ivl === undefined ? null : {
    reps: opts.reps ?? 4,
    lapses: opts.lapses ?? 0,
    ease: opts.ease ?? 2.5,
    ivl: opts.ivl,
    due: now + (opts.dueInDays ?? opts.ivl) * DAY,
    reviewedAt: now - 2 * DAY,
    introducedAt: now - (opts.savedDaysAgo ?? 30) * DAY,
  },
});

const WORDLIST = [
  // Due now — what a session would actually serve.
  card('舍不得', '捨不得', 'shě bu de', 'to hate to part with; to be reluctant to',
    { ivl: 6, dueInDays: -0.4, reps: 3, lapses: 1, savedDaysAgo: 24, touches: 4 }),
  card('顺便', '順便', 'shùn biàn', 'conveniently; while one is at it; in passing',
    { ivl: 3, dueInDays: -0.2, reps: 2, savedDaysAgo: 12, touches: 2 }),
  card('打交道', '', 'dǎ jiāo dào', 'to deal with; to have dealings with',
    { ivl: 1, dueInDays: -0.1, reps: 1, lapses: 2, savedDaysAgo: 9, touches: 5 }),
  // Saved, never studied.
  card('恰好', '', 'qià hǎo', 'as it happens; just right; by coincidence',
    { savedDaysAgo: 1, touches: 2 }),
  card('迟早', '遲早', 'chí zǎo', 'sooner or later', { savedDaysAgo: 1 }),
  card('值得', '', 'zhí de', 'to be worth it; to deserve', { savedDaysAgo: 2, touches: 3 }),
  card('临时', '臨時', 'lín shí', 'at short notice; temporary; makeshift',
    { savedDaysAgo: 3 }),
  // Coming back soon.
  card('居然', '', 'jū rán', 'unexpectedly; to one\'s surprise',
    { ivl: 9, reps: 3, savedDaysAgo: 40, touches: 2 }),
  card('毕竟', '畢竟', 'bì jìng', 'after all; all in all; when all is said and done',
    { ivl: 15, reps: 4, savedDaysAgo: 52 }),
  card('趁', '', 'chèn', 'to take advantage of (a time or opportunity)',
    { ivl: 4, reps: 2, lapses: 1, savedDaysAgo: 18, touches: 3 }),
  // Settled in.
  card('习惯', '習慣', 'xí guàn', 'habit; to be used to',
    { ivl: 96, reps: 8, savedDaysAgo: 150 }),
  card('打算', '', 'dǎ suàn', 'to plan; to intend; intention',
    { ivl: 62, reps: 7, savedDaysAgo: 130, touches: 2 }),
  card('区别', '區別', 'qū bié', 'difference; to distinguish',
    { ivl: 45, reps: 6, savedDaysAgo: 120 }),
  card('厉害', '厲害', 'lì hai', 'impressive; severe; formidable',
    { ivl: 120, reps: 9, savedDaysAgo: 190, touches: 4 }),
  card('随便', '隨便', 'suí biàn', 'as one wishes; casual; whatever you like',
    { ivl: 30, reps: 5, savedDaysAgo: 90 }),
  // A sentence card, saved from a passage rather than a dictionary entry.
  card('他趁天还没黑就出发了。', '', 'tā chèn tiān hái méi hēi jiù chū fā le.',
    'He set off while it was still light.',
    { cardType: 'sentence', ivl: 21, reps: 4, savedDaysAgo: 60 }),
  card('这件事我们迟早要谈。', '', 'zhè jiàn shì wǒ men chí zǎo yào tán.',
    'Sooner or later we are going to have to talk about this.',
    { cardType: 'sentence', savedDaysAgo: 2 }),
];

// A digest as the Worker would have returned it, so the News tab renders
// without a model call. Written by hand for the picture.
const DIGEST = {
  level: 'HSK 4',
  targetHsk: 5,
  topics: ['环境', '城市生活'],
  title: '城市里的旧河重新开放',
  titlePinyin: 'chéng shì lǐ de jiù hé chóng xīn kāi fàng',
  article: '这个月，市里把一条老河道重新开放给市民。这条河以前又脏又臭，'
    + '附近的居民都不愿意走近。工人用了两年时间清理河水，种上树，还修了一条小路。\n\n'
    + '现在每天早上都有人在河边跑步。有的老人说，他们小时候就在这条河里游泳，'
    + '所以看到河水变干净，心里特别高兴。市政府表示，明年还要在城市的另一边做同样的事。',
  englishSummary: 'The city reopened an old canal this month after a two-year cleanup. '
    + 'Residents once avoided it; now people run along it in the mornings, and older '
    + 'neighbours remember swimming there as children. The city plans a second stretch '
    + 'next year.',
  glossary: [
    { word: '河道', pinyin: 'hé dào', meaning: 'riverbed; watercourse' },
    { word: '居民', pinyin: 'jū mín', meaning: 'resident; inhabitant' },
    { word: '清理', pinyin: 'qīng lǐ', meaning: 'to clean up; to clear out' },
    { word: '市政府', pinyin: 'shì zhèng fǔ', meaning: 'city government' },
  ],
  sources: [
    { title: 'City reopens canal walkway after two-year cleanup', url: 'https://example.com/canal' },
    { title: 'Residents return to the water', url: 'https://example.com/water' },
  ],
};

// Yesterday's article, which was searched for rather than inferred — so the
// archive shows both kinds of row.
const OLDER_DIGEST = {
  level: 'HSK 4',
  targetHsk: 4,
  topic: { label: '科技', query: '科技 新闻', english: 'Technology' },
  topics: ['科技'],
  title: '新的地铁线开始试运行',
  titlePinyin: 'xīn de dì tiě xiàn kāi shǐ shì yùn xíng',
  article: '这条地铁线一共有十二个站，从城东一直开到城西。\n\n'
    + '工作人员说，正式通车以后，很多人上班的时间会少半个小时。',
  englishSummary: 'A new twelve-stop metro line has begun test runs across the city.',
  glossary: [
    { word: '试运行', pinyin: 'shì yùn xíng', meaning: 'trial run' },
    { word: '通车', pinyin: 'tōng chē', meaning: 'to open to traffic' },
  ],
  sources: [{ title: 'New metro line begins testing', url: 'https://example.com/metro' }],
};

// The chips above the search box, as the model would have suggested them.
const CATEGORIES = [
  { label: '科技', pinyin: 'kē jì', english: 'Technology', query: '科技 新闻' },
  { label: '环境', pinyin: 'huán jìng', english: 'Environment', query: '环境 新闻' },
  { label: '健康', pinyin: 'jiàn kāng', english: 'Health', query: '健康 新闻' },
  { label: '国际', pinyin: 'guó jì', english: 'World', query: '国际 新闻' },
  { label: '文化', pinyin: 'wén huà', english: 'Culture', query: '文化 新闻' },
];

// One conversation, the shape the drawer stores them in.
const CHAT = {
  id: 'cshot1',
  at: now - 3 * 60000,
  messages: [
    {
      role: 'user',
      content: 'How is 舍不得 different from 不想?',
      quote: '舍不得',
    },
    {
      role: 'assistant',
      content: '不想 (bù xiǎng) is simply not wanting to do something — no feeling '
        + 'attached. 舍不得 (shě bu de) is not being able to bring yourself to give '
        + 'something up, because you care about it.\n\n'
        + '她舍不得卖掉那辆旧自行车。(Tā shě bu de mài diào nà liàng jiù zì xíng chē.) '
        + 'She cannot bear to sell that old bicycle.\n\n'
        + 'The mistake to avoid: 舍不得 needs something being lost or left behind. '
        + 'For "I do not want to go today", use 不想 — nothing is being given up.',
    },
  ],
};

// Two articles in the archive, since keeping them is the point of it: the one
// on screen, and an older one that was searched for by topic.
const HISTORY = [
  { id: 'shot2', generatedAt: now - 2 * 60 * 60 * 1000, data: DIGEST },
  { id: 'shot1', generatedAt: now - 27 * 60 * 60 * 1000, data: OLDER_DIGEST },
];

const seed = (extra = {}) => JSON.stringify({
  wordlist: WORDLIST,
  newsHistory: HISTORY,
  newsCategories: { fetchedAt: now - 60 * 60 * 1000, items: CATEGORIES },
  newsDifficulty: 'normal',
  tutorChatLog: [CHAT],
  // The tutor answers on a private token, so seed one or the drawer shows its
  // "turn this on" panel instead of a conversation.
  syncMeta: { token: 'screenshotscreenshotscreenshot', serverUrl: base, cursor: 0, lastPushAt: 0 },
  hanziPref: 'simp-first',
  tutorOpen: false,
  ...extra,
});

// --- taking the pictures ----------------------------------------------------

const WIDE = { width: 1180, height: 720 };
const shots = [];

async function shoot(page, name, prepare, size = WIDE, extra = {}) {
  const tab = await openPage(page);
  // The page reads storage as its modules evaluate, so seed it and load again —
  // the shim keeps the fake storage across a reload, exactly as the real one
  // would.
  await tab.evalJs(`chrome.storage.local.set(${seed(extra)})`);
  await tab.evalJs('chrome.storage.sync.set({ hanziPref: "simp-first" })');
  await tab.setViewport(size.width, size.height, 2);
  // Stamp the outgoing document before reloading. A reload does not commit
  // synchronously, so `prepare`'s first wait can be satisfied by the page that
  // is on its way out — and the line after it then runs against the new one
  // before it has a <body>, which is a null-property crash rather than a wait.
  await tab.evalJs('window.__stale = true');
  await tab.evalJs('location.reload()');
  await tab.waitFor('!window.__stale && !!document.body', 'the reloaded page');
  await prepare(tab);
  await tab.settle();
  const file = join(outDir, `${name}.png`);
  writeFileSync(file, Buffer.from(await tab.png(), 'base64'));
  shots.push(`${name}.png  ${(readFileSync(file).length / 1024).toFixed(0)}KB`);
  tab.close();
}

// The review card, answer showing: reading, gloss, the example sentence, and
// what each grade would do to the schedule.
await shoot('review.html', 'review', async (tab) => {
  await tab.waitFor('!!document.getElementById("reveal")', 'a card');
  await tab.evalJs('document.getElementById("reveal").click()');
  await tab.waitFor('!!document.querySelector(".grade")', 'the grade buttons');
});

// The library: every saved card, where each one is on the curve, and the
// forecast for the next three weeks.
await shoot('wordlist.html', 'library', async (tab) => {
  await tab.waitFor('document.querySelectorAll("#list tbody tr").length > 5', 'the rows');
}, WIDE);

// The hover popup on an ordinary web page — the thing the extension is for.
// The page is the smoke test's fixture with a few paragraphs written into it:
// the content script that reads it is the shipped one, hit-testing the
// character actually under the cursor.
const ARTICLE = `
  <h1 style="font:600 30px/1.5 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
             margin:0 0 18px">周末去哪儿</h1>
  <p id="a">这个周末我打算去看一场电影，顺便在附近的书店坐一会儿。</p>
  <p>朋友说那家书店的咖啡不错，可是我更喜欢他们的旧书区。</p>`;

await shoot('__page', 'popup', async (tab) => {
  await tab.waitFor('!!document.getElementById("t")', 'the page');
  await tab.evalJs(`(() => {
    document.body.style.cssText =
      'margin:0;padding:56px 64px;max-width:760px;font-size:27px;line-height:2.1;'
      + 'font-family:"PingFang SC","Hiragino Sans GB","Noto Sans CJK SC",serif';
    document.getElementById('t').insertAdjacentHTML('beforebegin', ${JSON.stringify(ARTICLE)});
    document.getElementById('t').remove();
  })()`);
  await tab.settle();
  // 打算 — the fifth and sixth characters of the first paragraph.
  const at = await tab.evalJs(`(() => {
    const r = document.createRange();
    r.setStart(document.getElementById('a').firstChild, 5);
    r.setEnd(document.getElementById('a').firstChild, 6);
    const b = r.getClientRects()[0];
    return { x: Math.round(b.left + b.width / 2), y: Math.round(b.top + b.height / 2) };
  })()`);
  await tab.moveMouseTo(at.x, at.y);
  await tab.waitForPopup(/Example sentences|Characters/);
}, { width: 940, height: 700 });

// The guides, and the tutor beside them: a column of the app, with a
// conversation already in it.
await shoot('hsk.html', 'tutor', async (tab) => {
  await tab.waitFor('!!document.querySelector(".passage")', 'a guide');
  await tab.evalJs('document.getElementById("tutorToggle").click()');
  await tab.waitFor('document.querySelectorAll(".tutor .msg .bubble").length > 1',
    'the conversation');
  await tab.waitFor('document.querySelector(".tutor").getAnimations().length === 0',
    'the drawer to settle');
});

// The generated news passage, with the stretch vocabulary under it.
await shoot('news.html', 'news', async (tab) => {
  await tab.waitFor('!!document.querySelector(".article p")', 'the passage');
});

// The archive: every article the page has written, under the day it wrote it.
await shoot('news.html', 'news-history', async (tab) => {
  await tab.waitFor('!!document.querySelector(".article p")', 'the passage');
  await tab.evalJs('document.getElementById("history").click()');
  await tab.waitFor('document.querySelectorAll(".past").length > 1', 'the archive');
});

// The dashboard the New Tab page opens to.
await shoot('newtab.html', 'dashboard', async (tab) => {
  await tab.waitFor(`(() => {
    const f = document.getElementById('reviewFrame');
    return !!f.contentDocument?.querySelector('.card');
  })()`, 'the review frame');
});

console.log(shots.join('\n'));
console.log(`\n${shots.length} screenshots -> docs/shots/`);
process.exit(0);
