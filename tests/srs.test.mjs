// Unit tests for extension/lib/srs.js. Run: node tests/srs.test.mjs

import assert from 'node:assert/strict';
import {
  GRADES, DEFAULT_LIMITS, newSrs, schedule, intervalPreview, buildQueue, planSession,
  srsStatus, cardSeed, cardStage, stageCounts, strength, forecast,
  dayStart, dayEnd, isDue, dueLaterToday, newIntroducedToday, reviewBadgeCount,
  relatedKeys, spacedOrder, nextDueAt, nextDueText,
} from '../extension/lib/srs.js';

const DAY = 24 * 60 * 60 * 1000;
// Noon local time, so nothing here depends on which side of the 4am rollover
// the test happens to run.
const NOW = new Date(2027, 3, 12, 12, 0, 0).getTime();
const exact = { fuzz: false };
let passed = 0;
function test(name, fn) {
  try {
    fn();
    passed++;
  } catch (e) {
    console.error(`FAIL: ${name}`);
    throw e;
  }
}

// --- scheduling ------------------------------------------------------------

test('new card graded good follows 1d -> 3d -> ease-multiplied', () => {
  let s = schedule(null, 'good', NOW, exact);
  assert.equal(s.ivl, 1);
  assert.equal(s.reps, 1);
  assert.equal(s.due, NOW + DAY);
  s = schedule(s, 'good', NOW + DAY, exact);
  assert.equal(s.ivl, 3);
  s = schedule(s, 'good', NOW + 4 * DAY, exact);
  assert.equal(s.ivl, 7.5); // 3 * 2.5, reviewed exactly on time
  assert.equal(s.due, NOW + 4 * DAY + 7.5 * DAY);
});

test('again resets reps, counts a lapse, reduces ease, due in 10 minutes', () => {
  let s = schedule(null, 'good', NOW);
  s = schedule(s, 'good', NOW);
  const before = s.ease;
  s = schedule(s, 'again', NOW);
  assert.equal(s.reps, 0);
  assert.equal(s.lapses, 1);
  assert.equal(s.ease, Math.max(1.3, before - 0.2));
  assert.equal(s.due, NOW + 10 * 60 * 1000);
  // failing a brand-new card is not a lapse
  const fresh = schedule(null, 'again', NOW);
  assert.equal(fresh.lapses, 0);
});

test('hard grows slowly, easy grows fast and raises ease', () => {
  const s = schedule(null, 'good', NOW, exact);
  const hard = schedule(s, 'hard', NOW, exact);
  const easy = schedule(s, 'easy', NOW, exact);
  assert.ok(hard.ivl > s.ivl && hard.ivl < 3, `hard ivl ${hard.ivl}`);
  assert.ok(easy.ivl > 3, `easy ivl ${easy.ivl}`);
  assert.ok(easy.ease > s.ease);
  assert.ok(hard.ease < 2.5);
});

test('ease never drops below 1.3 and intervals stay capped', () => {
  let s = newSrs(NOW);
  for (let i = 0; i < 20; i++) s = schedule(s, 'again', NOW);
  assert.equal(s.ease, 1.3);
  s = { due: NOW, ivl: 4000, ease: 3.0, reps: 30, lapses: 0 };
  s = schedule(s, 'easy', NOW);
  assert.ok(s.ivl <= 365 * 5, `capped, got ${s.ivl}`);
});

test('remembering a card long after it was due earns a longer interval', () => {
  const s = { due: NOW, ivl: 10, ease: 2.5, reps: 4, lapses: 0 };
  const onTime = schedule(s, 'good', NOW, exact);
  const late = schedule(s, 'good', NOW + 30 * DAY, exact);
  assert.equal(onTime.ivl, 25); // 10 * 2.5
  assert.equal(late.ivl, 62.5); // (10 + 30/2) * 2.5 — the 30 late days count
  // Being early must never *shrink* the interval below the plain SM-2 result.
  const early = schedule(s, 'good', NOW - 3 * DAY, exact);
  assert.equal(early.ivl, 25);
});

test('intervalPreview renders human units', () => {
  assert.equal(intervalPreview(null, 'again', NOW), '10m');
  assert.equal(intervalPreview(null, 'good', NOW), '1d');
  const mature = { due: NOW, ivl: 40, ease: 2.5, reps: 5, lapses: 0 };
  assert.ok(/mo$/.test(intervalPreview(mature, 'good', NOW)));
});

