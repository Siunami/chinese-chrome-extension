// Complete HSK vocabulary and cross-set scheduling.
// Run: node tests/hsk-vocab.test.mjs

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  HSK_LEVEL_COUNTS, cumulativeHskCount, hskLevelKey, hskPracticeHref,
  hskReviewCards, hskSetName, parseHskVocabulary, vocabularyForLevel,
  searchableHskText,
} from '../extension/lib/hsk-vocab.js';
import { cardKey } from '../extension/lib/merge.js';
import {
  applySharedProgress, latestSrs, mergeStudyProgress, recordSharedProgress,
  uniqueStudyCards,
} from '../extension/lib/studysets.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const words = parseHskVocabulary(
  readFileSync(join(root, 'extension', 'data', 'hsk.tsv'), 'utf8'),
);

let passed = 0;
function test(name, fn) {
  try {
    fn();
    passed++;
  } catch (error) {
    console.error(`FAIL: ${name}`);
    throw error;
  }
}

test('the bundled list has every official 2021 HSK 3.0 row', () => {
  assert.equal(words.length, 11092);
  assert.equal(new Set(words.map((word) => word.id)).size, words.length);
  for (const [level, count] of Object.entries(HSK_LEVEL_COUNTS)) {
    assert.equal(words.filter((word) => word.level === level).length, count, level);
  }
});

test('every vocabulary row is ready to render and review', () => {
  for (const word of words) {
    assert.match(word.id, /^L(?:[1-6]|7)-\d{4}$/);
    assert.ok(word.simp, `${word.id} has no simplified form`);
    assert.ok(word.trad, `${word.id} has no traditional form`);
    assert.ok(word.pinyin, `${word.id} has no pinyin`);
    assert.ok(word.defs, `${word.id} has no definition`);
    assert.ok(word.notationSimp, `${word.id} lost the standard's notation`);
    assert.ok(word.tones.every((tone) => tone >= 0 && tone <= 5), `${word.id} bad tones`);
  }
});

test('level and cumulative sets use the shared advanced band honestly', () => {
  assert.equal(hskLevelKey(6), '6');
  assert.equal(hskLevelKey(7), '7-9');
  assert.equal(hskLevelKey(9), '7-9');
  assert.equal(hskLevelKey(10), null);
  assert.equal(vocabularyForLevel(words, 2, 'level').length, 772);
  assert.equal(vocabularyForLevel(words, 2, 'cumulative').length, 1272);
  assert.equal(vocabularyForLevel(words, 7, 'level').length, 5636);
  assert.equal(vocabularyForLevel(words, 8, 'level').length, 5636);
  assert.equal(vocabularyForLevel(words, 9, 'cumulative').length, 11092);
  assert.equal(cumulativeHskCount(6), 5456);
  assert.equal(cumulativeHskCount(9), 11092);
  assert.equal(hskSetName(8), 'HSK 7–9 shared vocabulary');
});

test('practice links carry their level, scope, and embedding explicitly', () => {
  assert.equal(hskPracticeHref(3), 'review.html?hsk=3&scope=level');
  assert.equal(
    hskPracticeHref(9, 'cumulative', { embedded: true }),
    'review.html?hsk=9&scope=cumulative&embedded=1',
  );
});

test('pinyin search accepts tone marks, plain letters, and omitted spaces', () => {
  const hobby = words.find((word) => word.simp === '爱好');
  assert.match(searchableHskText(hobby), /ài hào/);
  assert.match(searchableHskText(hobby), /ai hao/);
  assert.match(searchableHskText(hobby), /aihao/);
  const woman = words.find((word) => word.pinyin.includes('nǚ'));
  assert.ok(woman, 'fixture has no nü pinyin');
  assert.match(searchableHskText(woman), /nv/);
});

test('duplicate syllabus rows stay in the reference list but become one practice card', () => {
  const cumulative = hskReviewCards(vocabularyForLevel(words, 3, 'cumulative'));
  const white = cumulative.filter((card) => card.simp === '白' && card.pinyin === 'bái');
  assert.equal(white.length, 2, 'the official adjective and adverb rows should both be present');
  const unique = uniqueStudyCards(cumulative);
  assert.equal(unique.filter((card) => card.simp === '白' && card.pinyin === 'bái').length, 1);
  assert.ok(unique.length < cumulative.length);
});

test('one card identity keeps the newest schedule across every set', () => {
  const hsk = hskReviewCards(vocabularyForLevel(words, 1, 'level'))[0];
  const library = { ...hsk, hskId: undefined, srs: {
    due: 2000, ivl: 3, reps: 2, reviewedAt: 1000,
  } };
  const newer = { due: 9000, ivl: 8, reps: 4, reviewedAt: 8000 };
  const progress = recordSharedProgress({}, hsk, newer);
  const [fromHsk] = applySharedProgress([hsk], progress);
  const [fromLibrary] = applySharedProgress([library], progress);
  assert.deepEqual(fromHsk.srs, newer);
  assert.deepEqual(fromLibrary.srs, newer);
  assert.equal(cardKey(fromHsk), cardKey(fromLibrary));
  assert.deepEqual(latestSrs(library.srs, newer), newer);
});

test('restoring shared progress cannot roll a newer grade backwards', () => {
  const key = cardKey(hskReviewCards(words.slice(0, 1))[0]);
  const old = { [key]: { due: 100, reps: 1, reviewedAt: 50 } };
  const recent = { [key]: { due: 500, reps: 3, reviewedAt: 400 } };
  assert.deepEqual(mergeStudyProgress(old, recent)[key], recent[key]);
  assert.deepEqual(mergeStudyProgress(recent, old)[key], recent[key]);
});

console.log(`hsk-vocab.test.mjs: ${passed} tests passed`);
