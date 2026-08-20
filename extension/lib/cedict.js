// Shared CC-CEDICT parsing, pinyin, lookup and segmentation utilities.
// Imported by the MV3 service worker (module) and by the Node build/test scripts.

export const MAX_WORD_LEN = 20; // longest CC-CEDICT headword is 19 code points

// ---------------------------------------------------------------------------
// Pinyin: numbered CC-CEDICT syllables ("shi4", "lu:3") -> diacritics ("shì", "lǚ")
// ---------------------------------------------------------------------------

const TONE_MARKS = {
  a: 'āáǎà', e: 'ēéěè', i: 'īíǐì', o: 'ōóǒò', u: 'ūúǔù', 'ü': 'ǖǘǚǜ',
  A: 'ĀÁǍÀ', E: 'ĒÉĚÈ', I: 'ĪÍǏÌ', O: 'ŌÓǑÒ', U: 'ŪÚǓÙ', 'Ü': 'ǕǗǙǛ',
};

export function syllableToDiacritic(syl, tone) {
  if (tone < 1 || tone > 4) return syl;
  const lower = syl.toLowerCase();
  let idx = -1;
  if (lower.includes('a')) idx = lower.indexOf('a');
  else if (lower.includes('e')) idx = lower.indexOf('e');
  else if (lower.includes('ou')) idx = lower.indexOf('o');
  else {
    for (let i = syl.length - 1; i >= 0; i--) {
      if ('iouü'.includes(lower[i])) { idx = i; break; }
    }
  }
  if (idx === -1) return syl;
  const marks = TONE_MARKS[syl[idx]];
  if (!marks) return syl;
  return syl.slice(0, idx) + marks[tone - 1] + syl.slice(idx + 1);
}

// "shi4 fou3" -> [{ text: 'shì', tone: 4 }, { text: 'fǒu', tone: 3 }]
// Tokens that are not pinyin syllables (letters, "·", "," in CEDICT) pass
// through with tone 0.
export function parsePinyin(numbered) {
  const out = [];
  for (const rawTok of String(numbered).split(/\s+/)) {
    if (!rawTok) continue;
    const tok = rawTok.replace(/u:/g, 'ü').replace(/U:/g, 'Ü');
    const m = /^([a-zA-ZüÜ]+)([1-5])$/.exec(tok);
    if (!m) {
      out.push({ text: tok, tone: 0 });
      continue;
    }
    const tone = Number(m[2]);
    out.push({ text: syllableToDiacritic(m[1], tone), tone });
  }
  return out;
}

export function pinyinToDisplay(numbered) {
  return parsePinyin(numbered).map((s) => s.text).join(' ');
}

// ---------------------------------------------------------------------------
// CC-CEDICT parsing
// ---------------------------------------------------------------------------

const LINE_RE = /^(\S+)\s+(\S+)\s+\[([^\]]*)\]\s+\/(.+)\/\s*$/;

// Parses original CC-CEDICT text. Returns entries: { trad, simp, pinyin, defs }.
export function parseCedict(text) {
  const entries = [];
  for (const line of text.split('\n')) {
    if (!line || line.startsWith('#')) continue;
    const m = LINE_RE.exec(line);
    if (!m) continue;
    entries.push({
      trad: m[1],
      simp: m[2],
      pinyin: m[3].trim(),
      defs: m[4].split('/').filter(Boolean),
    });
  }
  return entries;
}

// Compact TSV used inside the extension: trad \t simp \t pinyin \t def/def/def
export function entriesToTSV(entries) {
  return entries
    .map((e) => [e.trad, e.simp, e.pinyin, e.defs.join('/')].join('\t'))
    .join('\n');
}

export function parseDictTSV(text) {
  const entries = [];
  for (const line of text.split('\n')) {
    if (!line) continue;
    const parts = line.split('\t');
    if (parts.length < 4) continue;
    entries.push({
      trad: parts[0],
      simp: parts[1],
      pinyin: parts[2],
      defs: parts[3].split('/').filter(Boolean),
    });
  }
  return entries;
}

// ---------------------------------------------------------------------------
// Index + lookup
// ---------------------------------------------------------------------------

