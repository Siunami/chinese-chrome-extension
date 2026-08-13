// Turning a piece of Chinese text into a flashcard.
//
// Saving used to be something only the hover popup could do, and only for the
// word it had looked up (or one of its example sentences). Everything else on
// screen — a sentence in an HSK grammar box, a line of a reading passage, a
// phrase highlighted on a web page — was unsavable even though it was exactly
// the kind of thing worth drilling. This module is the one place that answers
// "can this text be a card, and if so which card?", so every surface agrees.
//
// Two rules matter:
//
//   * A card is a word, a phrase, or a *single* sentence. A paragraph is not a
//     flashcard — reviewing one teaches recognition of its shape rather than
//     its language — so a multi-sentence or overlong selection is refused, and
//     the refusal says which it was so the UI can explain itself.
//
//   * Text that is exactly a dictionary headword becomes the same word card
//     the popup would have saved (same pinyin, same senses, so the same
//     cardKey). Saving 老师 from the HSK vocabulary list and saving it from a
//     hover popup must land on one card, not two.
//
// Anything else becomes a sentence card, annotated by the same engine that
// annotates the bundled example corpus, with the English translation the
// caller supplies — or, when there is none (a phrase highlighted in the wild),
// a word-by-word gloss built from the dictionary so the back of the card still
// says something.

import {
  MAX_WORD_LEN, parsePinyin, rankEntryIndices, sentencePinyin, segment,
  hasChinese,
} from './cedict.js';

// The backstop for text that carries no sentence punctuation at all — a whole
// unpunctuated paragraph, or a select-all. Sentence-hood is the real rule; this
// only catches what that rule cannot see. Set above the longest single sentence
// in the bundled material (91 characters, in an HSK 7 reading passage) so no
// genuine sentence is refused for being advanced.
export const MAX_CARD_CHARS = 120;

