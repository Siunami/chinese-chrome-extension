// Unit tests for extension/lib/cedict.js. Run: node tests/lib.test.mjs

import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  syllableToDiacritic, parsePinyin, pinyinToDisplay, parseCedict,
  parseDictTSV, entriesToTSV, buildIndex, lookup, lookupAt, charBreakdown,
  rankEntryIndices, buildRelatedIndex, findRelated, segment, pickReading,
  sentencePinyin, findExamples, hasChinese,
} from '../extension/lib/cedict.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
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

// --- pinyin ---------------------------------------------------------------

test('diacritic placement basics', () => {
  assert.equal(syllableToDiacritic('shi', 4), 'shì');
  assert.equal(syllableToDiacritic('fou', 3), 'fǒu');   // ou -> mark o
  assert.equal(syllableToDiacritic('hao', 3), 'hǎo');   // a wins
  assert.equal(syllableToDiacritic('xie', 4), 'xiè');   // e wins over i
  assert.equal(syllableToDiacritic('liu', 2), 'liú');   // last vowel
  assert.equal(syllableToDiacritic('lü', 3), 'lǚ');
  assert.equal(syllableToDiacritic('er', 2), 'ér');
  assert.equal(syllableToDiacritic('Zhong', 1), 'Zhōng');
  assert.equal(syllableToDiacritic('ma', 5), 'ma');     // neutral: no mark
});

test('parsePinyin handles u:, tones, and pass-through tokens', () => {
  assert.deepEqual(parsePinyin('shi4 fou3'), [
    { text: 'shì', tone: 4 },
    { text: 'fǒu', tone: 3 },
  ]);
  assert.equal(parsePinyin('lu:3 you2')[0].text, 'lǚ');
  assert.equal(parsePinyin('· Si1')[0].text, '·');
  assert.equal(parsePinyin('· Si1')[0].tone, 0);
  assert.equal(pinyinToDisplay('ni3 hao3'), 'nǐ hǎo');
});

// --- CEDICT parsing -------------------------------------------------------

const SAMPLE = [
  '# comment line',
  '是否 是否 [shi4 fou3] /whether (or not)/if/is or isn\'t/',
  '是 是 [shi4] /to be/correct/yes/',
  '昰 是 [shi4] /variant of 是[shi4]/',
  '你好 你好 [ni3 hao3] /hello/hi/',
  '好 好 [hao3] /good/well/',
  '好 好 [hao4] /to be fond of/',
  '的 的 [di4] /aim/target/',
  '的 的 [de5] /(possessive particle)/',
  '喜歡 喜欢 [xi3 huan5] /to like/to be fond of/',
].join('\n');

const entries = parseCedict(SAMPLE);
const index = buildIndex(entries);

test('parseCedict parses entries and skips comments', () => {
  assert.equal(entries.length, 9);
  assert.deepEqual(entries[0], {
    trad: '是否', simp: '是否', pinyin: 'shi4 fou3',
    defs: ['whether (or not)', 'if', "is or isn't"],
  });
});

test('TSV round-trip preserves entries', () => {
  const round = parseDictTSV(entriesToTSV(entries));
  assert.deepEqual(round, entries);
});

test('index maps both scripts to the same entry', () => {
  const viaTrad = lookup(index, entries, '喜歡你');
  const viaSimp = lookup(index, entries, '喜欢你');
  assert.equal(viaTrad[0].word, '喜歡');
  assert.equal(viaSimp[0].word, '喜欢');
  assert.equal(viaTrad[0].entries[0].simp, '喜欢');
  assert.equal(viaSimp[0].entries[0].simp, '喜欢');
});

test('lookup returns longest match first plus shorter matches', () => {
  const res = lookup(index, entries, '是否還是');
  assert.equal(res.length, 2);
  assert.equal(res[0].word, '是否');
  assert.equal(res[0].length, 2);
  assert.equal(res[1].word, '是');
  assert.equal(res[1].entries.length, 2); // 是 + variant 昰
  const defsOnly = lookup(index, entries, 'hello');
  assert.equal(defsOnly.length, 0);
});