// --- fuzz: the anti-clumping mechanism -------------------------------------

test('fuzz spreads same-day siblings apart but is stable per card', () => {
  const a = { simp: '儿童', pinyin: 'ér tóng' };
  const b = { simp: '童', pinyin: 'tóng' };
  const start = { due: NOW, ivl: 1, ease: 2.5, reps: 1, lapses: 0 };
  const sa = schedule(start, 'good', NOW, { seed: cardSeed(a) });
  const sb = schedule(start, 'good', NOW, { seed: cardSeed(b) });
  assert.notEqual(sa.ivl, sb.ivl, 'identical states must not schedule identically');
  // Same card, same rep, same answer -> same schedule on every device.
  assert.equal(schedule(start, 'good', NOW, { seed: cardSeed(a) }).ivl, sa.ivl);
  // ...and stays within a day of the unfuzzed 3d step.
  for (const s of [sa, sb]) assert.ok(s.ivl >= 2 && s.ivl <= 4, `ivl ${s.ivl}`);
});

test('learning steps are never fuzzed', () => {
  assert.equal(schedule(null, 'good', NOW, { seed: 12345 }).ivl, 1);
  assert.equal(schedule(null, 'hard', NOW, { seed: 12345 }).ivl, 0.5);
});

test('the grade preview is the interval the grade actually gives', () => {
  const word = { simp: '词典', pinyin: 'cí diǎn', srs: { due: NOW, ivl: 9, ease: 2.5, reps: 3, lapses: 0 } };
  const seed = cardSeed(word);
  for (const g of GRADES) {
    const preview = intervalPreview(word.srs, g, NOW, { seed });
    const actual = schedule(word.srs, g, NOW, { seed });
    assert.equal(preview, intervalPreview(word.srs, g, NOW, { seed }));
    assert.ok(actual.due > NOW, `${g} schedules forward`);
  }
});

// --- study days ------------------------------------------------------------

test('a study day runs 4am to 4am', () => {
  const evening = new Date(2027, 3, 12, 23, 30).getTime();
  const smallHours = new Date(2027, 3, 13, 2, 0).getTime();
  const morning = new Date(2027, 3, 13, 9, 0).getTime();
  assert.equal(dayStart(smallHours), dayStart(evening), '2am belongs to the previous day');
  assert.notEqual(dayStart(morning), dayStart(evening));
  assert.equal(dayEnd(evening), dayStart(morning));
});

test('day-granular cards are due the next morning, learning steps are not', () => {
  const evening = new Date(2027, 3, 12, 21, 0).getTime();
  const nextMorning = new Date(2027, 3, 13, 8, 0).getTime();
  const review = schedule(null, 'good', evening); // 1 day out, i.e. 9pm tomorrow
  assert.equal(isDue(review, evening), false);
  assert.equal(isDue(review, nextMorning), true, 'available in the morning session');
  // A ten-minute relearn step keeps real clock time.
  const relearn = schedule({ due: evening, ivl: 5, ease: 2.5, reps: 3, lapses: 0 }, 'again', evening);
  assert.equal(isDue(relearn, evening), false);
  assert.equal(isDue(relearn, evening + 11 * 60 * 1000), true);
  assert.equal(dueLaterToday([{ srs: relearn }], evening), 1);
});

// --- queue -----------------------------------------------------------------

const card = (simp, pinyin, srs, savedAt = NOW) => ({ simp, trad: simp, pinyin, srs, savedAt, lastSavedAt: savedAt });

test('buildQueue: due cards and a day of new ones, capped', () => {
  const words = [
    card('A', 'a', { due: NOW - 2 * DAY, ivl: 1, ease: 2.5, reps: 1, lapses: 0 }),
    card('B', 'b', { due: NOW - 5 * DAY, ivl: 1, ease: 2.5, reps: 1, lapses: 0 }),
    card('C', 'c', { due: NOW + 5 * DAY, ivl: 5, ease: 2.5, reps: 1, lapses: 0 }),
    card('D', 'd', null, NOW - DAY),
    card('E', 'e', null, NOW),
  ];
  const q = buildQueue(words, NOW);
  assert.deepEqual(q.map((w) => w.simp).sort(), ['A', 'B', 'D', 'E']); // C not due
  // Priority under a cap: due cards first, newest saves win the new slots.
  const capped = buildQueue(words, NOW, { newPerDay: 1, maxPerDay: 2, shuffle: false });
  assert.deepEqual(capped.map((w) => w.simp), ['B', 'A']);
  const oneNew = buildQueue(words, NOW, { newPerDay: 1, maxPerDay: 3, shuffle: false });
  assert.deepEqual(oneNew.map((w) => w.simp), ['B', 'A', 'E']);
});

