// Validates the hand-authored HSK study guides in extension/guides/ against
// the schema documented in extension/guides/index.js, and checks every piece
// of Chinese in them against the bundled CC-CEDICT.
//
//   node tests/hsk.test.mjs                              all nine guides
//   node tests/hsk.test.mjs extension/guides/hsk-1-3.js  one part, while authoring
//
// The single-file form runs only the per-guide checks, so each part file can
// be validated before its siblings exist.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { parseDictTSV, buildIndex, hasChinese, segment } from '../extension/lib/cedict.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const entries = parseDictTSV(readFileSync(join(root, 'extension/data/dict.tsv'), 'utf8'));
const index = buildIndex(entries);

// A part file is imported on its own so it can be checked before its siblings
// exist; index.js is only pulled in for the whole-set checks.
const only = process.argv[2];
const whole = only ? null : await import('../extension/guides/index.js');
const guides = only
  ? Object.values(await import(pathToFileURL(resolve(only)).href)).flat()
  : whole.HSK_GUIDES;

// Duplicated from index.js rather than imported, so single-part runs do not
// need the aggregator to resolve.
function chineseStrings(guide) {
  const out = [guide.passage.title, ...guide.passage.text.split(/\n{2,}/).map((p) => p.trim())];
  for (const g of guide.grammar) for (const ex of g.examples) out.push(ex.zh);
  for (const group of guide.vocab) for (const w of group.words) out.push(w.zh);
  return out.filter(Boolean);
}

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

const str = (v) => typeof v === 'string' && v.trim().length > 0;
const inRange = (arr, lo, hi) => Array.isArray(arr) && arr.length >= lo && arr.length <= hi;

// Guides are prose, not markup: catch stray markdown/HTML that would render
// literally (the page builds every node with textContent).
const MARKUP = /<\/?[a-z][^>]*>|\*\*|^[-*]\s|^#{1,6}\s/im;

if (whole) {
  test('nine guides, one per level, in order', () => {
    assert.equal(whole.HSK_GUIDES.length, 9);
    assert.deepEqual(whole.HSK_GUIDES.map((g) => g.level), [1, 2, 3, 4, 5, 6, 7, 8, 9]);
    assert.equal(whole.guideByLevel(4).level, 4);
    assert.equal(whole.guideByLevel(99), null);
  });

  test('bands cover every level exactly once', () => {
    assert.deepEqual(whole.BANDS.flatMap((b) => b.levels), [1, 2, 3, 4, 5, 6, 7, 8, 9]);
    for (const guide of whole.HSK_GUIDES) {
      const band = whole.BANDS.find((b) => b.levels.includes(guide.level));
      assert.equal(guide.band, band.name, `level ${guide.level} band mismatch`);
    }
  });
}

// The cumulative word/character counts published in the HSK 3.0 standard.
// Wrong numbers here would be quietly misleading study advice, so they are
// pinned rather than trusted to the prose.
const OFFICIAL = {
  1: { newWords: 500, totalWords: 500, newChars: 300, totalChars: 300, grammarPoints: 48 },
  2: { newWords: 772, totalWords: 1272, newChars: 300, totalChars: 600, grammarPoints: 81 },
  3: { newWords: 973, totalWords: 2245, newChars: 300, totalChars: 900, grammarPoints: 81 },
  4: { newWords: 1000, totalWords: 3245, newChars: 300, totalChars: 1200, grammarPoints: 76 },
  5: { newWords: 1071, totalWords: 4316, newChars: 300, totalChars: 1500, grammarPoints: 71 },
  6: { newWords: 1140, totalWords: 5456, newChars: 300, totalChars: 1800, grammarPoints: 67 },
  // 7-9 is one syllabus and one exam. The standard publishes no per-level
  // split, so all three guides carry the band's figures and differ by content
  // focus rather than by invented counts.
  7: { newWords: 5636, totalWords: 11092, newChars: 1200, totalChars: 3000, grammarPoints: 148 },
  8: { newWords: 5636, totalWords: 11092, newChars: 1200, totalChars: 3000, grammarPoints: 148 },
  9: { newWords: 5636, totalWords: 11092, newChars: 1200, totalChars: 3000, grammarPoints: 148 },
};

test('statistics match the published standard', () => {
  for (const guide of guides) {
    const want = OFFICIAL[guide.level];
    if (!want) continue;
    for (const [key, value] of Object.entries(want)) {
      assert.equal(guide.stats[key], value,
        `HSK ${guide.level} stats.${key}: ${guide.stats[key]} != ${value}`);
    }
  }
  const nine = guides.find((g) => g.level === 9);
  if (nine) {
    assert.equal(nine.stats.totalWords, 11092, 'HSK 9 totalWords');
    assert.equal(nine.stats.totalChars, 3000, 'HSK 9 totalChars');
  }
});

