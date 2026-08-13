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

// What to call the column or line holding the *other* form.
export function secondaryLabel(pref) {
  return isTradFirst(pref) ? 'Simp.' : 'Trad.';
}
