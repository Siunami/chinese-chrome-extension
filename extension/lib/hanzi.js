// Which script the app shows: simplified or traditional.
//
// The preference already existed as a dropdown in Options, but only the hover
// popup read it — the review card and the saved library always led with
// simplified, so a traditional reader was studying the wrong form of their own
// cards. It is one setting (`hanziPref`, in chrome.storage.sync so it follows
// the browser profile), read here by everything that renders a headword and
// flipped from the navbar toggle in lib/shell.js.
//
// Cards carry both forms, so this is a display choice and never a conversion:
// nothing here rewrites text. Prose that only exists in one script — the study
// guides, a generated news passage — is left exactly as written.

export const HANZI_PREF_KEY = 'hanziPref';
export const SIMP_FIRST = 'simp-first';
export const TRAD_FIRST = 'trad-first';

export function isTradFirst(pref) {
  return pref === TRAD_FIRST;
}

export async function getHanziPref() {
  const { [HANZI_PREF_KEY]: pref } = await chrome.storage.sync
    .get({ [HANZI_PREF_KEY]: SIMP_FIRST })
    .catch(() => ({ [HANZI_PREF_KEY]: SIMP_FIRST }));
  return pref === TRAD_FIRST ? TRAD_FIRST : SIMP_FIRST;
}

export function setHanziPref(pref) {
  return chrome.storage.sync.set({
    [HANZI_PREF_KEY]: pref === TRAD_FIRST ? TRAD_FIRST : SIMP_FIRST,
  });
}

// Call `cb(pref)` whenever the setting changes, from this page or another.
export function onHanziPref(cb) {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'sync' && changes[HANZI_PREF_KEY]) {
      cb(changes[HANZI_PREF_KEY].newValue === TRAD_FIRST ? TRAD_FIRST : SIMP_FIRST);
    }
  });
}

// The form to lead with, and the other one — `null` when the card has only a
// single form (most sentence cards, and any word whose two scripts agree), so
// callers can drop the secondary line rather than printing the same characters
// twice.
export function forms(card, pref) {
  const simp = card?.simp || '';
  const trad = card?.trad || '';
  if (!trad || trad === simp) return { primary: simp, secondary: null };
  if (!simp) return { primary: trad, secondary: null };
  return isTradFirst(pref)
    ? { primary: trad, secondary: simp }
    : { primary: simp, secondary: trad };
}

// -----------------------------------------------------------------------
// Converting page text
//
// Cards carry both forms, so a card only has to choose. Everything else — a
// study guide written in simplified, a generated news passage, an example
// sentence — exists in one script and has to be converted, or the toggle only
// moves the handful of surfaces that happen to store a pair.
//
// Conversion needs the dictionary (see lib/script.js: it segments and swaps
// whole entries, because a character table gets 头发/发现 wrong), and the
// dictionary lives in the background worker. So these ship the strings there
// and back. One round trip per render, not one per string.
// -----------------------------------------------------------------------

export async function convertStrings(texts, pref) {
  if (!texts.length) return texts;
  const answer = await chrome.runtime.sendMessage({
    type: 'convertScript',
    texts,
    to: isTradFirst(pref) ? 'trad' : 'simp',
  }).catch(() => null);
  // A failed conversion shows the original text, which is readable and honest;
  // blanking the page would not be.
  return Array.isArray(answer?.texts) && answer.texts.length === texts.length
    ? answer.texts
    : texts;
}

const HAS_CHINESE = /[\u3400-\u9fff\uf900-\ufaff]/;

/**
 * Deep-convert every Chinese-bearing string in a value (object, array or
 * string), returning a new value of the same shape. Used on whole content
 * objects — a guide, a news digest — so a page converts once, before render,
 * rather than at every place it prints a character.
 *
 * Converting before render matters: once lib/lookup.js has wrapped text in
 * per-character spans there is no word left to segment, and 发 would have to be
 * guessed at.
 */
export async function convertDeep(value, pref) {
  const strings = [];
  const collect = (node) => {
    if (typeof node === 'string') {
      if (HAS_CHINESE.test(node)) strings.push(node);
      return;
    }
    if (Array.isArray(node)) { node.forEach(collect); return; }
    if (node && typeof node === 'object') Object.values(node).forEach(collect);
  };
  collect(value);
  if (!strings.length) return value;

  const converted = await convertStrings(strings, pref);
  const byOriginal = new Map();
  strings.forEach((s, i) => byOriginal.set(s, converted[i]));

  const rebuild = (node) => {
    if (typeof node === 'string') return byOriginal.get(node) ?? node;
    if (Array.isArray(node)) return node.map(rebuild);
    if (node && typeof node === 'object') {
      return Object.fromEntries(Object.entries(node).map(([k, v]) => [k, rebuild(v)]));
    }
    return node;
  };
  return rebuild(value);
}

// What to call the column or line holding the *other* form.
export function secondaryLabel(pref) {
  return isTradFirst(pref) ? 'Simp.' : 'Trad.';
}
