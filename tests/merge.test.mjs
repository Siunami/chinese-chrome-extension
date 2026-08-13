// Unit tests for extension/lib/merge.js. Run: node tests/merge.test.mjs

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  cardKey, aliveClock, tombstoneFor, mergeCards, changedSince, applyRemote,
  capCards,
} from '../extension/lib/merge.js';
import { schedule } from '../extension/lib/srs.js';

const NOW = 1_800_000_000_000;
const MIN = 60 * 1000;
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

function card(over = {}) {
  return {
    cardType: 'word',
    simp: '喜欢',
    trad: '喜歡',
    pinyin: 'xǐ huan',
    tones: '3,0',
    defs: 'to like; to be fond of',
    savedAt: NOW,
    lastSavedAt: NOW,
    touches: 1,
    srs: null,
    sourceWord: '',
    ...over,
  };
}

test('cardKey matches save identity: trad distinguishes homographs, missing trad = simp', () => {
  const face = card({ simp: '面', trad: '面', pinyin: 'miàn' });
  const noodles = card({ simp: '面', trad: '麵', pinyin: 'miàn' });
  assert.notEqual(cardKey(face), cardKey(noodles));
  // missing trad is treated as equal to simp (legacy entries)...
  assert.equal(
    cardKey({ simp: 'A', pinyin: 'a' }),
    cardKey({ cardType: 'word', simp: 'A', trad: 'A', pinyin: 'a' }),
  );
  // ...which matches handleSaveWord: an explicit different trad stays distinct
  assert.notEqual(cardKey(card({ trad: '' })), cardKey(card({ trad: '喜歡' })));
});

test('mergeCards is commutative and idempotent', () => {
  const a = card({ lastSavedAt: NOW + 5, touches: 3, defs: 'newer def' });
  const b = card({ srs: schedule(null, 'good', NOW + 2) });
  const ab = mergeCards(a, b);
  const ba = mergeCards(b, a);
  assert.deepEqual(ab, ba);
  assert.deepEqual(mergeCards(ab, ab), ab);
  assert.deepEqual(mergeCards(a, null), a);
  assert.deepEqual(mergeCards(null, b), b);
});

test('review on one device and re-save on the other both survive', () => {
  const reviewed = card({ srs: schedule(null, 'good', NOW + MIN) });
  const resaved = card({
    lastSavedAt: NOW + 2 * MIN, touches: 2, defs: 'refreshed def',
  });
  const m = mergeCards(reviewed, resaved);
  assert.equal(m.defs, 'refreshed def');
  assert.equal(m.touches, 2);
  assert.equal(m.lastSavedAt, NOW + 2 * MIN);
  assert.equal(m.srs.reps, 1); // review kept even though content lost LWW
  assert.equal(m.srs.reviewedAt, NOW + MIN);
});

test('later review wins the srs group wholesale', () => {
  const early = card({ srs: schedule(null, 'easy', NOW) });
  const late = card({ srs: schedule(schedule(null, 'good', NOW), 'again', NOW + MIN) });
  const m = mergeCards(early, late);
  assert.deepEqual(m.srs, late.srs); // whole object, no field mixing
});

test('non-null srs beats null; legacy srs without reviewedAt: more reps wins', () => {
  const withSrs = card({ srs: { due: NOW, ivl: 1, ease: 2.5, reps: 1, lapses: 0 } });
  assert.deepEqual(mergeCards(card(), withSrs).srs, withSrs.srs);
  const legacy2 = card({ srs: { due: NOW, ivl: 3, ease: 2.5, reps: 2, lapses: 0 } });
  assert.deepEqual(mergeCards(withSrs, legacy2).srs, legacy2.srs);
});

test('deletion wins only over cards untouched since; later activity resurrects', () => {
  const c = card({ srs: schedule(null, 'good', NOW) });
  const dead = tombstoneFor(c, NOW + MIN); // deleted after last touch
  assert.equal(mergeCards(c, dead).deleted, true);
  assert.equal(mergeCards(dead, c).deleted, true);
  // ...but a review after the deletion resurrects the card
  const reviewedLater = card({ srs: schedule(null, 'good', NOW + 2 * MIN) });
  assert.ok(!mergeCards(dead, reviewedLater).deleted);
  // ...and a re-save after the deletion resurrects too
  const resavedLater = card({ lastSavedAt: NOW + 2 * MIN });
  assert.ok(!mergeCards(dead, resavedLater).deleted);
  // two tombstones: later deletedAt kept
  const dead2 = tombstoneFor(c, NOW + 3 * MIN);
  assert.equal(mergeCards(dead, dead2).deletedAt, NOW + 3 * MIN);
});

