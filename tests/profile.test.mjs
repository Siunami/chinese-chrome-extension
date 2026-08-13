// Unit tests for extension/lib/profile.js. Run: node tests/profile.test.mjs

import assert from 'node:assert/strict';
import { buildProfile, strugglingWords, knownWords } from '../extension/lib/profile.js';

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

function word(simp, extra = {}) {
  return { cardType: 'word', simp, trad: '', pinyin: '', savedAt: 1, lastSavedAt: 1, ...extra };
}

function srs(extra = {}) {
  return { due: 0, ivl: 1, ease: 2.5, reps: 1, lapses: 0, ...extra };
}

test('strugglingWords picks high-lapse and low-ease cards, worst first', () => {
  const words = [
    word('好', { srs: srs() }),
    word('了', { srs: srs({ lapses: 3, ease: 2.0 }) }),
    word('的', { srs: srs({ lapses: 2, ease: 2.3 }) }),
    word('是', { srs: srs({ ease: 1.5 }) }),
    word('新'), // no srs — never reviewed, cannot be struggling
  ];
  const result = strugglingWords(words);
  assert.deepEqual(result.map((w) => w.simp), ['了', '的', '是']);
});

test('knownWords picks graduated, comfortable cards, most established first', () => {
  const words = [
    word('好', { srs: srs({ reps: 5, ease: 2.6, ivl: 40 }) }),
    word('了', { srs: srs({ reps: 3, ease: 2.4, ivl: 10 }) }),
    word('新', { srs: srs({ reps: 1, ease: 2.6 }) }),   // only 1 rep — not yet known
    word('是', { srs: srs({ reps: 4, ease: 1.9 }) }),   // low ease — not comfortable
    word('的'),                                          // never reviewed
  ];
  const result = knownWords(words);
  assert.deepEqual(result.map((w) => w.simp), ['好', '了']); // sorted by ivl desc
});

test('buildProfile.knownWords excludes struggling and lists known', () => {
  const words = [
    word('经济', { srs: srs({ reps: 5, ease: 2.6, ivl: 40 }) }),        // known
    word('学习', { srs: srs({ reps: 3, ease: 2.3, ivl: 8 }) }),         // known
    word('虽然', { srs: srs({ reps: 4, ease: 2.4, lapses: 3 }) }),      // recovered ease but lapse-heavy → struggling, not known
    word('新'),                                                         // never reviewed
  ];
  const profile = buildProfile(words);
  assert.deepEqual(profile.knownWords, ['经济', '学习']);
  assert.ok(profile.strugglingWords.includes('虽然'));
  assert.ok(!profile.knownWords.includes('虽然'));
});

test('buildProfile counts and caps, recent saves first', () => {
  const words = [];
  for (let i = 0; i < 70; i++) {
    words.push(word(`w${i}`, { lastSavedAt: i }));
  }
  const profile = buildProfile(words);
  assert.equal(profile.savedWords, 70);
  assert.equal(profile.recentWords.length, 60);
  assert.equal(profile.recentWords[0], 'w69'); // newest save first
  assert.equal(profile.reviewedWords, 0);
  assert.equal(profile.avgEase, null);
});

test('buildProfile separates sentences, averages ease, counts mature', () => {
  const words = [
    word('好', { srs: srs({ ease: 2.5, ivl: 30 }) }),
    word('了', { srs: srs({ ease: 1.5, ivl: 2, lapses: 3 }) }),
    word('新'),
    { cardType: 'sentence', simp: '你好吗', savedAt: 1, lastSavedAt: 1 },
  ];
  const profile = buildProfile(words);
  assert.equal(profile.savedWords, 3);
  assert.equal(profile.savedSentences, 1);
  assert.equal(profile.reviewedWords, 2);
  assert.equal(profile.matureWords, 1);
  assert.equal(profile.strugglingCount, 1);
  assert.equal(profile.avgEase, 2);
  assert.deepEqual(profile.strugglingWords, ['了']);
});

test('cards without cardType default to word', () => {
  const profile = buildProfile([{ simp: '好', savedAt: 1 }]);
  assert.equal(profile.savedWords, 1);
  assert.deepEqual(profile.recentWords, ['好']);
});

console.log(`profile.test.mjs: ${passed} tests passed`);