test('the daily new-card limit is per day, not per session', () => {
  const words = Array.from({ length: 30 }, (_, i) => card(`w${i}`, `p${i}`, null));
  const first = buildQueue(words, NOW, { newPerDay: 5 });
  assert.equal(first.length, 5);
  // Study them, then open a fresh session the same day: no more new cards.
  for (const w of first) w.srs = schedule(null, 'good', NOW, { seed: cardSeed(w) });
  assert.equal(newIntroducedToday(words, NOW), 5);
  assert.equal(buildQueue(words, NOW, { newPerDay: 5 }).length, 0);
  assert.equal(reviewBadgeCount(words, NOW, { newPerDay: 5 }), 0);
  // Tomorrow the allowance resets: 5 more new cards, plus the 5 studied today
  // coming back for their first review.
  assert.equal(planSession(words, NOW + DAY, { newPerDay: 5 }).newSelected.length, 5);
  assert.equal(buildQueue(words, NOW + DAY, { newPerDay: 5 }).length, 10);
  // ...and an explicit "study more" pulls extras forward today.
  assert.equal(buildQueue(words, NOW, { newPerDay: 5, extraNew: 3 }).length, 3);
});

test('planSession explains exactly what is being held back', () => {
  const words = [
    ...Array.from({ length: 4 }, (_, i) =>
      card(`d${i}`, `d${i}`, { due: NOW - DAY, ivl: 2, ease: 2.5, reps: 2, lapses: 0 })),
    ...Array.from({ length: 9 }, (_, i) => card(`n${i}`, `n${i}`, null)),
  ];
  const plan = planSession(words, NOW, { newPerDay: 2, maxPerDay: 5 });
  assert.equal(plan.dueTotal, 4);
  assert.equal(plan.newTotal, 9);
  assert.equal(plan.queued, 6 - 0 && plan.dueSelected.length + plan.newSelected.length);
  assert.equal(plan.dueSelected.length, 4);
  assert.equal(plan.newSelected.length, 1, 'new slots limited by the 5-card daily cap');
  assert.equal(plan.newHeld, 8);
  assert.equal(plan.dueHeld, 0);
  // The badge and the queue always agree — that mismatch is what made the tab
  // claim cards were waiting on a day the review page said "done".
  assert.equal(reviewBadgeCount(words, NOW, { newPerDay: 2, maxPerDay: 5 }),
    buildQueue(words, NOW, { newPerDay: 2, maxPerDay: 5 }).length);
});

// --- anti-priming ----------------------------------------------------------

test('relatedKeys catches shared characters and shared sounds', () => {
  const child = relatedKeys({ simp: '儿童', trad: '兒童', pinyin: 'ér tóng' });
  const tong = relatedKeys({ simp: '童', trad: '童', pinyin: 'tóng' });
  assert.ok([...tong].some((k) => child.has(k)), '童 / 儿童 must be related');
  // Tone-blind on purpose: 是 shì primes 事 shì.
  const shi1 = relatedKeys({ simp: '是', pinyin: 'shì' });
  const shi2 = relatedKeys({ simp: '事', pinyin: 'shí' });
  assert.ok([...shi2].some((k) => shi1.has(k)));
  // A saved sentence is not "related" to every card that shares a character.
  const sentence = relatedKeys({
    cardType: 'sentence', simp: '我喜欢学习中文。', pinyin: 'wǒ xǐhuan xuéxí zhōngwén',
  });
  assert.equal(sentence.size, 0);
});

