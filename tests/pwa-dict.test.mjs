// Unit tests for pwa/lib/dict.js (the pure, non-fetch parts): TSV parsing and
// the lookup shaping that mirrors handleLookup in extension/background.js.
// Run: node tests/pwa-dict.test.mjs

import assert from 'node:assert/strict';
import { buildData, parseSentencesTSV, detailsFromData } from '../pwa/lib/dict.js';

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

const DICT_TSV = [
  '鳥類\t鸟类\tniao3 lei4\tbirds',
  '鳥\t鸟\tniao3\tbird/CL:隻|只[zhi1]',
  '類\t类\tlei4\tkind/type/category',
  '我\t我\two3\tI/me',
  '喜\t喜\txi3\tto be fond of/happy event',
  '歡\t欢\thuan1\tjoyous/happy',
  '喜歡\t喜欢\txi3 huan5\tto like/to be fond of',
  '你\t你\tni3\tyou',
].join('\n');

const SENTENCES_TSV = [
  '我喜欢鸟类。\twǒ xǐhuan niǎolèi.\tI like birds.\tsomeone',
  'malformed line without tabs',
  '你喜欢我。\tnǐ xǐhuan wǒ.\tYou like me.\tsomeone',
].join('\n');

const data = buildData(DICT_TSV, SENTENCES_TSV);

test('parseSentencesTSV keeps well-formed rows only', () => {
  const sentences = parseSentencesTSV(SENTENCES_TSV);
  assert.equal(sentences.length, 2);
  assert.deepEqual(sentences[0], {
    zh: '我喜欢鸟类。', py: 'wǒ xǐhuan niǎolèi.', en: 'I like birds.',
  });
});

test('detailsFromData is chunk-aware: 欢 inside 我喜欢鸟类 yields 喜欢', () => {
  const result = detailsFromData(data, '我喜欢鸟类', 2);
  assert.equal(result.matches[0].word, '喜欢');
  assert.deepEqual(result.highlight, { start: 1, length: 2 });
  const entry = result.matches[0].entries[0];
  assert.equal(entry.trad, '喜歡');
  assert.equal(entry.pinyin[0].text, 'xǐ');
  assert.equal(entry.pinyin[0].tone, 3);
  assert.deepEqual(entry.defs, ['to like', 'to be fond of']);
});

test('phrase lookups include a per-character breakdown', () => {
  const result = detailsFromData(data, '鸟类', 0);
  assert.equal(result.matches[0].word, '鸟类');
  assert.deepEqual(result.chars.map((c) => c.char), ['鸟', '类']);
  assert.equal(result.chars[0].entries[0].defs[0], 'bird');
  assert.deepEqual(result.exampleWord, { simp: '鸟类', trad: '鳥類' });
});

test('examples come from the sentence corpus, capped by exampleCount', () => {
  const result = detailsFromData(data, '鸟类', 0);
  assert.equal(result.examples.length, 1);
  assert.equal(result.examples[0].en, 'I like birds.');
  const none = detailsFromData(data, '鸟类', 0, { exampleCount: 0 });
  assert.equal(none.examples.length, 0);
});

test('no match returns empty matches', () => {
  assert.deepEqual(detailsFromData(data, 'hello', 0), { matches: [] });
});

console.log(`OK — ${passed} tests passed`);
