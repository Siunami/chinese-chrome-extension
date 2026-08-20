// Complete HSK 3.0 (2021 standard) vocabulary.
//
// The hand-written guides deliberately show only a small thematic sampler.
// data/hsk.tsv is the complete 11,092-row standard list, enriched at build
// time with the pinyin and definitions already bundled in CC-CEDICT. Keeping
// the loader here gives the guide and the review page one definition of a
// level, especially the easy-to-get-wrong shared HSK 7-9 band.

export const HSK_SCOPES = ['level', 'cumulative'];

export const HSK_LEVEL_COUNTS = Object.freeze({
  1: 500,
  2: 772,
  3: 973,
  4: 1000,
  5: 1071,
  6: 1140,
  '7-9': 5636,
});

const COLUMNS = [
  'id', 'level', 'simp', 'trad', 'pinyin', 'tones', 'pos',
  'notationSimp', 'notationTrad', 'defs',
];

let vocabularyPromise = null;

export function hskLevelKey(level) {
  const n = Number(level);
  if (!Number.isInteger(n) || n < 1 || n > 9) return null;
  return n >= 7 ? '7-9' : String(n);
}

export function parseHskVocabulary(text) {
  const lines = String(text || '').replace(/^\uFEFF/, '').split('\n');
  const header = (lines.shift() || '').replace(/\r$/, '').split('\t');
  if (header.join('\t') !== COLUMNS.join('\t')) {
    throw new Error('Unrecognised HSK vocabulary data');
  }
  const out = [];
  for (const raw of lines) {
    if (!raw.trim()) continue;
    const values = raw.replace(/\r$/, '').split('\t');
    if (values.length !== COLUMNS.length) {
      throw new Error(`Malformed HSK vocabulary row ${out.length + 1}`);
    }
    const word = Object.fromEntries(COLUMNS.map((key, i) => [key, values[i]]));
    word.tones = word.tones
      ? word.tones.split(',').map(Number).filter((tone) => Number.isInteger(tone))
      : [];
    out.push(word);
  }
  return out;
}

export function loadHskVocabulary() {
  if (!vocabularyPromise) {
    const url = new URL('../data/hsk.tsv', import.meta.url);
    vocabularyPromise = fetch(url).then(async (response) => {
      if (!response.ok) throw new Error(`Could not load HSK vocabulary (${response.status})`);
      return parseHskVocabulary(await response.text());
    }).catch((error) => {
      vocabularyPromise = null; // a transient extension reload may be retried
      throw error;
    });
  }
  return vocabularyPromise;
}

export function vocabularyForLevel(words, level, scope = 'level') {
  const key = hskLevelKey(level);
  if (!key) return [];
  if (scope !== 'cumulative') return words.filter((word) => word.level === key);
  if (key === '7-9') return words.slice();
  const ceiling = Number(key);
  return words.filter((word) => word.level !== '7-9' && Number(word.level) <= ceiling);
}

export function cumulativeHskCount(level) {
  const key = hskLevelKey(level);
  if (!key) return 0;
  if (key === '7-9') return Object.values(HSK_LEVEL_COUNTS)
    .reduce((sum, count) => sum + count, 0);
  let total = 0;
  for (let n = 1; n <= Number(key); n++) total += HSK_LEVEL_COUNTS[n];
  return total;
}

export function hskSetName(level, scope = 'level') {
  const key = hskLevelKey(level);
  if (!key) return 'HSK vocabulary';
  if (scope === 'cumulative') {
    return key === '7-9' ? 'HSK 1–9 cumulative' : `HSK 1–${key} cumulative`;
  }
  return key === '7-9' ? 'HSK 7–9 shared vocabulary' : `HSK ${key} vocabulary`;
}

export function hskPracticeHref(level, scope = 'level', { embedded = false } = {}) {
  const params = new URLSearchParams({ hsk: String(level), scope });
  if (embedded) params.set('embedded', '1');
  return `review.html?${params}`;
}

export function isHskPracticeParams(params) {
  return !!hskLevelKey(params.get('hsk'))
    && (params.get('scope') == null || HSK_SCOPES.includes(params.get('scope')));
}

export function searchableHskText(word) {
  const marked = [
    word.simp, word.trad, word.notationSimp, word.notationTrad,
    word.pinyin, word.pos, word.defs,
  ].join(' ').toLocaleLowerCase();
  const plain = marked.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  // Both common ways to type pinyin into a Latin keyboard: spaces optional,
  // and v standing in for ü. Keep the marked form too, so an accented query
  // remains exact rather than being silently rewritten.
  const vPlain = marked.replaceAll('ü', 'v').replaceAll('ǖ', 'v')
    .replaceAll('ǘ', 'v').replaceAll('ǚ', 'v').replaceAll('ǜ', 'v')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  return `${marked} ${plain} ${plain.replace(/\s+/g, '')} ${vPlain} ${vPlain.replace(/\s+/g, '')}`;
}

// Runtime shape expected by review.js / lib/srs.js. Schedules are applied by
// lib/studysets.js afterwards, where they can be shared with saved-library
// cards and duplicate syllabus rows can become one practice card.
export function hskReviewCards(words) {
  return words.map((word, index) => ({
    cardType: 'word',
    hskId: word.id,
    hskLevel: word.level,
    simp: word.simp,
    trad: word.trad,
    pinyin: word.pinyin,
    tones: word.tones.join(','),
    defs: word.defs,
    pos: word.pos,
    notationSimp: word.notationSimp,
    notationTrad: word.notationTrad,
    // Stable source order for any unshuffled/test queue. The live queue is
    // still deterministically shuffled by lib/srs.js.
    savedAt: words.length - index,
    lastSavedAt: words.length - index,
    srs: null,
  }));
}