test('savedAt keeps true creation time, touches is monotone max', () => {
  const a = card({ savedAt: NOW - 10, touches: 5 });
  const b = card({ savedAt: NOW - 3, lastSavedAt: NOW + 1, touches: 2 });
  const m = mergeCards(a, b);
  assert.equal(m.savedAt, NOW - 10);
  assert.equal(m.touches, 5);
  assert.equal(m.lastSavedAt, NOW + 1);
  // zero/missing savedAt on one side falls back to the other
  assert.equal(mergeCards(card({ savedAt: 0 }), card()).savedAt, NOW);
});

test('schedule() stamps reviewedAt so merge can order reviews', () => {
  const s = schedule(null, 'good', NOW);
  assert.equal(s.reviewedAt, NOW);
  assert.equal(aliveClock({ lastSavedAt: NOW - 5, srs: s }), NOW);
});

test('changedSince picks up saves, reviews, and tombstones after the cursor', () => {
  const untouched = card();
  const saved = card({ simp: '新', lastSavedAt: NOW + MIN });
  const reviewed = card({ simp: '旧', srs: schedule(null, 'good', NOW + 2 * MIN) });
  const dead = tombstoneFor(card({ simp: '死' }), NOW + MIN);
  const out = changedSince([untouched, saved, reviewed], [dead], NOW);
  assert.deepEqual(out.map((c) => c.simp).sort(), ['新', '旧', '死'].sort());
  assert.equal(changedSince([untouched], [], NOW).length, 0);
});

test('applyRemote merges, splits live/dead, sorts newest-first', () => {
  const local = [card({ simp: 'A', pinyin: 'a', lastSavedAt: NOW })];
  const remote = [
    card({ simp: 'B', pinyin: 'b', lastSavedAt: NOW + MIN }),
    card({ simp: 'A', pinyin: 'a', srs: schedule(null, 'good', NOW + 2 * MIN) }),
    tombstoneFor(card({ simp: 'C', pinyin: 'c' }), NOW),
  ];
  const { cards, tombstones } = applyRemote(local, [], remote);
  assert.deepEqual(cards.map((c) => c.simp), ['B', 'A']);
  assert.equal(cards[1].srs.reps, 1);
  assert.equal(tombstones.length, 1);
  assert.equal(tombstones[0].simp, 'C');
  // a remote card older than the local tombstone stays dead
  const deadLocal = tombstoneFor(card({ simp: 'A', pinyin: 'a' }), NOW + MIN);
  const r2 = applyRemote([], [deadLocal], [card({ simp: 'A', pinyin: 'a' })]);
  assert.equal(r2.cards.length, 0);
});

test('capCards keeps reviewed + recent cards and tombstones the evicted', () => {
  const keepSrs = card({ simp: 'S', pinyin: 's', srs: schedule(null, 'good', NOW - 10 * MIN) });
  const recent = card({ simp: 'R', pinyin: 'r', lastSavedAt: NOW });
  const stale = card({ simp: 'X', pinyin: 'x', lastSavedAt: NOW - 100 * MIN });
  const { cards, tombstones } = capCards([stale, recent, keepSrs], 2, NOW + MIN);
  assert.deepEqual(cards.map((c) => c.simp), ['S', 'R']);
  assert.deepEqual(tombstones.map((t) => t.simp), ['X']);
  assert.equal(tombstones[0].deletedAt, NOW + MIN);
  // under the cap: untouched
  const under = capCards([recent], 5, NOW);
  assert.equal(under.cards.length, 1);
  assert.equal(under.tombstones.length, 0);
});

test('pwa/lib copies match extension/lib byte-for-byte (run scripts/sync-shared.mjs)', () => {
  for (const name of ['srs.js', 'merge.js', 'cedict.js', 'progress.js']) {
    const canonical = readFileSync(new URL(`../extension/lib/${name}`, import.meta.url), 'utf8');
    const copy = readFileSync(new URL(`../pwa/lib/${name}`, import.meta.url), 'utf8');
    assert.equal(copy, canonical, `pwa/lib/${name} drifted`);
  }
});

console.log(`OK — ${passed} tests passed`);