// word (either script) -> array of entry indices
export function buildIndex(entries) {
  const map = new Map();
  const add = (w, i) => {
    const arr = map.get(w);
    if (arr) { if (!arr.includes(i)) arr.push(i); }
    else map.set(w, [i]);
  };
  for (let i = 0; i < entries.length; i++) {
    add(entries[i].simp, i);
    if (entries[i].trad !== entries[i].simp) add(entries[i].trad, i);
  }
  return map;
}

// Pleco-style chunk-aware lookup: `text` is a window of page text and
// `cursorIndex` (code points) is the hovered character. The primary result is
// the segmentation token CONTAINING the cursor (so hovering 欢 in 我喜欢你
// yields 喜欢, not just 欢), followed by forward matches from the cursor char.
// Returns { groups: [{ word, start, entries }], highlight: { start, length } }
// with start/length in code points relative to `text`.
export function lookupAt(map, entries, text, cursorIndex) {
  const chars = Array.from(text);
  if (chars.length === 0) return { groups: [], highlight: null };
  const cursor = Math.min(Math.max(cursorIndex || 0, 0), chars.length - 1);

  let primary = null;
  let pos = 0;
  for (const t of segment(map, entries, text)) {
    const len = Array.from(t.text).length;
    if (cursor < pos + len) {
      if (t.idxs) primary = { word: t.text, start: pos, idxs: t.idxs };
      break;
    }
    pos += len;
  }

  const groups = [];
  if (primary) {
    groups.push({
      word: primary.word,
      start: primary.start,
      entries: primary.idxs.map((i) => entries[i]),
    });
  }
  for (const m of lookup(map, entries, chars.slice(cursor).join(''))) {
    if (primary && m.word === primary.word) continue;
    groups.push({ word: m.word, start: cursor, entries: m.entries });
  }
  if (groups.length === 0) return { groups: [], highlight: null };
  return {
    groups,
    highlight: { start: groups[0].start, length: Array.from(groups[0].word).length },
  };
}

const BAD_DEF = /^(variant of|old variant of|surname |used in |see |archaic|\(archaic\)|\(bound form\))/i;

// Put the most useful everyday sense first in compact character breakdowns.
// CEDICT file order often places a surname or variant before the ordinary
// lowercase reading (e.g. 国 Guo2 before guo2, or 欢's variant entry before
// "joyous; happy"). Preserve source order when two entries score equally.
export function rankEntryIndices(idxs, entries) {
  return idxs
    .map((idx, order) => {
      const e = entries[idx];
      let score = /^[A-Z]/.test(e.pinyin) ? 0 : 20;
      if (e.defs.length > 0 && e.defs.every((d) => BAD_DEF.test(d))) score -= 30;
      else score += 10;
      score += Math.min(e.defs.length, 5);
      return { idx, order, score };
    })
    .sort((a, b) => b.score - a.score || a.order - b.order)
    .map((item) => item.idx);
}

// ---------------------------------------------------------------------------
// Related words
// ---------------------------------------------------------------------------

const RELATED_STOP_WORDS = new Set([
  'the', 'and', 'for', 'from', 'with', 'without', 'into', 'onto', 'over',
  'under', 'between', 'among', 'that', 'this', 'these', 'those', 'which',
  'who', 'whom', 'whose', 'one', 'ones', 'someone', 'somebody', 'something',
  'oneself', 'sth', 'sb', 'his', 'her', 'their', 'its', 'our', 'your',
  'are', 'was', 'were', 'been', 'being', 'have', 'has', 'had', 'does', 'did',
  'can', 'could', 'may', 'might', 'must', 'shall', 'should', 'will', 'would',
  'not', 'also', 'very', 'more', 'most', 'less', 'than', 'then', 'such',
  'used', 'using', 'use', 'refers', 'refer', 'means', 'meaning', 'pertaining',
  'related', 'classifier', 'measure', 'word', 'term', 'variant', 'form', 'old',
  'archaic', 'abbr', 'abbreviation', 'surname', 'name', 'place', 'person',
  'people', 'kind', 'type', 'make', 'take', 'give', 'become', 'cause',
  'indicate', 'express', 'especially', 'usually', 'etc', 'lit', 'fig', 'idiom',
  'coll', 'dialect', 'slang', 'taiwan', 'pronounced', 'pronunciation',
]);

