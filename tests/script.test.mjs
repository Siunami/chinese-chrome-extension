// Simplified <-> traditional conversion (extension/lib/script.js), against the
// real bundled dictionary — the point of converting by word rather than by
// character is a thing only a real dictionary can demonstrate.
// Run: node tests/script.test.mjs

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parseDictTSV, buildIndex } from '../extension/lib/cedict.js';
import { buildScriptMap, convertText, TO_TRAD, TO_SIMP } from '../extension/lib/script.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const entries = parseDictTSV(readFileSync(join(root, 'extension/data/dict.tsv'), 'utf8'));
const map = buildIndex(entries);
const scriptMap = buildScriptMap(entries);

const toTrad = (s) => convertText(map, entries, scriptMap, s, TO_TRAD);
const toSimp = (s) => convertText(map, entries, scriptMap, s, TO_SIMP);

let passed = 0;
const failures = [];
function test(name, fn) {
  try {
    fn();
    passed++;
  } catch (e) {
    failures.push(`${name}\n    ${e.message.split('\n')[0]}`);
  }
}

test('simple words convert both ways', () => {
  assert.equal(toTrad('电脑'), '電腦');
  assert.equal(toSimp('電腦'), '电脑');
  assert.equal(toTrad('学习'), '學習');
  assert.equal(toSimp('學習'), '学习');
});

// The reason this segments instead of mapping characters. 发 is 髮 in 头发 and
// 發 in 发现; no character table can be right about both.
test('an ambiguous character is resolved by the word it is in', () => {
  assert.equal(toTrad('头发'), '頭髮');
  assert.equal(toTrad('发现'), '發現');
  assert.equal(toTrad('发展'), '發展');
});

test('the other classic ambiguities come out right', () => {
  assert.equal(toTrad('皇后'), '皇后');   // 后 the empress stays 后
  assert.equal(toTrad('以后'), '以後');   // 后 as "after" becomes 後
  assert.equal(toTrad('干净'), '乾淨');   // 干 as "dry"
  assert.equal(toTrad('干部'), '幹部');   // 干 as "trunk/cadre"
});

// A character that is nearly always itself, but not quite always. 家 is 家 in
// both scripts except in 傢俱 and 傢伙, and both halves of the converter used to
// get it wrong on their own: the character table counted only the pairs that
// differ, so it held 家 → 傢, and the entry lookup took CEDICT's file order,
// which lists 傢 家 above 家 家. A guide about 我的家 came out as 我的傢.
test('a character that usually stays itself is left alone', () => {
  assert.equal(toTrad('家'), '家');
  assert.equal(toTrad('我的家'), '我的家');
  assert.equal(toTrad('我家有三个人'), '我家有三個人');
  assert.equal(toTrad('大家好'), '大家好');
  assert.equal(scriptMap.toTrad.get('家'), undefined,
    'the fallback table should have no opinion about a character that is itself');
  // And the word that is the exception still converts.
  assert.equal(toTrad('家具'), '家具');
  assert.equal(toSimp('傢俱'), '家俱');
});

test('a full sentence keeps its punctuation, spacing and latin text', () => {
  const simp = '我喜欢学习中文，因为它很有意思。ABC 123!';
  const trad = toTrad(simp);
  assert.equal(trad, '我喜歡學習中文，因為它很有意思。ABC 123!');
  // Nothing may be lost or gained: the shapes have to line up.
  assert.equal(Array.from(trad).length, Array.from(simp).length);
});

test('text already in the target script is returned unchanged', () => {
  assert.equal(toTrad('電腦'), '電腦');
  assert.equal(toSimp('电脑'), '电脑');
  assert.equal(toTrad('頭髮'), '頭髮');
});

test('round-tripping a passage returns the original', () => {
  const simp = '今天的新闻说，经济发展得很快，很多人开始学习新的技术。';
  assert.equal(toSimp(toTrad(simp)), simp);
});

test('characters the dictionary has no word for still convert', () => {
  // A run the segmenter cannot match falls back to the character table.
  assert.equal(toTrad('鿿'), '鿿'); // unmapped: passes through rather than vanishing
  assert.equal(toSimp('們'), '们');
});

test('empty and non-Chinese input is left alone', () => {
  assert.equal(toTrad(''), '');
  assert.equal(toTrad(null), '');
  assert.equal(toTrad('hello, world'), 'hello, world');
  assert.equal(toSimp('123 —  '), '123 —  ');
});

test('the character tables are built and prefer the commonest mapping', () => {
  assert.ok(scriptMap.toTrad.size > 2000, `only ${scriptMap.toTrad.size} simp->trad chars`);
  assert.ok(scriptMap.toSimp.size > 2000, `only ${scriptMap.toSimp.size} trad->simp chars`);
  // Unambiguous pairs must be exactly right.
  assert.equal(scriptMap.toTrad.get('国'), '國');
  assert.equal(scriptMap.toSimp.get('國'), '国');
});

if (failures.length) {
  console.error(`\n${failures.length} failing check(s):\n`);
  for (const f of failures) console.error(`  ✗ ${f}\n`);
  process.exit(1);
}
console.log(`script.test.mjs: ${passed} tests passed`);