test('lookup handles homographs with multiple readings', () => {
  const res = lookup(index, entries, '好的');
  assert.equal(res[0].entries.length, 2); // hao3 + hao4
});

test('segment does greedy longest match', () => {
  const toks = segment(index, entries, '你好，是否');
  assert.deepEqual(toks.map((t) => t.text), ['你好', '，', '是否']);
  assert.equal(toks[1].idxs, null);
});

test('pickReading prefers particle override and skips variant entries', () => {
  const deIdxs = index.get('的');
  assert.equal(pickReading('的', deIdxs, entries), 'de5');
  const shiIdxs = index.get('是');
  assert.equal(pickReading('是', shiIdxs, entries), 'shi4');
});

test('sentencePinyin annotates a sentence', () => {
  const py = sentencePinyin(index, entries, '你好，是否好？');
  assert.equal(py, 'nǐhǎo， shìfǒu hǎo？');
});

test('lookupAt returns the word CONTAINING the cursor, Pleco-style', () => {
  // cursor on 欢 (index 3): the containing word 喜欢 wins over the single char
  const r = lookupAt(index, entries, '你好喜欢', 3);
  assert.equal(r.groups[0].word, '喜欢');
  assert.deepEqual(r.highlight, { start: 2, length: 2 });
  // cursor on the first char of a word behaves like classic forward matching
  const r2 = lookupAt(index, entries, '是否好', 0);
  assert.equal(r2.groups[0].word, '是否');
  assert.equal(r2.groups[1].word, '是');
  assert.deepEqual(r2.highlight, { start: 0, length: 2 });
  // cursor mid-word also lists the hovered char's own forward matches
  const r3 = lookupAt(index, entries, '是否好', 1);
  assert.equal(r3.groups[0].word, '是否');
  assert.ok(r3.groups.some((g) => g.word === '否') === false); // 否 not in sample dict
  // punctuation under the cursor: no matches
  const r4 = lookupAt(index, entries, '，好', 0);
  assert.equal(r4.groups.length, 0);
  assert.equal(r4.highlight, null);
});

test('charBreakdown lists constituent characters once, only for phrases', () => {
  assert.deepEqual(charBreakdown(index, '你好').map((c) => c.char), ['好']); // 你 not in sample dict
  assert.equal(charBreakdown(index, '好').length, 0); // single char: no breakdown
  assert.deepEqual(charBreakdown(index, '好好').map((c) => c.char), ['好']); // deduped
});

test('character breakdown ranking prefers ordinary senses over variants', () => {
  const ranked = rankEntryIndices(index.get('是'), entries).map((i) => entries[i]);
  assert.equal(ranked[0].trad, '是');
  assert.ok(!ranked[0].defs[0].startsWith('variant of'));
});

test('hasChinese detects CJK including astral plane', () => {
  assert.ok(hasChinese('你好'));
  assert.ok(hasChinese('a你b'));
  assert.ok(!hasChinese('hello 123'));
  assert.ok(hasChinese('𠮷'));
});

// --- examples -------------------------------------------------------------

test('findExamples prefers word-boundary matches', () => {
  const sentences = [
    { zh: '是否好？', py: '', en: 'contains shifou' },
    { zh: '你好是好。', py: '', en: 'shi standalone' },
    { zh: '好，是否？', py: '', en: 'contains shifou 2' },
  ].sort((a, b) => a.zh.length - b.zh.length);
  // Searching 是 should prefer the sentence where 是 is a standalone token,
  // not one where it only appears inside 是否.
  const res = findExamples(sentences, '是', '是', 2, index, entries);
  assert.equal(res[0].en, 'shi standalone');
});