function normalizeRelatedToken(token) {
  let t = token.toLowerCase();
  if (t.length > 5 && t.endsWith('ies')) t = `${t.slice(0, -3)}y`;
  else if (t.length > 5 && /(ses|xes|zes|ches|shes)$/.test(t)) t = t.slice(0, -2);
  else if (t.length > 3 && t.endsWith('s')) t = t.slice(0, -1);
  return t;
}

function definitionTokens(text) {
  // Strip CEDICT cross-reference readings so romanized pinyin (e.g. tai2)
  // does not become a false English similarity signal.
  const clean = String(text).replace(/\[[^\]]*\]/g, ' ');
  const words = clean.match(/[a-zA-Z]{3,}/g) || [];
  const out = new Set();
  for (const word of words) {
    if (RELATED_STOP_WORDS.has(word.toLowerCase())) continue;
    const token = normalizeRelatedToken(word);
    if (token.length >= 3 && !RELATED_STOP_WORDS.has(token)) out.add(token);
  }
  return [...out];
}

function primaryDefinition(entry) {
  return entry.defs.find((d) => !BAD_DEF.test(d)) || entry.defs[0] || '';
}

const CROSS_REF_RE = /([㐀-鿿豈-﫿]+)(?:\|([㐀-鿿豈-﫿]+))?\[[^\]]+\]/g;

function crossReferences(entry) {
  const refs = new Set();
  for (const def of entry.defs) {
    CROSS_REF_RE.lastIndex = 0;
    let m;
    while ((m = CROSS_REF_RE.exec(def))) {
      refs.add(m[1]);
      if (m[2]) refs.add(m[2]);
    }
  }
  return refs;
}

// Built once with the dictionary. The index is deliberately compact: arrays
// of token strings and entry ids, rather than a second copy of definition text.
export function buildRelatedIndex(entries) {
  const charToEntries = new Map();
  const tokenToEntries = new Map();
  const allTokens = new Array(entries.length);
  const primaryTokens = new Array(entries.length);
  const add = (map, key, i) => {
    const list = map.get(key);
    if (list) list.push(i);
    else map.set(key, [i]);
  };

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    const chars = new Set(Array.from(entry.simp + entry.trad));
    for (const ch of chars) add(charToEntries, ch, i);
    const tokens = definitionTokens(entry.defs.join(' '));
    const primary = definitionTokens(primaryDefinition(entry));
    allTokens[i] = tokens;
    primaryTokens[i] = primary;
    for (const token of tokens) add(tokenToEntries, token, i);
  }
  return { charToEntries, tokenToEntries, allTokens, primaryTokens };
}

