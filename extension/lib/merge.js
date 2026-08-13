// Per-card merge for syncing flashcards between devices. The extension, the
// PWA, and the sync Worker all run this same module, so every replica applies
// identical rules and converges. Pure functions, no browser APIs.
//
// Cards merge per field group so concurrent edits on different devices both
// survive:
//   - content fields (defs, tones, cardType, sourceWord) follow the later
//     `lastSavedAt` (a re-save)
//   - the `srs` object follows the later `srs.reviewedAt` (stamped by
//     schedule() on every grade) and is taken wholesale, never field-mixed
//   - deletions are tombstones { deleted: true, deletedAt } and win only over
//     cards not saved or reviewed after the deletion, so a later re-save or
//     review resurrects the card
// mergeCards is commutative, associative in effect, and idempotent; ties break
// deterministically so two replicas can merge in either order.

export const KEY_SEP = '\u0001';

// Identity matches handleSaveWord in background.js: homographs sharing a
// simplified form stay distinct; a missing trad equals simp.
export function cardKey(c) {
  return [c.cardType || 'word', c.simp || '', c.trad || c.simp || '', c.pinyin || '']
    .join(KEY_SEP);
}

// Latest moment a card was meaningfully touched by a save or a review.
export function aliveClock(c) {
  return Math.max(c.lastSavedAt || 0, (c.srs && c.srs.reviewedAt) || 0);
}

// Identity fields for a tombstone (all we need to delete the card elsewhere).
export function tombstoneFor(c, deletedAt) {
  return {
    deleted: true,
    deletedAt,
    cardType: c.cardType || 'word',
    simp: c.simp,
    trad: c.trad || '',
    pinyin: c.pinyin,
  };
}

// Deterministic tie-break when both sides re-saved at the same millisecond.
function contentRank(c) {
  return [c.defs || '', c.tones || '', c.sourceWord || ''].join(KEY_SEP);
}

// Total order on SRS states: later review wins; a reviewed card beats a
// never-reviewed one; legacy states without reviewedAt fall back to progress.
function srsRank(c) {
  const s = c.srs;
  return [(s && s.reviewedAt) || 0, s ? 1 : 0, (s && s.reps) || 0, (s && s.due) || 0];
}

function cmp(a, b) {
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1;
  }
  return 0;
}

export function mergeCards(a, b) {
  if (!a) return b;
  if (!b) return a;
  const aDead = !!a.deleted;
  const bDead = !!b.deleted;
  if (aDead && bDead) return (b.deletedAt || 0) > (a.deletedAt || 0) ? b : a;
  if (aDead !== bDead) {
    const dead = aDead ? a : b;
    const live = aDead ? b : a;
    return (dead.deletedAt || 0) > aliveClock(live) ? dead : live;
  }
  const la = a.lastSavedAt || 0;
  const lb = b.lastSavedAt || 0;
  const content =
    lb > la || (lb === la && contentRank(b) > contentRank(a)) ? b : a;
  const srsWinner = cmp(srsRank(b), srsRank(a)) > 0 ? b : a;
  const savedA = a.savedAt || 0;
  const savedB = b.savedAt || 0;
  return {
    ...content,
    savedAt: savedA && savedB ? Math.min(savedA, savedB) : savedA || savedB,
    lastSavedAt: Math.max(la, lb),
    touches: Math.max(a.touches || 0, b.touches || 0),
    srs: srsWinner.srs ? { ...srsWinner.srs } : null,
  };
}

// ---------------------------------------------------------------------------
// Sync protocol helpers (shared by extension/lib/sync.js, pwa/sync.js, and
// the protocol tests). A replica's state is live `cards` + `tombstones`.
// ---------------------------------------------------------------------------

// Cards and tombstones touched since the last successful push.
export function changedSince(cards, tombstones, since) {
  const out = [];
  for (const c of cards) if (aliveClock(c) > since) out.push(c);
  for (const t of tombstones) if ((t.deletedAt || 0) > since) out.push({ ...t, deleted: true });
  return out;
}

// Merge remote cards (from a pull) into local state. Returns new
// { cards, tombstones }; cards sorted newest-first to match the wordlist's
// unshift order, everything deterministic.
export function applyRemote(cards, tombstones, remoteCards) {
  const byKey = new Map();
  const put = (c) => {
    const k = cardKey(c);
    byKey.set(k, mergeCards(byKey.get(k), c));
  };
  for (const t of tombstones) put({ ...t, deleted: true });
  for (const c of cards) put(c);
  for (const c of remoteCards || []) put(c);
  const live = [];
  const dead = [];
  for (const [k, c] of byKey) (c.deleted ? dead : live).push([k, c]);
  live.sort(([ka, a], [kb, b]) =>
    (b.lastSavedAt || 0) - (a.lastSavedAt || 0) || (ka < kb ? -1 : 1));
  dead.sort(([ka, a], [kb, b]) =>
    (b.deletedAt || 0) - (a.deletedAt || 0) || (ka < kb ? -1 : 1));
  return { cards: live.map(([, c]) => c), tombstones: dead.map(([, c]) => c) };
}

// Enforce the wordlist cap without silently dropping synced cards: keep cards
// with review progress and recent activity, tombstone the rest so every
// device evicts the same cards.
export function capCards(cards, max, now) {
  if (cards.length <= max) return { cards, tombstones: [] };
  const ranked = cards
    .map((c) => c)
    .sort((x, y) => {
      const px = x.srs ? 1 : 0;
      const py = y.srs ? 1 : 0;
      if (px !== py) return py - px;
      return aliveClock(y) - aliveClock(x) || (cardKey(x) < cardKey(y) ? -1 : 1);
    });
  return {
    cards: ranked.slice(0, max),
    tombstones: ranked.slice(max).map((c) => tombstoneFor(c, now)),
  };
}
