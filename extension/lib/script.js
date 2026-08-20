// Converting text between simplified and traditional.
//
// The 简/繁 toggle picks which script the whole app is in, and most of the app
// is not a flashcard: study guides are written in simplified, a generated news
// passage comes back in simplified, example sentences are simplified. Those
// have to be converted at display time, or the toggle only moves the handful
// of places that happen to store both forms.
//
// Conversion is by WORD, not by character, because character mapping is
// ambiguous in the simplified→traditional direction and gets it confidently
// wrong: 头发 is 頭髮 but 发现 is 發現, and a character table has to pick one 发.
// Segmenting first and swapping whole dictionary entries gets both right,
// because CC-CEDICT stores the pair. Characters are the fallback for runs the
// dictionary does not know, where the most frequent mapping is the best
// available guess.
//
// The segmenter emits every character — unmatched ones as single-character
// tokens — so punctuation, latin text and whitespace survive untouched.

import { rankEntryIndices, segment } from './cedict.js';

export const TO_TRAD = 'trad';
export const TO_SIMP = 'simp';

/**
 * Character fallback tables, built once from the dictionary.
 *
 * Only entries whose two forms are the same length can be aligned character by
 * character; the rest (rare, and mostly variant spellings) are skipped. Where a
 * character maps several ways the most frequent wins, which is the closest a
 * table can get to being right without context.
 *
 * Staying the same is one of the ways a character maps, and by far the most
 * common one — so it is counted like any other and wins ties. Counting only the
 * pairs that differ meant a character that is almost always itself, but not
 * quite always, came out of the table as its rare other form every single time:
 * 家 is 家 in both scripts except in the two words spelled 傢俱 and 傢伙, and the
 * table said 家 → 傢, so a guide about 我的家 was converted to 我的傢. A character
 * only earns a row here when some other form genuinely beats leaving it alone,
 * which also keeps the table to the characters that need one.
 */
export function buildScriptMap(entries) {
  const tally = { toTrad: new Map(), toSimp: new Map() };
  const bump = (table, from, to) => {
    let counts = table.get(from);
    if (!counts) { counts = new Map(); table.set(from, counts); }
    counts.set(to, (counts.get(to) || 0) + 1);
  };

  for (const entry of entries) {
    const simp = Array.from(entry.simp || '');
    const trad = Array.from(entry.trad || '');
    if (!simp.length || simp.length !== trad.length) continue;
    for (let i = 0; i < simp.length; i++) {
      bump(tally.toTrad, simp[i], trad[i]);
      bump(tally.toSimp, trad[i], simp[i]);
    }
  }

  const pick = (table) => {
    const out = new Map();
    for (const [from, counts] of table) {
      let best = null;
      // The bar to clear is how often this character is simply itself; a
      // character with no row is left alone by convertText, which is the same
      // answer with none of the table.
      let bestN = counts.get(from) || 0;
      for (const [to, n] of counts) {
        if (to !== from && n > bestN) { best = to; bestN = n; }
      }
      if (best) out.set(from, best);
    }
    return out;
  };
  return { toTrad: pick(tally.toTrad), toSimp: pick(tally.toSimp) };
}

/**
 * Convert `text` into the `to` script ('trad' | 'simp').
 *
 * Text already in the target script comes back unchanged, so this is safe to
 * run over anything without knowing what it currently is.
 */
export function convertText(map, entries, scriptMap, text, to) {
  const source = String(text ?? '');
  if (!source) return source;
  const wantTrad = to === TO_TRAD;
  const chars = wantTrad ? scriptMap.toTrad : scriptMap.toSimp;

  let out = '';
  for (const token of segment(map, entries, source)) {
    const idxs = token.idxs;
    if (idxs && idxs.length) {
      // The index holds both forms as keys, so a token can match through the
      // script we are converting *from* or the one we are converting *to*.
      // Prefer the entry whose source-side form is literally this token: that
      // is the sense the text actually used, and the one whose pair is right.
      //
      // Several entries can share that form and still disagree about the other
      // script, so take them in the order the popup would show them rather than
      // the order the file lists them in. CEDICT puts 傢 家 ("used in 傢伙 and
      // 傢俱") above 家 家 ("home; family"), and first-in-the-file meant every
      // 家 in a converted guide became 傢.
      const from = wantTrad ? 'simp' : 'trad';
      const ranked = idxs.length > 1 ? rankEntryIndices(idxs, entries) : idxs;
      let entry = null;
      for (const i of ranked) {
        if (entries[i][from] === token.text) { entry = entries[i]; break; }
      }
      out += (entry || entries[ranked[0]])[wantTrad ? 'trad' : 'simp'];
      continue;
    }
    for (const ch of token.text) out += chars.get(ch) || ch;
  }
  return out;
}