// Returns [{ idx, reason, sharedChars, score }], best first. Semantic matches
// use the source entry's primary definition so a secondary sense does not
// dominate (e.g. 吃 "to suffer defeat" should not recommend 打垮 "to defeat").
export function findRelated(entries, map, relatedIndex, word, limit = 6) {
  if (!relatedIndex || limit <= 0) return [];
  const sourceIds = map.get(word) || [];
  if (sourceIds.length === 0) return [];
  const sourceIdx = rankEntryIndices(sourceIds, entries)[0];
  const source = entries[sourceIdx];
  const queryTokens = new Set(relatedIndex.primaryTokens[sourceIdx]);
  const sourceChars = new Set(Array.from(source.simp + source.trad));
  const sourceLen = Array.from(source.simp).length;
  const directRefs = crossReferences(source);
  const candidates = new Set();

  for (const ch of sourceChars) {
    for (const i of relatedIndex.charToEntries.get(ch) || []) candidates.add(i);
  }
  for (const token of queryTokens) {
    const ids = relatedIndex.tokenToEntries.get(token) || [];
    // Extremely broad definition words create noise and large candidate sets.
    if (ids.length <= 4000) for (const i of ids) candidates.add(i);
  }
  for (const ref of directRefs) {
    for (const i of map.get(ref) || []) candidates.add(i);
  }

  const bestByHeadword = new Map();
  for (const idx of candidates) {
    const entry = entries[idx];
    if (
      entry.simp === source.simp || entry.simp === source.trad ||
      entry.trad === source.simp || entry.trad === source.trad
    ) continue;
    const candidateLen = Array.from(entry.simp).length;
    if (candidateLen === 0 || candidateLen > 8) continue;
    // Phrase pages already have a dedicated constituent-character section.
    if (sourceLen > 1 && candidateLen === 1) continue;

    const candidateChars = new Set(Array.from(entry.simp + entry.trad));
    const sharedChars = [...sourceChars].filter((ch) => candidateChars.has(ch));
    const family =
      entry.simp.includes(source.simp) || entry.trad.includes(source.trad) ||
      entry.simp.includes(source.trad) || entry.trad.includes(source.simp);
    const direct = directRefs.has(entry.simp) || directRefs.has(entry.trad);
    const candidateTokens = new Set(relatedIndex.allTokens[idx]);
    const candidatePrimaryList = relatedIndex.primaryTokens[idx];
    const candidatePrimary = new Set(candidatePrimaryList);
    let semantic = 0;
    let primaryOverlap = 0;
    let overlapCount = 0;
    for (const token of queryTokens) {
      if (!candidateTokens.has(token)) continue;
      const frequency = relatedIndex.tokenToEntries.get(token)?.length || entries.length;
      const weight = Math.min(10, Math.log((entries.length + 1) / (frequency + 1)));
      semantic += weight;
      overlapCount++;
      if (candidatePrimary.has(token)) primaryOverlap += weight;
    }

    if (!direct && !family && semantic === 0) continue;
    // Long expressions sharing only a broad semantic token are usually
    // examples or idioms, not useful near-synonyms.
    if (!direct && !family && sharedChars.length === 0 && candidateLen > 3 && primaryOverlap < 6) {
      continue;
    }
    if (!direct && !family && sharedChars.length === 0 && queryTokens.size === 1) {
      const token = queryTokens.values().next().value;
      if (candidatePrimaryList.indexOf(token) !== 0 || candidateLen > 3) continue;
    }
    if (
      !direct && !family && sharedChars.length === 0 && queryTokens.size > 1 &&
      overlapCount < queryTokens.size && semantic < 9
    ) {
      continue;
    }

    let score = direct ? 80 : 0;
    score += family ? 12 : 0;
    score += sharedChars.length * 3;
    score += semantic * 3 + primaryOverlap;
    if (candidateLen >= 2 && candidateLen <= 3) score += 2;
    if (!family && candidateLen >= 4) score -= (candidateLen - 3) * 5;
    if (/^[A-Z]/.test(entry.pinyin)) score -= 12;
    if (entry.defs.length > 0 && entry.defs.every((d) => BAD_DEF.test(d))) score -= 20;

    const reason = direct ? 'dictionary reference' : family ? 'word family' :
      overlapCount >= queryTokens.size ? 'similar meaning' :
        semantic > 0 ? 'related meaning' : 'related';
    const key = `${entry.simp}\u0000${entry.trad}`;
    const old = bestByHeadword.get(key);
    if (!old || score > old.score) {
      bestByHeadword.set(key, { idx, reason, sharedChars, score });
    }
  }

  return [...bestByHeadword.values()]
    .sort((a, b) => b.score - a.score || a.idx - b.idx)
    .slice(0, limit);
}

// Per-character breakdown of a multi-character word, for showing the pieces
// of a phrase under its definition. Returns [{ char, idxs }] (repeated
// characters listed once); empty for single-character words.
export function charBreakdown(map, word) {
  const chars = Array.from(word);
  if (chars.length < 2) return [];
  const seen = new Set();
  const out = [];
  for (const ch of chars) {
    if (seen.has(ch)) continue;
    seen.add(ch);
    const idxs = map.get(ch);
    if (idxs) out.push({ char: ch, idxs });
  }
  return out;
}

// All dictionary matches at the START of `text`, longest first.
// Returns [{ word, length, entries: [entry, ...] }], length in code points.
export function lookup(map, entries, text) {
  const chars = Array.from(text);
  const results = [];
  for (let len = Math.min(chars.length, MAX_WORD_LEN); len >= 1; len--) {
    const w = chars.slice(0, len).join('');
    const idxs = map.get(w);
    if (idxs) {
      results.push({ word: w, length: len, entries: idxs.map((i) => entries[i]) });
    }
  }
  return results;
}

