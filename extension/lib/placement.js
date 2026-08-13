// The placement interview's rules: which level to probe next, how one answer
// is scored, and what a whole run adds up to.
//
// The model examines — it asks a task at a level and marks the reply against
// that level's published rubric. The *ladder* lives here, on the client, and
// that split is deliberate. A model asked to also decide when it has heard
// enough will keep a pleasant conversation going indefinitely, and an
// interview whose length and stopping point depend on the model's mood cannot
// be costed, cannot be tested, and cannot be compared with the one you sat
// last month. Everything below is arithmetic over the marks that came back.
//
// The shape of the search is the one oral proficiency interviews use: warm up
// somewhere you are comfortable, push up until you break down, then come back
// and confirm the highest level you actually sustain. A number is only worth
// reporting once there is a level you held and a level you did not.

import { guideByLevel } from '../guides/index.js';

export const MIN_LEVEL = 1;
export const MAX_LEVEL = 9;

// Model calls per interview. Each turn is one call, so this is the whole cost
// of sitting the test.
export const MAX_TURNS = 14;
// Below this the ladder may have bracketed a level already, but on too little
// evidence to put a number on the screen — spend what is left either side of
// the estimate instead of stopping at four questions.
export const MIN_TURNS = 6;
// Two tasks at a level is enough to tell "held it" from "got lucky", and the
// cap is also what makes the search terminate: nine levels × two probes is a
// hard ceiling no sequence of verdicts can talk its way past.
export const MAX_PROBES_PER_LEVEL = 2;

// A turn's mark is comprehension + production, each 0-3, normalized to 0-1.
// Held at ~2/3 of the available marks; lost below ~1/3. Between the two the
// level is neither held nor out of reach, which is its own answer.
export const SUSTAIN = 0.7;
export const FLOOR = 0.35;

const clampLevel = (n) => Math.min(MAX_LEVEL, Math.max(MIN_LEVEL, Math.round(n) || MIN_LEVEL));
const clamp03 = (n) => Math.min(3, Math.max(0, Number(n) || 0));
const mean = (list) => list.reduce((sum, n) => sum + n, 0) / list.length;

// One marked answer, 0-1.
export function turnScore(assess) {
  if (!assess) return 0;
  return (clamp03(assess.comprehension) + clamp03(assess.production)) / 6;
}

// level -> [score, …], in the order they were asked.
export function levelScores(turns) {
  const by = new Map();
  for (const turn of turns) {
    if (!turn || !turn.assess) continue;
    const level = clampLevel(turn.level);
    const list = by.get(level) || [];
    list.push(turnScore(turn.assess));
    by.set(level, list);
  }
  return by;
}

export function verdictOf(scores) {
  if (!scores || !scores.length) return 'untested';
  const m = mean(scores);
  if (m >= SUSTAIN) return 'sustained';
  if (m <= FLOOR) return 'struggled';
  return 'partial';
}

export const VERDICT_LABELS = {
  sustained: 'Held it',
  partial: 'Shaky',
  struggled: 'Lost it',
  untested: 'Not probed',
};

// ---------------------------------------------------------------------------
// What the run adds up to
// ---------------------------------------------------------------------------

// HSK levels are cumulative, so the honest reading of a mixed run is the top
// of the range held *before* the first level that came apart — not simply the
// highest level that happened to go well. Sustaining 5 after losing 3 is a
// gap, not a level 5.
export function estimate(turns) {
  const scores = levelScores(turns);
  const perLevel = [];
  for (let level = MIN_LEVEL; level <= MAX_LEVEL; level++) {
    const list = scores.get(level) || [];
    perLevel.push({
      level,
      probes: list.length,
      score: list.length ? mean(list) : null,
      verdict: verdictOf(list),
    });
  }

  const struggled = perLevel.filter((r) => r.verdict === 'struggled').map((r) => r.level);
  const firstStruggle = struggled.length ? Math.min(...struggled) : Infinity;
  const held = perLevel
    .filter((r) => r.verdict === 'sustained' && r.level < firstStruggle)
    .map((r) => r.level);
  const level = held.length ? Math.max(...held) : 0;

  const assessed = turns.filter((t) => t && t.assess);
  const marks = (key) => (assessed.length
    ? Math.round((mean(assessed.map((t) => clamp03(t.assess[key]))) * 10)) / 10
    : null);

  // A number means something once there is a level held AND a level not held.
  // Topping out at 9 counts, since there is nothing above it to fail.
  const above = perLevel[level]; // perLevel is 0-indexed, so this is level + 1
  const bracketed = level > 0
    && (level === MAX_LEVEL
      ? perLevel[MAX_LEVEL - 1].probes >= MAX_PROBES_PER_LEVEL
      : above.verdict === 'struggled' || above.verdict === 'partial');
  const atLevel = level > 0 ? perLevel[level - 1].probes : 0;

  let confidence = 'low';
  if (bracketed && assessed.length >= 8 && atLevel >= MAX_PROBES_PER_LEVEL) confidence = 'high';
  else if (bracketed) confidence = 'medium';

  return {
    level,
    confidence,
    bracketed,
    perLevel,
    turns: assessed.length,
    comprehension: marks('comprehension'),
    production: marks('production'),
    // What to open the guides on next: the first level not yet held.
    studyLevel: clampLevel(level + 1),
  };
}

// ---------------------------------------------------------------------------
// The ladder
// ---------------------------------------------------------------------------