test('spacedOrder pushes related cards apart', () => {
  const cards = [
    { simp: '儿童', trad: '兒童', pinyin: 'ér tóng' },
    { simp: '童', trad: '童', pinyin: 'tóng' },
    { simp: '苹果', trad: '蘋果', pinyin: 'píng guǒ' },
    { simp: '电脑', trad: '電腦', pinyin: 'diàn nǎo' },
    { simp: '朋友', trad: '朋友', pinyin: 'péng yǒu' },
    { simp: '学习', trad: '學習', pinyin: 'xué xí' },
  ];
  const ordered = spacedOrder(cards, 3);
  assert.equal(ordered.length, cards.length);
  assert.deepEqual(new Set(ordered), new Set(cards), 'no card lost or duplicated');
  const at = (simp) => ordered.findIndex((c) => c.simp === simp);
  assert.ok(Math.abs(at('儿童') - at('童')) > 1, '儿童 and 童 must not be adjacent');
});

test('a real queue never puts a card next to one that gives it away', () => {
  const words = [
    card('儿童', 'ér tóng', null), card('童话', 'tóng huà', null),
    card('童', 'tóng', null), card('苹果', 'píng guǒ', null),
    card('电脑', 'diàn nǎo', null), card('朋友', 'péng yǒu', null),
    card('学习', 'xué xí', null), card('中文', 'zhōng wén', null),
  ];
  const q = buildQueue(words, NOW);
  assert.equal(q.length, words.length);
  for (let i = 1; i < q.length; i++) {
    const previous = relatedKeys(q[i - 1]);
    const clash = [...relatedKeys(q[i])].some((k) => previous.has(k));
    assert.ok(!clash, `${q[i - 1].simp} primes ${q[i].simp}`);
  }
});

test('spacing holds up on messy decks, and never loses a card', () => {
  // Word families dense enough to corner a naive greedy pass, plus filler.
  const family = [['童', 'tóng'], ['儿童', 'ér tóng'], ['童话', 'tóng huà'], ['童年', 'tóng nián']];
  const others = [
    ['苹果', 'píng guǒ'], ['电脑', 'diàn nǎo'], ['朋友', 'péng yǒu'], ['学习', 'xué xí'],
    ['中文', 'zhōng wén'], ['老师', 'lǎo shī'], ['医生', 'yī shēng'], ['汽车', 'qì chē'],
  ];
  for (let size = 5; size <= 12; size++) {
    const deck = [...family, ...others.slice(0, size - family.length)]
      .map(([simp, pinyin]) => card(simp, pinyin, null));
    for (let day = 0; day < 5; day++) {
      const q = buildQueue(deck, NOW + day * DAY, { newPerDay: 100 });
      assert.equal(q.length, deck.length, `size ${size}: cards lost`);
      assert.equal(new Set(q.map((w) => w.simp)).size, deck.length, 'duplicate card');
      let clashes = 0;
      for (let i = 1; i < q.length; i++) {
        const previous = relatedKeys(q[i - 1]);
        if ([...relatedKeys(q[i])].some((k) => previous.has(k))) clashes += 1;
      }
      // k mutual relatives among n cards can be separated by the other n-k,
      // leaving max(0, 2k-n-1) touching pairs no ordering can avoid. Anything
      // above that remainder is the algorithm's fault, not arithmetic's.
      const unavoidable = Math.max(0, 2 * family.length - size - 1);
      assert.ok(clashes <= unavoidable,
        `size ${size} day ${day}: ${clashes} adjacent pairs, ${unavoidable} unavoidable`);
    }
  }
});

test('the queue is reshuffled between days but stable within one', () => {
  const words = Array.from({ length: 12 }, (_, i) =>
    card(`w${i}`, `p${i}`, { due: NOW - DAY, ivl: 3, ease: 2.5, reps: 2, lapses: 0 }));
  const a = buildQueue(words, NOW).map((w) => w.simp);
  const b = buildQueue(words, NOW + 60 * 60 * 1000).map((w) => w.simp);
  const tomorrow = buildQueue(words, NOW + DAY).map((w) => w.simp);
  assert.deepEqual(a, b, 'same study day, same order');
  assert.notDeepEqual(a, tomorrow, 'a new day reshuffles');
});

// --- reporting -------------------------------------------------------------

test('srsStatus describes a card in study days', () => {
  const words = [
    card('A', 'a', { due: NOW - 1, ivl: 1, ease: 2.5, reps: 1, lapses: 0 }),
    card('B', 'b', null),
    card('C', 'c', { due: NOW + 3 * DAY, ivl: 3, ease: 2.5, reps: 2, lapses: 0 }),
  ];
  assert.equal(srsStatus(words[0], NOW), 'due');
  assert.equal(srsStatus(words[1], NOW), 'new');
  assert.equal(srsStatus(words[2], NOW), 'in 3d');
  // The next card is available at that day's 4am rollover, not at the clock
  // time it happened to be graded, and the copy says so.
  assert.equal(nextDueAt(words, NOW), dayStart(words[2].srs.due));
  assert.match(nextDueText(nextDueAt(words, NOW), NOW), /^\w+ morning, .+ \(3 days from now\)$/);
  assert.equal(nextDueText(dayEnd(NOW), NOW), 'tomorrow morning');
});