// Greedy longest-match segmentation, forward. Returns [{ text, idxs|null }].
export function segmentForward(map, entries, text) {
  const chars = Array.from(text);
  const tokens = [];
  let i = 0;
  while (i < chars.length) {
    let matched = null;
    for (let len = Math.min(MAX_WORD_LEN, chars.length - i); len >= 1; len--) {
      const w = chars.slice(i, i + len).join('');
      const idxs = map.get(w);
      if (idxs) { matched = { word: w, idxs, len }; break; }
    }
    if (matched) {
      tokens.push({ text: matched.word, idxs: matched.idxs });
      i += matched.len;
    } else {
      tokens.push({ text: chars[i], idxs: null });
      i += 1;
    }
  }
  return tokens;
}

// Greedy longest-match segmentation, backward (from the end of the text).
export function segmentBackward(map, entries, text) {
  const chars = Array.from(text);
  const tokens = [];
  let i = chars.length;
  while (i > 0) {
    let matched = null;
    for (let len = Math.min(MAX_WORD_LEN, i); len >= 1; len--) {
      const w = chars.slice(i - len, i).join('');
      const idxs = map.get(w);
      if (idxs) { matched = { word: w, idxs, len }; break; }
    }
    if (matched) {
      tokens.unshift({ text: matched.word, idxs: matched.idxs });
      i -= matched.len;
    } else {
      tokens.unshift({ text: chars[i - 1], idxs: null });
      i -= 1;
    }
  }
  return tokens;
}

// Very common two-char words used as a tie-break so BiMM does not split e.g.
// 没有 into 没|有水 just because 有水 happens to be a CEDICT entry.
const COMMON_WORDS = new Set([
  '没有', '沒有', '知道', '可以', '现在', '現在', '已经', '已經', '因为', '因為',
  '所以', '还是', '還是', '但是', '如果', '觉得', '覺得', '喜欢', '喜歡',
  '什么', '什麼', '怎么', '怎麼', '时候', '時候', '东西', '東西', '一起',
  '非常', '应该', '應該', '开始', '開始', '需要', '然后', '然後', '不过', '不過',
]);

// Bidirectional maximum matching: run forward and backward greedy matching
// and keep the better segmentation. Preference order: fewer tokens, more
// COMMON_WORDS tokens, fewer single-char dictionary words, then backward
// (the standard BiMM default — it is what fixes 她|在行|走 → 她|在|行走).
export function segment(map, entries, text) {
  const fwd = segmentForward(map, entries, text);
  const bwd = segmentBackward(map, entries, text);
  if (fwd.length !== bwd.length) return fwd.length < bwd.length ? fwd : bwd;
  const common = (toks) => toks.reduce((n, t) => n + (COMMON_WORDS.has(t.text) ? 1 : 0), 0);
  const cf = common(fwd);
  const cb = common(bwd);
  if (cf !== cb) return cf > cb ? fwd : bwd;
  const singles = (toks) =>
    toks.reduce((n, t) => n + (t.idxs && Array.from(t.text).length === 1 ? 1 : 0), 0);
  return singles(fwd) < singles(bwd) ? fwd : bwd;
}

// ---------------------------------------------------------------------------
// Reading selection (for annotating sentences with pinyin)
// ---------------------------------------------------------------------------

// Common structural particles whose most frequent reading is not the first
// CC-CEDICT entry. Only used for sentence annotation, never for the popup
// definitions (which list every entry).
const READING_OVERRIDES = new Map([
  ['的', 'de5'],
  ['了', 'le5'],
  ['着', 'zhe5'],
  ['著', 'zhe5'],
  ['得', 'de5'],
  ['地', 'de5'],
  ['吗', 'ma5'],
  ['嗎', 'ma5'],
  ['吧', 'ba5'],
  ['呢', 'ne5'],
  ['啊', 'a5'],
  ['呀', 'ya5'],
  ['嘛', 'ma5'],
  ['啦', 'la5'],
  // High-frequency homographs where CEDICT entry order or def counts would
  // otherwise pick the rarer reading (e.g. 没→mo4, 看→kan1, 行→hang2).
  ['看', 'kan4'],
  ['没', 'mei2'],
  ['沒', 'mei2'],
  ['行', 'xing2'],
  ['重', 'zhong4'],
  ['为', 'wei4'],
  ['為', 'wei4'],
]);