test('findExamples respects limit and skips trivial sentences', () => {
  const sentences = [
    { zh: '是。', py: '', en: 'too short' },
    { zh: '你好是好。', py: '', en: 'ok' },
  ];
  const res = findExamples(sentences, '是', '是', 5, index, entries);
  assert.deepEqual(res.map((s) => s.en), ['ok']);
  assert.deepEqual(findExamples(sentences, '是', '是', 0, index, entries), []);
});

// --- built data sanity ----------------------------------------------------

const dictPath = join(root, 'extension', 'data', 'dict.tsv');
const sentPath = join(root, 'extension', 'data', 'sentences.tsv');

if (existsSync(dictPath) && existsSync(sentPath)) {
  test('built dict.tsv loads and looks sane', () => {
    const all = parseDictTSV(readFileSync(dictPath, 'utf8'));
    assert.ok(all.length > 100000, `entries: ${all.length}`);
    const idx = buildIndex(all);
    const res = lookup(idx, all, '是否還是不太喜歡');
    assert.equal(res[0].word, '是否');
    const de = pickReading('的', idx.get('的'), all);
    assert.equal(de, 'de5');
  });

  test('homograph overrides pick the common reading', () => {
    const all = parseDictTSV(readFileSync(dictPath, 'utf8'));
    const idx = buildIndex(all);
    for (const [w, expected] of [['看', 'kan4'], ['没', 'mei2'], ['行', 'xing2'], ['吗', 'ma5']]) {
      assert.equal(pickReading(w, idx.get(w), all), expected, `reading of ${w}`);
    }
  });

  test('display ranking puts the ordinary 全 sense before the surname', () => {
    const all = parseDictTSV(readFileSync(dictPath, 'utf8'));
    const idx = buildIndex(all);
    const ranked = rankEntryIndices(idx.get('全'), all).map((i) => all[i]);
    assert.equal(ranked[0].pinyin, 'quan2');
    assert.ok(ranked[0].defs.includes('whole'));
    assert.ok(ranked.some((entry) => entry.pinyin === 'Quan2'));
  });

  test('context rules: modal 得 and classifier 只', () => {
    const all = parseDictTSV(readFileSync(dictPath, 'utf8'));
    const idx = buildIndex(all);
    assert.ok(sentencePinyin(idx, all, '我得走。').includes('děi'), 'subject+得 -> děi');
    assert.ok(sentencePinyin(idx, all, '他跑得快。').includes('de '), 'verb+得 -> de');
    assert.ok(sentencePinyin(idx, all, '一只猫。').includes('zhī'), 'numeral+只 -> zhī');
  });

  test('BiMM keeps 没有 together and fixes 在行走', () => {
    const all = parseDictTSV(readFileSync(dictPath, 'utf8'));
    const idx = buildIndex(all);
    assert.deepEqual(
      segment(idx, all, '没有水。').map((t) => t.text),
      ['没有', '水', '。'],
    );
    assert.deepEqual(
      segment(idx, all, '她在行走。').map((t) => t.text),
      ['她', '在', '行走', '。'],
    );
  });

  test('lookupAt against real data: hovering mid-word finds the word', () => {
    const all = parseDictTSV(readFileSync(dictPath, 'utf8'));
    const idx = buildIndex(all);
    // hovering 否 in 他问我是否很忙 (cursor index 4)
    const r = lookupAt(idx, all, '他问我是否很忙', 4);
    assert.equal(r.groups[0].word, '是否');
    assert.deepEqual(r.highlight, { start: 3, length: 2 });
    // hovering 华 in 中华人民共和国 keeps the full name as primary
    const r2 = lookupAt(idx, all, '中华人民共和国成立了', 1);
    assert.equal(r2.groups[0].word, '中华人民共和国');
    assert.deepEqual(r2.highlight, { start: 0, length: 7 });
  });

  test('charBreakdown against real data: 喜欢 decomposes with readings', () => {
    const all = parseDictTSV(readFileSync(dictPath, 'utf8'));
    const idx = buildIndex(all);
    const b = charBreakdown(idx, '喜欢');
    assert.deepEqual(b.map((c) => c.char), ['喜', '欢']);
    for (const c of b) assert.ok(c.idxs.length > 0);
    const huan = b.find((c) => c.char === '欢');
    const best = all[rankEntryIndices(huan.idxs, all)[0]];
    assert.ok(best.defs.some((d) => /joyous|happy/.test(d)), best.defs.join('; '));
  });

  test('sentence breakdown ranks 鸟 niǎo “bird” above its rare variant', () => {
    const all = parseDictTSV(readFileSync(dictPath, 'utf8'));
    const idx = buildIndex(all);
    const lookup = lookupAt(idx, all, '鸟类飞行。', 0);
    assert.equal(lookup.groups[0].word, '鸟类');
    const bird = charBreakdown(idx, lookup.groups[0].word)
      .find((c) => c.char === '鸟');
    const best = all[rankEntryIndices(bird.idxs, all)[0]];
    assert.equal(parsePinyin(best.pinyin).map((part) => part.text).join(' '), 'niǎo');
    assert.equal(best.defs[0], 'bird');
  });

  test('related-word ranking finds useful semantic and word-family links', () => {
    const all = parseDictTSV(readFileSync(dictPath, 'utf8'));
    const idx = buildIndex(all);
    const t0 = Date.now();
    const relatedIdx = buildRelatedIndex(all);
    assert.ok(Date.now() - t0 < 1500, 'related index is too slow to build');

    const likes = findRelated(all, idx, relatedIdx, '喜欢', 6)
      .map((r) => all[r.idx].simp);
    assert.ok(likes.includes('喜爱') || likes.includes('喜好') || likes.includes('爱好'));
    assert.ok(likes.every((word) => Array.from(word).length > 1));

    const eating = findRelated(all, idx, relatedIdx, '吃', 8)
      .map((r) => all[r.idx].simp);
    assert.ok(eating.includes('吃掉'));
    assert.ok(!eating.includes('打垮'), 'secondary "defeat" sense leaked into core relations');
  });

  test('headwords longer than 12 code points are reachable', () => {
    const all = parseDictTSV(readFileSync(dictPath, 'utf8'));
    const idx = buildIndex(all);
    const long = all.find((e) => Array.from(e.simp).length > 12);
    assert.ok(long, 'no long headword found');
    const res = lookup(idx, all, long.simp);
    assert.equal(res[0].word, long.simp);
  });

  test('built sentences.tsv loads, is sorted, and finds examples', () => {
    const lines = readFileSync(sentPath, 'utf8').split('\n').filter(Boolean);
    assert.ok(lines.length > 20000, `sentences: ${lines.length}`);
    const sentences = lines.map((l) => {
      const [zh, py, en] = l.split('\t');
      return { zh, py, en };
    });
    for (const s of sentences) assert.ok(s.zh && s.en, 'malformed line');
    for (let i = 1; i < sentences.length; i++) {
      assert.ok(sentences[i].zh.length >= sentences[i - 1].zh.length, 'not sorted');
    }
    const all = parseDictTSV(readFileSync(dictPath, 'utf8'));
    const idx = buildIndex(all);
    const t0 = Date.now();
    const res = findExamples(sentences, '喜欢', '喜歡', 3, idx, all);
    const dt = Date.now() - t0;
    assert.equal(res.length, 3);
    assert.ok(res.every((s) => s.zh.includes('喜欢') || s.zh.includes('喜歡')));
    assert.ok(res.every((s) => s.py.length > 0), 'examples carry pinyin');
    assert.ok(dt < 200, `findExamples too slow: ${dt}ms`);
    // very common single char: boundary verification should still be fast
    const t1 = Date.now();
    const shi = findExamples(sentences, '是', '是', 5, idx, all);
    assert.equal(shi.length, 5);
    assert.ok(Date.now() - t1 < 200, 'single-char search too slow');
  });
} else {
  console.log('(built data not present; skipping data sanity tests)');
}

console.log(`OK — ${passed} tests passed`);