for (const guide of guides) {
  const at = `HSK ${guide.level}`;

  test(`${at}: top-level fields`, () => {
    assert.ok(str(guide.name), 'name');
    assert.ok(str(guide.tagline) && guide.tagline.length <= 90, 'tagline <= 90 chars');
    assert.ok(str(guide.overview) && guide.overview.length >= 120, 'overview >= 120 chars');
    assert.ok(str(guide.stats.studyHours), 'stats.studyHours');
    assert.ok(inRange(guide.canDo, 4, 6), 'canDo has 4-6 entries');
    assert.ok(guide.canDo.every(str), 'canDo entries non-empty');
    assert.ok(inRange(guide.tips, 3, 5), 'tips has 3-5 entries');
    assert.ok(str(guide.exam.format) && str(guide.exam.tips), 'exam.format + exam.tips');
  });

  test(`${at}: grammar points`, () => {
    assert.ok(inRange(guide.grammar, 6, 10), 'grammar has 6-10 points');
    for (const point of guide.grammar) {
      assert.ok(str(point.point), 'point name');
      assert.ok(str(point.formula) && hasChinese(point.formula), `formula is Chinese: ${point.point}`);
      assert.ok(str(point.explain) && point.explain.length >= 40, `explain too short: ${point.point}`);
      assert.ok(inRange(point.examples, 2, 3), `${point.point}: 2-3 examples`);
      for (const ex of point.examples) {
        assert.ok(hasChinese(ex.zh), `${point.point}: example zh must be Chinese`);
        assert.ok(str(ex.en), `${point.point}: example en`);
        assert.ok(/[。？！]$/.test(ex.zh), `${point.point}: "${ex.zh}" needs Chinese end punctuation`);
      }
    }
  });

  test(`${at}: vocabulary themes`, () => {
    assert.ok(inRange(guide.vocab, 5, 7), 'vocab has 5-7 themes');
    for (const group of guide.vocab) {
      assert.ok(str(group.theme), 'theme name');
      assert.ok(inRange(group.words, 8, 12), `${group.theme}: 8-12 words`);
      for (const w of group.words) {
        assert.ok(hasChinese(w.zh), `${group.theme}: "${w.zh}" is not Chinese`);
        assert.ok(str(w.en), `${group.theme}: "${w.zh}" has no gloss`);
      }
    }
  });

  // Every listed vocabulary item has to be a real CC-CEDICT headword, or the
  // hover popup would come up empty on the guide's own word lists.
  test(`${at}: every vocabulary word is in CC-CEDICT`, () => {
    const missing = guide.vocab
      .flatMap((group) => group.words.map((w) => w.zh))
      .filter((zh) => !index.has(zh));
    assert.deepEqual(missing, [], `not in the dictionary: ${missing.join(' ')}`);
  });

  test(`${at}: reading passage`, () => {
    assert.ok(hasChinese(guide.passage.title), 'passage title is Chinese');
    assert.ok(hasChinese(guide.passage.text), 'passage text is Chinese');
    assert.ok(str(guide.passage.en) && guide.passage.en.length >= 80, 'passage translation');
    const chars = Array.from(guide.passage.text.replace(/\s+/g, '')).length;
    const floor = guide.level <= 2 ? 80 : guide.level <= 4 ? 150 : 220;
    assert.ok(chars >= floor, `passage is ${chars} chars, want >= ${floor}`);
    assert.ok(chars <= 1200, `passage is ${chars} chars, want <= 1200`);
    assert.ok(guide.passage.text.includes('\n\n'), 'passage needs 2+ paragraphs');
  });

  test(`${at}: pitfalls`, () => {
    assert.ok(inRange(guide.pitfalls, 3, 4), 'pitfalls has 3-4 entries');
    for (const p of guide.pitfalls) {
      assert.ok(str(p.title), 'pitfall title');
      assert.ok(str(p.detail) && p.detail.length >= 40, `pitfall too thin: ${p.title}`);
    }
  });

  test(`${at}: no markdown or HTML leaked into the prose`, () => {
    const walk = (value, path) => {
      if (typeof value === 'string') {
        assert.ok(!MARKUP.test(value), `markup in ${path}: ${value.slice(0, 60)}`);
      } else if (Array.isArray(value)) {
        value.forEach((v, i) => walk(v, `${path}[${i}]`));
      } else if (value && typeof value === 'object') {
        for (const [k, v] of Object.entries(value)) walk(v, `${path}.${k}`);
      }
    };
    walk(guide, at);
  });

  // The page annotates these with sentencePinyin at render time; anything the
  // segmenter cannot resolve to a dictionary word would show up as a bare
  // character with no reading.
  test(`${at}: all Chinese segments against the dictionary`, () => {
    for (const text of chineseStrings(guide)) {
      const pieces = segment(index, entries, text);
      assert.ok(pieces.length > 0, `nothing segmented from "${text.slice(0, 30)}"`);
    }
  });
}

if (failures.length) {
  console.error(`\n${failures.length} failing check(s):\n`);
  for (const f of failures) console.error(`  ✗ ${f}\n`);
  process.exit(1);
}
console.log(`hsk.test.mjs: ${passed} checks passed`);