export function pickReading(word, idxs, entries) {
  const override = READING_OVERRIDES.get(word);
  if (override) return override;
  let best = null;
  let bestScore = -Infinity;
  for (const i of idxs) {
    const e = entries[i];
    let score = 0;
    if (/^[A-Z]/.test(e.pinyin)) score -= 10; // proper noun reading
    if (e.defs.length > 0 && e.defs.every((d) => BAD_DEF.test(d))) score -= 5;
    score += Math.min(e.defs.length, 3) * 0.1;
    if (score > bestScore) { best = e; bestScore = score; }
  }
  return best ? best.pinyin : null;
}

const CJK_RE = /[㐀-鿿豈-﫿]|[\ud840-\ud87f][\udc00-\udfff]/;

export function hasChinese(text) {
  return CJK_RE.test(text);
}

// Context rules for readings that depend on the neighboring token. Applied
// on top of READING_OVERRIDES during sentence annotation.
const DEI_TRIGGERS = new Set([
  '我', '你', '妳', '他', '她', '它', '我们', '我們', '你们', '你們',
  '他们', '他們', '她们', '她們', '咱们', '咱們', '谁', '誰', '大家',
  '还', '還', '也', '都', '就', '才', '再',
]);
const NUMERAL_END_RE = /[0-9０-９〇零一两兩二三四五六七八九十百千万萬几幾每这那這哪]$/;

function contextualReading(prevText, tokText) {
  if (tokText === '只' && prevText && NUMERAL_END_RE.test(prevText)) return 'zhi1';
  if (tokText === '得') {
    // clause-initial or after a subject/adverb: modal děi ("have to");
    // after anything else (usually a verb): complement particle de.
    if (!prevText || /[，。！？；：、,!?;:]$/.test(prevText) || DEI_TRIGGERS.has(prevText)) {
      return 'dei3';
    }
  }
  return null;
}

// Whole-sentence pinyin annotation via greedy segmentation.
export function sentencePinyin(map, entries, zh) {
  const tokens = segment(map, entries, zh);
  const parts = [];
  let prevText = '';
  for (const t of tokens) {
    if (t.idxs) {
      const reading =
        contextualReading(prevText, t.text) || pickReading(t.text, t.idxs, entries);
      if (reading) {
        parts.push(parsePinyin(reading).map((s) => s.text).join(''));
        prevText = t.text;
        continue;
      }
    }
    parts.push(t.text);
    prevText = t.text;
  }
  let s = parts.join(' ');
  // tidy spacing around punctuation
  s = s.replace(/\s+([，。！？；：、）」』”’!?,.;:])/g, '$1');
  s = s.replace(/([（「『“‘])\s+/g, '$1');
  return s;
}

// ---------------------------------------------------------------------------
// Example sentences
// ---------------------------------------------------------------------------

// sentences: [{ zh, py, en }] pre-sorted by zh length ascending.
// Prefers sentences where the word appears on a segmentation boundary (so
// hovering 是 does not return sentences that only contain 是否).
export function findExamples(sentences, simp, trad, limit, map, entries) {
  if (limit <= 0) return [];
  const results = [];
  const fallback = [];
  const seen = new Set();
  let verified = 0;
  const wordLen = Array.from(simp).length;
  for (const s of sentences) {
    if (results.length >= limit) break;
    const hit = s.zh.includes(simp) || (trad !== simp && s.zh.includes(trad));
    if (!hit) continue;
    if (Array.from(s.zh).length < wordLen + 2) continue; // skip trivial "是的。"
    if (seen.has(s.zh)) continue;
    seen.add(s.zh);
    if (map && verified < 400) {
      verified++;
      const ok = segment(map, entries, s.zh).some(
        (t) => t.text === simp || t.text === trad,
      );
      if (!ok) { fallback.push(s); continue; }
    }
    results.push(s);
  }
  while (results.length < limit && fallback.length) results.push(fallback.shift());
  return results;
}
