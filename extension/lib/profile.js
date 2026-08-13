// Learner-profile snapshot for the Worker's /api/news endpoint. Pure
// functions so the reading page and the tests share one implementation. The
// profile is deliberately small — capped lists of word strings plus deck
// statistics; the model estimates the level, we just summarize honestly.

const RECENT_LIMIT = 60;
const STRUGGLING_LIMIT = 25;
const KNOWN_LIMIT = 60;
const STRUGGLING_LAPSES = 2; // failed after graduating at least twice, or…
const STRUGGLING_EASE = 1.8; // …ease ground down well below the 2.5 start
const KNOWN_MIN_REPS = 2; // graduated (a couple of successful reviews) and…
const KNOWN_MIN_EASE = 2.2; // …still comfortable — the words to reuse in context
const MATURE_IVL_DAYS = 21;

// Cards the learner keeps failing, worst first.
export function strugglingWords(words) {
  return words
    .filter((w) => w.srs && (w.srs.lapses >= STRUGGLING_LAPSES || w.srs.ease <= STRUGGLING_EASE))
    .sort((a, b) => (b.srs.lapses - a.srs.lapses) || (a.srs.ease - b.srs.ease));
}

// Cards the learner reliably knows — graduated and still comfortable — most
// established first. These are the words a generated passage can lean on.
export function knownWords(words) {
  return words
    .filter((w) => w.srs && w.srs.reps >= KNOWN_MIN_REPS && w.srs.ease >= KNOWN_MIN_EASE)
    .sort((a, b) => (b.srs.ivl - a.srs.ivl) || (b.srs.ease - a.srs.ease));
}

export function buildProfile(words) {
  const vocab = words.filter((w) => (w.cardType || 'word') === 'word');
  const reviewed = vocab.filter((w) => w.srs);
  const struggling = strugglingWords(vocab);
  const strugglingSet = new Set(struggling.map((w) => w.simp));
  // Words to reuse in context — reliably known, and not also on the struggling
  // list (a lapse-heavy card that recovered its ease shouldn't count as known).
  const known = knownWords(vocab).filter((w) => !strugglingSet.has(w.simp));
  const recent = [...vocab].sort(
    (a, b) => (b.lastSavedAt || b.savedAt || 0) - (a.lastSavedAt || a.savedAt || 0),
  );
  const avgEase = reviewed.length
    ? Math.round((reviewed.reduce((sum, w) => sum + w.srs.ease, 0) / reviewed.length) * 100) / 100
    : null;
  return {
    savedWords: vocab.length,
    savedSentences: words.length - vocab.length,
    reviewedWords: reviewed.length,
    matureWords: reviewed.filter((w) => w.srs.ivl >= MATURE_IVL_DAYS).length,
    strugglingCount: struggling.length,
    avgEase,
    knownWords: known.slice(0, KNOWN_LIMIT).map((w) => w.simp),
    recentWords: recent.slice(0, RECENT_LIMIT).map((w) => w.simp),
    strugglingWords: struggling.slice(0, STRUGGLING_LIMIT).map((w) => w.simp),
  };
}