// Sentence enders, plus any closing quotes/brackets that ride along with them.
const SENTENCE_END = /[。！？!?…]/;
const CLOSERS = /[”’"'』」）)】》]/;

// Punctuation and whitespace at either end of a selection: highlighting a word
// with a comma stuck to it should still find the word.
const EDGE_TRIM = /^[\s\p{P}\p{S}]+|[\s\p{P}\p{S}]+$/gu;

// Split text into sentences, each keeping its own terminator. Used both to
// decide whether a selection is one sentence and to offer the reading passage
// one savable sentence at a time.
export function splitSentences(text) {
  const chars = Array.from(String(text || ''));
  const out = [];
  let start = 0;
  let i = 0;
  while (i < chars.length) {
    if (!SENTENCE_END.test(chars[i])) { i++; continue; }
    while (i + 1 < chars.length && SENTENCE_END.test(chars[i + 1])) i++;   // 。。。 ……
    while (i + 1 < chars.length && CLOSERS.test(chars[i + 1])) i++;        // 」 ”
    const piece = chars.slice(start, i + 1).join('').trim();
    if (piece) out.push(piece);
    start = i + 1;
    i = start;
  }
  const tail = chars.slice(start).join('').trim();
  if (tail) out.push(tail);
  return out;
}

// Why this text cannot be a card, or null if it can. The reasons are the
// strings the UI turns into an explanation, so keep them stable.
//
// `unit` says the caller vouches that this text is one item: a guide's grammar
// example is sometimes two sentences ("城市人口不断增加。与此同时，…") because
// that is what it takes to show the pattern, and it comes with a translation
// written for exactly those two. A highlight has no such author, so the
// one-sentence rule is what keeps it from being a paragraph.
export function cardTextIssue(text, { unit = false } = {}) {
  const trimmed = String(text || '').replace(/\s+/g, ' ').trim();
  if (!trimmed) return 'empty';
  if (!hasChinese(trimmed)) return 'no-chinese';
  if (Array.from(trimmed).length > MAX_CARD_CHARS) return 'too-long';
  if (!unit && splitSentences(trimmed).length > 1) return 'multi-sentence';
  return null;
}

// A word-by-word reading of a phrase, for the back of a card nobody has
// translated: 我是学生 -> "我 I, me · 是 to be · 学生 student". Repeats are
// dropped (的 four times teaches nothing the first one didn't) and each sense
// is cut to its first definition, so this stays a gloss rather than a
// dictionary dump.
const GLOSS_MAX_TOKENS = 20;
const GLOSS_MAX_CHARS = 400;
const GLOSS_DEF_CHARS = 44;

// CC-CEDICT hangs usage notes off the end of a sense ("to be (followed by
// substantives only)"). A gloss wants the sense, not the note.
function trimTrailingNote(def) {
  const short = String(def || '').replace(/\s*\([^()]*\)\s*$/, '').trim();
  return short || String(def || '').trim();
}

export function glossFor(map, entries, text) {
  const parts = [];
  const seen = new Set();
  for (const token of segment(map, entries, text)) {
    if (!token.idxs || !token.idxs.length || seen.has(token.text)) continue;
    if (!hasChinese(token.text)) continue;
    const best = entries[rankEntryIndices(token.idxs, entries)[0]];
    const def = trimTrailingNote((best?.defs || [])[0]);
    if (!def) continue;
    seen.add(token.text);
    parts.push(`${token.text} ${def.length > GLOSS_DEF_CHARS
      ? `${def.slice(0, GLOSS_DEF_CHARS - 1).trim()}…` : def}`);
    if (parts.length >= GLOSS_MAX_TOKENS) break;
  }
  let gloss = parts.join(' · ');
  if (gloss.length > GLOSS_MAX_CHARS) {
    gloss = `${gloss.slice(0, GLOSS_MAX_CHARS - 1).trimEnd()}…`;
  }
  return gloss;
}

// The dictionary entry a bare headword should save as: the same ranking the
// popup shows first, so the card matches what the learner saw there.
function headwordEntry(map, entries, text) {
  const word = text.replace(EDGE_TRIM, '');
  if (!word || Array.from(word).length > MAX_WORD_LEN) return null;
  const idxs = map.get(word);
  if (!idxs || !idxs.length) return null;
  return entries[rankEntryIndices(idxs, entries)[0]] || null;
}

// Resolve text into a card ready for the saveWord handler, or the reason it
// cannot be one. `en` is a translation the caller already has (an HSK example
// sentence carries one); it is used only for sentence cards, because a word
// card's definition has to come from the dictionary for its key to line up
// with the same word saved from the popup. `unit` is described on
// cardTextIssue: curated text is one item because its author made it one.
export function resolveCard({ map, entries, text, en = '', sourceWord = '', unit = false }) {
  const trimmed = String(text || '').replace(/\s+/g, ' ').trim();
  const issue = cardTextIssue(trimmed, { unit });
  if (issue) return { issue };

  const entry = headwordEntry(map, entries, trimmed);
  if (entry) {
    const syllables = parsePinyin(entry.pinyin);
    return {
      card: {
        cardType: 'word',
        simp: entry.simp,
        trad: entry.trad,
        pinyin: syllables.map((s) => s.text).join(' '),
        tones: syllables.map((s) => s.tone).join(','),
        defs: entry.defs.join('; '),
        sourceWord: '',
      },
    };
  }

  const translation = String(en || '').replace(/\s+/g, ' ').trim();
  const card = {
    cardType: 'sentence',
    simp: trimmed,
    trad: trimmed,
    pinyin: sentencePinyin(map, entries, trimmed),
    tones: '',
    defs: translation || glossFor(map, entries, trimmed),
    sourceWord: String(sourceWord || ''),
  };
  // A word-by-word gloss says what the words are, not what the sentence means.
  // Mark it so the service worker knows to ask for a real translation; the
  // flag is cleared when one lands. See translateGlossedCards in background.js.
  if (!translation) card.glossed = true;
  return { card };
}

// Whether this card's back is a machine gloss rather than a translation —
// true for a card marked at save time, and recomputed for cards saved before
// that marker existed (the gloss is deterministic, so it can be recognised
// exactly rather than guessed at).
export function isMachineGloss(map, entries, card) {
  if (!card || card.cardType !== 'sentence' || card.deleted) return false;
  if (card.glossed) return true;
  const defs = String(card.defs || '');
  return defs !== '' && defs === glossFor(map, entries, String(card.simp || ''));
}
