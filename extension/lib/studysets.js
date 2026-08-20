// One memory, several sets.
//
// A saved-library card owns membership (the learner explicitly saved it).
// HSK sets own different membership (the published level lists). The review
// schedule belongs to neither: it is keyed by card identity so encountering
// the same word in HSK 1, a cumulative set, and the saved library never creates
// three independent memories of it.

import { cardKey } from './merge.js';

export const STUDY_PROGRESS_KEY = 'studyProgress';

function srsRank(srs) {
  if (!srs) return [0, 0, 0, 0];
  return [
    Number(srs.reviewedAt) || 0,
    Number(srs.reps) || 0,
    Number(srs.due) || 0,
    Number(srs.ivl) || 0,
  ];
}

function compareRank(a, b) {
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1;
  }
  return 0;
}

export function latestSrs(...states) {
  let latest = null;
  for (const state of states) {
    if (state && compareRank(srsRank(state), srsRank(latest)) > 0) latest = state;
  }
  return latest ? { ...latest } : null;
}

export function sharedSrs(card, progress = {}) {
  return latestSrs(card?.srs, progress[cardKey(card)]);
}

export function applySharedProgress(cards, progress = {}) {
  return (cards || []).map((card) => ({ ...card, srs: sharedSrs(card, progress) }));
}

// A cumulative syllabus can mention the same spelling/pronunciation at more
// than one level because a later level adds a sense or part of speech. The
// full reference list keeps both official rows, but a practice queue contains
// one card: the learner asked for one schedule per word.
export function uniqueStudyCards(cards) {
  const byKey = new Map();
  for (const card of cards || []) {
    const key = cardKey(card);
    const previous = byKey.get(key);
    if (!previous) {
      byKey.set(key, card);
      continue;
    }
    previous.srs = latestSrs(previous.srs, card.srs);
    if (card.hskId) {
      previous.hskIds = [...new Set([
        ...(previous.hskIds || [previous.hskId]).filter(Boolean),
        card.hskId,
      ])];
    }
  }
  return [...byKey.values()];
}

export function recordSharedProgress(progress, card, srs) {
  return { ...(progress || {}), [cardKey(card)]: { ...srs } };
}

export function mergeStudyProgress(older = {}, newer = {}) {
  const merged = { ...older };
  for (const [key, state] of Object.entries(newer || {})) {
    merged[key] = latestSrs(merged[key], state);
  }
  return merged;
}
