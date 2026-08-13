// The client half of card translation: which cards get sent, what happens when
// a request fails, and what the rewritten back reads.
// Run: node tests/translate-sweep.test.mjs

import assert from 'node:assert/strict';
import {
  MAX_PER_SWEEP, translationBack, isPermanent, translateGlossed,
} from '../extension/lib/translate.js';

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

const glossed = (simp, extra = {}) => ({
  cardType: 'sentence', simp, trad: simp, pinyin: '', defs: 'a · gloss',
  glossed: true, lastSavedAt: 1000, ...extra,
});

// Collects the patches a sweep makes, keyed by the card it touched.
function recorder(cards) {
  const patches = new Map();
  return {
    patches,
    patch: async (card, changes) => {
      patches.set(card.simp, { ...(patches.get(card.simp) || {}), ...changes });
      Object.assign(cards.find((c) => c.simp === card.simp) || {}, changes);
      return true;
    },
  };
}

const isGloss = (card) => !!card.glossed;

await test('a natural translation becomes the card back', () => {
  assert.equal(
    translationBack({ translation: 'I watched the movie twice.', literal: '' }),
    'I watched the movie twice.');
});

await test('a differing literal rendering rides along', () => {
  assert.equal(
    translationBack({ translation: 'I watched the movie twice.', literal: 'watch two times movie' }),
    'I watched the movie twice.  (literally: watch two times movie)');
});

await test('a literal identical to the translation is dropped as noise', () => {
  assert.equal(translationBack({ translation: 'He is tall.', literal: 'He is tall.' }),
    'He is tall.');
});

await test('4xx is permanent, 429 and 5xx are not', () => {
  assert.equal(isPermanent(400), true);
  assert.equal(isPermanent(413), true);
  assert.equal(isPermanent(422), true);
  assert.equal(isPermanent(503), false);
  assert.equal(isPermanent(429), false, 'a rate limit is about timing, not the text');
  assert.equal(isPermanent(500), false);
});

// A server older than the extension answers /api/translate with 404, and an
// expired pairing answers 401. Neither is a statement about the Chinese, so
// neither may retire the card from future sweeps.
await test('a missing endpoint or a rejected token is not the text\'s fault', () => {
  assert.equal(isPermanent(404), false, 'a server without /api/translate will get one');
  assert.equal(isPermanent(401), false, 'a token can be re-paired');
  assert.equal(isPermanent(403), false);
  assert.equal(isPermanent(405), false);
});

await test('translates every glossed card and rewrites its back', async () => {
  const cards = [glossed('看了两次电影。'), glossed('我们明天见。')];
  const { patch, patches } = recorder(cards);
  const result = await translateGlossed({
    cards,
    isGloss,
    patch,
    request: async (text) => ({ translation: `EN(${text})`, literal: '' }),
    now: () => 5000,
  });
  assert.equal(result.translated, 2);
  assert.equal(patches.get('看了两次电影。').defs, 'EN(看了两次电影。)');
  assert.equal(patches.get('看了两次电影。').glossed, false);
  // Content changed, so it has to outrank the glossed copy on another device.
  assert.equal(patches.get('看了两次电影。').lastSavedAt, 5000);
});

await test('leaves cards that already have a real translation alone', async () => {
  const cards = [
    glossed('看了两次电影。'),
    { cardType: 'sentence', simp: '我们明天见。', defs: 'See you tomorrow.' },
    { cardType: 'word', simp: '老师', defs: 'teacher' },
  ];
  const { patch, patches } = recorder(cards);
  const asked = [];
  await translateGlossed({
    cards, isGloss, patch, request: async (t) => { asked.push(t); return { translation: 'x' }; },
  });
  assert.deepEqual(asked, ['看了两次电影。']);
  assert.equal(patches.size, 1);
});

await test('a transient failure stops the sweep with everything still pending', async () => {
  const cards = [glossed('第一句。'), glossed('第二句。'), glossed('第三句。')];
  const { patch, patches } = recorder(cards);
  let calls = 0;
  const result = await translateGlossed({
    cards,
    isGloss,
    patch,
    request: async (text) => {
      calls++;
      if (calls === 2) throw Object.assign(new Error('rate limited'), { permanent: false });
      return { translation: `EN(${text})` };
    },
  });
  assert.equal(result.translated, 1);
  assert.equal(result.stopped, 'transient');
  assert.equal(calls, 2, 'the sweep kept going after a transient failure');
  assert.equal(patches.has('第三句。'), false, 'the third card must stay pending');
  assert.equal(cards[2].glossed, true);
});

await test('a permanent failure is remembered and the sweep continues', async () => {
  const cards = [glossed('第一句。'), glossed('第二句。')];
  const { patch, patches } = recorder(cards);
  const result = await translateGlossed({
    cards,
    isGloss,
    patch,
    request: async (text) => {
      if (text === '第一句。') throw Object.assign(new Error('not Chinese'), { permanent: true });
      return { translation: 'EN' };
    },
  });
  assert.equal(result.failed, 1);
  assert.equal(result.translated, 1, 'one bad card stopped the rest');
  assert.equal(patches.get('第一句。').translateFailed, true);
  assert.equal(patches.get('第一句。').defs, undefined, 'the gloss must survive a refusal');
});

await test('a card that failed permanently is never retried', async () => {
  const cards = [glossed('第一句。', { translateFailed: true }), glossed('第二句。')];
  const { patch } = recorder(cards);
  const asked = [];
  await translateGlossed({
    cards, isGloss, patch, request: async (t) => { asked.push(t); return { translation: 'EN' }; },
  });
  assert.deepEqual(asked, ['第二句。']);
});

await test('an empty translation leaves the gloss in place', async () => {
  const cards = [glossed('啊啊啊。')];
  const { patch, patches } = recorder(cards);
  const result = await translateGlossed({
    cards, isGloss, patch, request: async () => ({ translation: '   ', literal: '' }),
  });
  assert.equal(result.translated, 0);
  assert.equal(result.failed, 1);
  assert.equal(patches.get('啊啊啊。').defs, undefined, 'an empty back replaced the gloss');
  assert.equal(cards[0].defs, 'a · gloss');
});

await test('one sweep is bounded, so a large import cannot run away', async () => {
  const cards = Array.from({ length: 40 }, (_, i) => glossed(`第${i}句。`));
  const { patch } = recorder(cards);
  let calls = 0;
  const result = await translateGlossed({
    cards, isGloss, patch, request: async () => { calls++; return { translation: 'EN' }; },
  });
  assert.equal(calls, MAX_PER_SWEEP);
  assert.equal(result.translated, MAX_PER_SWEEP);
});

if (failures.length) {
  console.error(`\n${failures.length} failing check(s):\n`);
  for (const f of failures) console.error(`  ✗ ${f}\n`);
  process.exit(1);
}
console.log(`translate-sweep.test.mjs: ${passed} tests passed`);