// Levels worth another task once the search itself has settled: the estimate
// and its neighbours, least-probed first. This is where the evidence is
// thinnest and where one more answer changes the number.
function shoreUp(turns, startLevel) {
  const scores = levelScores(turns);
  const probes = (level) => (scores.get(level) || []).length;
  const base = estimate(turns).level || clampLevel(startLevel);
  return [base, base + 1, base - 1]
    .filter((level) => level >= MIN_LEVEL && level <= MAX_LEVEL
      && probes(level) < MAX_PROBES_PER_LEVEL)
    .sort((a, b) => probes(a) - probes(b))[0] || null;
}

/**
 * Where the next task should sit.
 *
 *   turns       [{ level, assess }] so far, oldest first
 *   startLevel  where to open — the last placement, or the guide level being
 *               read, or a default
 *
 * -> { level, allowed, done, reason }
 *
 * `allowed` is the band the examiner may choose from, and it exists because of
 * an ordering problem worth stating plainly. One model call both marks the
 * answer just given and sets the next task — that is what keeps an interview
 * to a dozen calls rather than two dozen. But the level of the next task
 * depends on the mark for that answer, which does not exist yet when the
 * request is sent. Sending a single fixed level therefore leaves the ladder
 * reacting one question late, all the way down.
 *
 * So the client sends a preference and the narrow band around it that the
 * rules already sanction; the examiner, which by then has marked the answer,
 * picks within that band. Every level offered is one the ladder would have
 * allowed anyway — bounds, probe caps and the stopping rule are all applied
 * before the band is handed over, and the final number is still arithmetic
 * over the marks. The model gets the one judgement it is better placed to
 * make, and none of the ones it is worse at.
 */
export function planNext(turns, { startLevel = 3, maxTurns = MAX_TURNS } = {}) {
  const history = Array.isArray(turns) ? turns.filter(Boolean) : [];
  const scores = levelScores(history);
  const probes = (level) => (scores.get(level) || []).length;
  // A level is still open if it is on the scale and has room for another task.
  const open = (level) => level >= MIN_LEVEL && level <= MAX_LEVEL
    && probes(level) < MAX_PROBES_PER_LEVEL;
  // The preference first, then the fallbacks in the order given; `allowed`
  // comes back sorted, because it is a set of levels rather than a ranking and
  // reads that way everywhere it is shown.
  const band = (preferred, ...rest) => {
    const levels = [...new Set([preferred, ...rest])].filter(open);
    return levels.length
      ? { level: levels[0], allowed: [...levels].sort((a, b) => a - b) }
      : null;
  };

  if (!history.length) {
    // Open one level below the guess: the first task should be one they can
    // answer. An interview that starts over someone's head measures how they
    // handle being lost, which is not the question.
    const opening = clampLevel(startLevel - 1);
    return { ...band(opening, clampLevel(startLevel)), done: false, reason: 'warm-up' };
  }
  if (history.length >= maxTurns) return { done: true, reason: 'length' };

  const current = clampLevel(history[history.length - 1].level);
  const verdict = verdictOf(scores.get(current) || []);

  let want;
  if (verdict === 'sustained') want = current + 1;
  else if (verdict === 'struggled') want = current - 1;
  else want = probes(current) < MAX_PROBES_PER_LEVEL ? current : null;

  // The examiner may hold, or step either way — but only onto a level the
  // rules have not already closed.
  const next = want === null ? null : band(want, current, current + 1, current - 1);
  if (next) return { ...next, done: false, reason: verdict === 'sustained' ? 'harder' : 'easier' };

  // The search has settled. A short run may have bracketed a level on very
  // little evidence, so spend what is left of the minimum either side of the
  // estimate rather than reporting a number after four questions.
  const confirm = history.length < MIN_TURNS ? shoreUp(history, startLevel) : null;
  if (confirm) {
    return { ...band(confirm, confirm + 1, confirm - 1), done: false, reason: 'confirming' };
  }
  return { done: true, reason: want === null ? 'settled' : 'bounded' };
}

// ---------------------------------------------------------------------------
// The rubric the model marks against
// ---------------------------------------------------------------------------

// The guides are the app's copy of the published standard, so an interview
// rates against the same descriptors the learner can go and read. Without
// this the model is rating against its own idea of "HSK 4", which drifts
// between sessions and cannot be argued with.
export function rubricFor(level) {
  const guide = guideByLevel(level);
  if (!guide) return null;
  return {
    level: guide.level,
    name: guide.name,
    band: guide.band,
    canDo: guide.canDo,
    grammar: guide.grammar.map((point) => `${point.point} — ${point.formula}`),
    vocab: guide.vocab.flatMap((theme) => theme.words.map((w) => w.zh)).slice(0, 60),
  };
}

// ---------------------------------------------------------------------------
// Stored results
// ---------------------------------------------------------------------------

export const RESULTS_KEY = 'placementResults';
export const MAX_RESULTS = 20;

export async function loadResults() {
  const { [RESULTS_KEY]: results } = await chrome.storage.local.get(RESULTS_KEY);
  return Array.isArray(results) ? results : [];
}

// Newest first, which is the order the history reads in.
export async function saveResult(result) {
  const results = await loadResults();
  results.unshift(result);
  await chrome.storage.local.set({ [RESULTS_KEY]: results.slice(0, MAX_RESULTS) });
  return results;
}