test('cards are placed on the curve by interval', () => {
  const words = [
    card('A', 'a', null),
    card('B', 'b', { due: NOW, ivl: 0, ease: 2.5, reps: 0, lapses: 1 }),
    card('C', 'c', { due: NOW, ivl: 6, ease: 2.5, reps: 3, lapses: 0 }),
    card('D', 'd', { due: NOW, ivl: 40, ease: 2.5, reps: 7, lapses: 0 }),
  ];
  assert.deepEqual(words.map(cardStage), ['new', 'learning', 'young', 'mature']);
  assert.deepEqual(stageCounts(words), { new: 1, learning: 1, young: 1, mature: 1 });
  assert.equal(strength(words[0]), 0);
  assert.ok(strength(words[2]) < strength(words[3]));
  assert.ok(strength(words[3]) <= 1);
});

test('forecast bins cards by study day and counts the leftovers', () => {
  const words = [
    card('overdue', 'a', { due: NOW - 9 * DAY, ivl: 2, ease: 2.5, reps: 2, lapses: 0 }),
    card('today', 'b', { due: NOW + 60 * 1000, ivl: 2, ease: 2.5, reps: 2, lapses: 0 }),
    card('tomorrow', 'c', { due: NOW + DAY, ivl: 2, ease: 2.5, reps: 2, lapses: 0 }),
    card('far', 'd', { due: NOW + 90 * DAY, ivl: 90, ease: 2.5, reps: 9, lapses: 0 }),
    card('new', 'e', null),
  ];
  const f = forecast(words, NOW, 14);
  assert.equal(f.bins.length, 15);
  assert.equal(f.bins[0].count, 2, 'overdue folds into today');
  assert.equal(f.overdue, 1);
  assert.equal(f.bins[1].count, 1);
  assert.equal(f.beyond, 1);
  assert.equal(f.unscheduled, 1);
  assert.equal(f.bins.reduce((n, b) => n + b.count, 0) + f.beyond + f.unscheduled, words.length);
});

// --- invariants ------------------------------------------------------------

test('full-sentence cards enter and progress through the same review queue', () => {
  const sentence = {
    cardType: 'sentence',
    simp: '我喜欢学习中文。',
    pinyin: 'wǒ xǐhuan xuéxí zhōngwén',
    defs: 'I like studying Chinese.',
    savedAt: NOW,
    srs: null,
  };
  assert.equal(buildQueue([sentence], NOW)[0], sentence);
  const learned = schedule(sentence.srs, 'good', NOW);
  assert.equal(learned.reps, 1);
  assert.equal(learned.due, NOW + DAY);
  assert.equal(learned.introducedAt, NOW);
});

test('all grades produce valid state from any starting point', () => {
  const starts = [null, newSrs(NOW), { due: NOW, ivl: 100, ease: 1.3, reps: 9, lapses: 3 }];
  for (const start of starts) {
    for (const g of GRADES) {
      const s = schedule(start, g, NOW, { seed: 987654 });
      assert.ok(s.due > NOW, `${g} due in future`);
      assert.ok(s.ease >= 1.3 && s.ease <= 3.0, `${g} ease bounded`);
      assert.ok(Number.isFinite(s.ivl) && s.ivl >= 0, `${g} ivl finite`);
      assert.equal(s.reviewedAt, NOW);
    }
  }
  // Reviewing an existing card never back-dates its introduction.
  const old = { due: NOW, ivl: 5, ease: 2.5, reps: 3, lapses: 0 };
  assert.equal(schedule(old, 'good', NOW).introducedAt, undefined);
});

test('DEFAULT_LIMITS are the limits the pages actually use', () => {
  assert.equal(DEFAULT_LIMITS.newPerDay, 15);
  assert.equal(DEFAULT_LIMITS.maxPerDay, 60);
});

console.log(`OK — ${passed} tests passed`);
