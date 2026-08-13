// SM-2-style spaced repetition scheduling. Pure functions so the review page,
// the library, the phone app, and the tests all share one implementation.
// Intervals are in days; `due`, `now`, `reviewedAt`, and `introducedAt` are
// epoch milliseconds.
//
// Three things here are worth knowing before changing anything:
//
//   1. Scheduling works in *study days*, not in raw milliseconds. A day starts
//      at 4am local time (ROLLOVER_HOUR), so a card scheduled for "tomorrow"
//      is available the moment you sit down tomorrow morning rather than at
//      the exact clock time you graded it. Late-night review still counts as
//      the previous day.
//   2. Intervals are fuzzed by a per-card amount. Two words saved in the same
//      reading session — 儿童 and 童, say — otherwise march in lockstep
//      forever, and seeing one primes you for the other. The fuzz is derived
//      from the card's identity, not from Math.random(), so every device
//      computes the same schedule and the tests stay deterministic.
//   3. The queue is shuffled *and* spaced: cards sharing a character or a
//      pinyin syllable are pushed apart so one card cannot give away the next.

const DAY_MS = 24 * 60 * 60 * 1000;
const AGAIN_DELAY_MS = 10 * 60 * 1000; // relearn after 10 minutes
const MAX_IVL = 365 * 5; // sanity cap; an easy streak otherwise runs to millennia

// A study day runs 4am → 4am, matching how people actually study.
export const ROLLOVER_HOUR = 4;

// A card is "young" until it survives three weeks — the usual dividing line
// between something you are still learning and something you know.
export const MATURE_IVL = 21;

export const GRADES = ['again', 'hard', 'good', 'easy'];
export const STAGES = ['new', 'learning', 'young', 'mature'];

// Daily limits. `newPerDay` is a limit on *introducing* cards (a day's worth of
// new material); `maxPerDay` caps the whole session so a long absence doesn't
// produce a 400-card wall.
export const DEFAULT_LIMITS = { newPerDay: 15, maxPerDay: 60 };

export { DAY_MS };

// ---------------------------------------------------------------------------
// Study days
// ---------------------------------------------------------------------------

// Start of the study day containing `now` (local 4am). Date arithmetic, not
// modular arithmetic on epoch ms, so DST shifts stay correct.
export function dayStart(now, rolloverHour = ROLLOVER_HOUR) {
  const d = new Date(now);
  if (d.getHours() < rolloverHour) d.setDate(d.getDate() - 1);
  d.setHours(rolloverHour, 0, 0, 0);
  return d.getTime();
}

export function dayEnd(now, rolloverHour = ROLLOVER_HOUR) {
  const d = new Date(dayStart(now, rolloverHour));
  d.setDate(d.getDate() + 1);
  return d.getTime();
}

// Whole study days from `now`'s day to `then`'s day. Negative means the past.
export function daysBetween(now, then) {
  return Math.round((dayStart(then) - dayStart(now)) / DAY_MS);
}

// Review cards (a day or more apart) are day-granular: anything scheduled
// before tomorrow's rollover is due today, so a card graded at 9pm is
// available during the next morning's session rather than at 9pm sharp.
// Learning steps under a day keep real clock times — a card you just failed
// is genuinely not ready ten seconds later.
export function isDue(srs, now) {
  if (!srs) return false;
  return srs.ivl >= 1 ? srs.due < dayEnd(now) : srs.due <= now;
}

// Cards that will come back before the day rolls over — the 10-minute relearn
// steps and half-day "hard" intervals that a finished session leaves behind.
export function dueLaterToday(words, now) {
  return words.filter(
    (w) => w.srs && w.srs.due > now && w.srs.due < dayEnd(now) && !isDue(w.srs, now),
  ).length;
}

// ---------------------------------------------------------------------------
// Deterministic randomness
//
// Anything "random" in here is seeded so that the extension, the phone, and
// the tests all agree. Card seeds come from the card's identity; session seeds
// from the study day, so the queue is reshuffled daily but stable while you
// work through it.
// ---------------------------------------------------------------------------

function hash32(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function cardSeed(word) {
  if (!word) return 0;
  return hash32([
    word.cardType || 'word', word.simp || '', word.trad || '', word.pinyin || '',
  ].join(''));
}

export function daySeed(now) {
  return Math.floor(dayStart(now) / DAY_MS) >>> 0;
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function seededShuffle(items, seed) {
  const out = items.slice();
  const rand = mulberry32(seed >>> 0);
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// ---------------------------------------------------------------------------
// Scheduling
// ---------------------------------------------------------------------------

export function newSrs(now) {
  return { due: now, ivl: 0, ease: 2.5, reps: 0, lapses: 0 };
}

const round1 = (x) => Math.round(x * 10) / 10;
const clampIvl = (x) => Math.min(MAX_IVL, Math.max(0, round1(x)));

// Anki-style interval fuzz: enough to break up cards that were introduced
// together, never enough to matter for recall. Deterministic in (card, rep)
// so both devices schedule identically and previews match what you get.
function fuzzIvl(ivl, seed, reps) {
  if (ivl < 2.5) return ivl; // learning steps stay exact
  const rand = mulberry32((seed ^ Math.imul(reps + 1, 2654435761)) >>> 0)();
  const spread = ivl < 7 ? 1 : ivl < 30 ? Math.max(2, ivl * 0.15) : Math.max(4, ivl * 0.05);
  return Math.max(1, ivl + (rand * 2 - 1) * spread);
}

// `opts.seed` should be cardSeed(word) — without it the fuzz degenerates to
// the same offset for every card, which is exactly the clumping it prevents.
export function schedule(srs, grade, now, opts = {}) {
  const { seed = 0, fuzz = true } = opts;
  const s = srs ? { ...srs } : newSrs(now);
  // Days late. Remembering a card 40 days after a 10-day interval is evidence
  // the 10 days were too short, so overdue time counts toward the next one.
  const overdue = srs && srs.reps > 0 ? Math.max(0, (now - srs.due) / DAY_MS) : 0;

  switch (grade) {
    case 'again':
      s.ease = Math.max(1.3, s.ease - 0.2);
      if (s.reps > 0) s.lapses += 1;
      s.reps = 0;
      s.ivl = 0;
      s.due = now + AGAIN_DELAY_MS;
      break;
    case 'hard':
      s.ease = Math.max(1.3, s.ease - 0.15);
      s.ivl = s.reps === 0
        ? 0.5
        : clampIvl(Math.max(s.ivl + 0.5, (s.ivl + overdue / 4) * 1.2));
      s.reps += 1;
      break;
    case 'good':
      s.ivl = s.reps === 0 ? 1
        : s.reps === 1 ? 3
        : clampIvl(Math.max(s.ivl + 1, (s.ivl + overdue / 2) * s.ease));
      s.reps += 1;
      break;
    case 'easy':
      s.ease = Math.min(3.0, s.ease + 0.15);
      s.ivl = s.reps === 0
        ? 3
        : clampIvl(Math.max(s.ivl + 2, (s.ivl + overdue) * s.ease * 1.3));
      s.reps += 1;
      break;
    default:
      throw new Error(`unknown grade: ${grade}`);
  }

  if (grade !== 'again') {
    if (fuzz) s.ivl = clampIvl(fuzzIvl(s.ivl, seed, s.reps));
    s.due = now + Math.round(s.ivl * DAY_MS);
  }
  // Stamped so sync (lib/merge.js) can tell which device reviewed most
  // recently; the content clock (lastSavedAt) deliberately stays untouched.
  s.reviewedAt = now;
  // Only set when the card was genuinely new, so the daily new-card limit
  // counts introductions rather than reviews. Cards that predate this field
  // stay undefined and never consume today's allowance.
  if (!srs) s.introducedAt = now;
  return s;
}

// Human-readable preview of where each grade would send the card ("10m", "3d").
export function intervalPreview(srs, grade, now, opts = {}) {
  const next = schedule(srs, grade, now, opts);
  return formatDelay(next.due - now);
}

export function formatDelay(ms) {
  if (ms < 60 * 60 * 1000) return `${Math.max(1, Math.round(ms / 60000))}m`;
  if (ms < DAY_MS) return `${Math.round(ms / (60 * 60 * 1000))}h`;
  const days = ms / DAY_MS;
  if (days < 30) return `${round(days)}d`;
  if (days < 365) return `${round(days / 30)}mo`;
  return `${round(days / 365)}y`;
  function round(x) { return x >= 10 ? Math.round(x) : Math.round(x * 10) / 10; }
}

// ---------------------------------------------------------------------------
// Anti-priming: keep look-alike and sound-alike cards apart
// ---------------------------------------------------------------------------

// Pinyin syllables with tone marks stripped: "értóng" -> ["er", "tong"].
function tonelessSyllables(pinyin) {
  return (pinyin || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-zü]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

const HANZI = /[\u3400-\u9fff]/;

// The features that make one card a hint for another: a shared character, or a
// shared syllable regardless of tone (儿童 értóng primes 童 tóng both ways).
// Long cards — saved sentences — are skipped: they share characters with
// everything, so keying on them would shuffle the queue for no real gain.
export function relatedKeys(word) {
  const keys = new Set();
  if ((word.cardType || 'word') !== 'word') return keys;
  if (Array.from(word.simp || '').length > 4) return keys;
  for (const form of [word.simp, word.trad]) {
    for (const c of Array.from(form || '')) if (HANZI.test(c)) keys.add(`c:${c}`);
  }
  for (const s of tonelessSyllables(word.pinyin)) keys.add(`p:${s}`);
  return keys;
}

function related(a, b) {
  for (const key of a) if (b.has(key)) return true;
  return false;
}

// How bad it would be to play `keys` next, given the last few cards played.
// 0 means no relation at all; higher means the clash is more recent, so an
// unavoidable clash lands as far back as possible instead of adjacent.
function penalty(keys, recent, gap) {
  let worst = 0;
  for (let j = 0; j < recent.length; j++) {
    if (related(keys, recent[j])) {
      worst = Math.max(worst, gap - (recent.length - j) + 1);
    }
  }
  return worst;
}

// Re-ordering that keeps related cards at least `gap` cards apart, preserving
// the incoming order otherwise. Greedy with a cleanup pass: greedy alone paints
// itself into a corner when a run of siblings (童 / 儿童 / 童话) outnumbers the
// spacing, leaving the last two stranded side by side.
export function spacedOrder(cards, gap = 4) {
  if (gap <= 0 || cards.length < 3) return cards.slice();
  const keys = cards.map(relatedKeys);
  const remaining = cards.map((_, i) => i);
  const recent = [];
  const order = [];
  while (remaining.length) {
    let pick = 0;
    let best = Infinity;
    for (let i = 0; i < remaining.length && best > 0; i++) {
      const score = penalty(keys[remaining[i]], recent, gap);
      if (score < best) {
        best = score;
        pick = i;
      }
    }
    const [index] = remaining.splice(pick, 1);
    order.push(index);
    recent.push(keys[index]);
    if (recent.length > gap) recent.shift();
  }

  // Cleanup: swap any pair of positions that reduces the number of cards left
  // sitting next to a relative. A dense word family (童 / 儿童 / 童话 / 童年)
  // corners the greedy pass and strands the last two side by side; this
  // recovers the best arrangement the deck allows. Bounded: it only ever runs
  // over a single day's queue, and only while it is still finding wins.
  const touching = () => {
    let n = 0;
    for (let i = 1; i < order.length; i++) {
      if (related(keys[order[i]], keys[order[i - 1]])) n += 1;
    }
    return n;
  };
  for (let pass = 0; pass < 4; pass++) {
    let cost = touching();
    if (cost === 0) break;
    let improved = false;
    for (let i = 0; i < order.length && cost > 0; i++) {
      for (let j = i + 1; j < order.length; j++) {
        [order[i], order[j]] = [order[j], order[i]];
        const next = touching();
        if (next < cost) {
          cost = next;
          improved = true;
        } else {
          [order[i], order[j]] = [order[j], order[i]]; // no gain — put it back
        }
      }
    }
    if (!improved) break;
  }
  return order.map((i) => cards[i]);
}

// ---------------------------------------------------------------------------
// Session planning
// ---------------------------------------------------------------------------

const bySaved = (a, b) =>
  (b.lastSavedAt || b.savedAt || 0) - (a.lastSavedAt || a.savedAt || 0);

// New cards already introduced during this study day, on any device.
export function newIntroducedToday(words, now) {
  const start = dayStart(now);
  let n = 0;
  for (const w of words) if (w.srs && w.srs.introducedAt >= start) n += 1;
  return n;
}

// What today's session can actually contain, and what it is holding back.
// buildQueue() and every "N to review" badge derive from this, so the counts a
// page shows and the cards it serves can never disagree.
export function planSession(words, now, options = {}) {
  const {
    newPerDay = DEFAULT_LIMITS.newPerDay,
    maxPerDay = DEFAULT_LIMITS.maxPerDay,
    extraNew = 0,
    extraReviews = 0,
  } = options;

  const due = words.filter((w) => w.srs && isDue(w.srs, now))
    .sort((a, b) => a.srs.due - b.srs.due);
  const fresh = words.filter((w) => !w.srs).sort(bySaved);

  const introducedToday = newIntroducedToday(words, now);
  const newAllowed = Math.max(0, newPerDay - introducedToday) + extraNew;
  const cap = maxPerDay + extraReviews + extraNew;

  // Due cards have first claim on the daily cap: forgetting old words costs
  // more than delaying new ones.
  const dueSelected = due.slice(0, cap);
  const newSelected = fresh.slice(
    0, Math.min(newAllowed, Math.max(0, cap - dueSelected.length)),
  );

  return {
    dueSelected,
    newSelected,
    dueTotal: due.length,
    newTotal: fresh.length,
    introducedToday,
    newAllowed,
    // Cards that exist and are ready but that today's limits are withholding.
    dueHeld: due.length - dueSelected.length,
    newHeld: fresh.length - newSelected.length,
    queued: dueSelected.length + newSelected.length,
    nextDue: nextDueAt(words, now),
  };
}

// Today's queue: due cards and a day's ration of new ones, mixed together,
// shuffled with a per-day seed, then spaced so no card primes the next.
export function buildQueue(words, now, options = {}) {
  const { spacing = 4, shuffle = true, seed = daySeed(now) } = options;
  const { dueSelected, newSelected } = planSession(words, now, options);
  const pool = dueSelected.concat(newSelected);
  return spacedOrder(shuffle ? seededShuffle(pool, seed) : pool, spacing);
}

// How many cards the Review tab should advertise — what a session started now
// would actually serve, not every card in the collection.
export function reviewBadgeCount(words, now, options = {}) {
  return planSession(words, now, options).queued;
}

// The soonest moment another card becomes available — not the same thing as
// the soonest `due` stamp: a day-granular card scheduled for 9pm tomorrow
// unlocks at tomorrow's 4am rollover, so quoting "in 33h" would be wrong.
export function nextDueAt(words, now) {
  let next = null;
  for (const w of words) {
    if (!w.srs || isDue(w.srs, now)) continue; // already waiting for you
    const at = w.srs.ivl >= 1 ? dayStart(w.srs.due) : w.srs.due;
    if (at <= now) continue;
    if (next === null || at < next) next = at;
  }
  return next;
}

// Plain-language version of the above, shared by both review pages.
export function nextDueText(ts, now) {
  const d = new Date(ts);
  if (ts < dayEnd(now)) {
    const clock = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
    return `later today, around ${clock} (in ${formatDelay(ts - now)})`;
  }
  const ahead = daysBetween(now, ts);
  if (ahead <= 1) return 'tomorrow morning';
  const weekday = d.toLocaleDateString(undefined, { weekday: 'long' });
  const date = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  return `${weekday} morning, ${date} (${ahead} days from now)`;
}

// ---------------------------------------------------------------------------
// Where a card sits on the curve
// ---------------------------------------------------------------------------

export function cardStage(word) {
  const s = word.srs;
  if (!s) return 'new';
  if (s.reps === 0 || s.ivl < 1) return 'learning';
  return s.ivl < MATURE_IVL ? 'young' : 'mature';
}

export function stageCounts(words) {
  const counts = { new: 0, learning: 0, young: 0, mature: 0 };
  for (const w of words) counts[cardStage(w)] += 1;
  return counts;
}

// 0 → never studied, 1 → a year or more between reviews. Log-scaled because
// the interval sequence is geometric; a linear bar would be flat then vertical.
export function strength(word) {
  const ivl = (word.srs && word.srs.ivl) || 0;
  if (ivl <= 0) return 0;
  return Math.min(1, Math.log(1 + ivl) / Math.log(1 + 365));
}

// Cards due per study day for the next `days` days. Bin 0 is today and
// includes everything overdue; `beyond` counts cards scheduled past the
// window, `unscheduled` the ones never studied.
export function forecast(words, now, days = 14) {
  const bounds = [];
  const cursor = new Date(dayStart(now));
  for (let i = 0; i <= days + 1; i++) {
    bounds.push(cursor.getTime());
    cursor.setDate(cursor.getDate() + 1);
  }
  const bins = [];
  for (let i = 0; i <= days; i++) bins.push({ offset: i, start: bounds[i], count: 0 });

  let beyond = 0;
  let unscheduled = 0;
  let overdue = 0;
  for (const w of words) {
    if (!w.srs) { unscheduled += 1; continue; }
    if (w.srs.due < bounds[0]) { overdue += 1; bins[0].count += 1; continue; }
    if (w.srs.due >= bounds[days + 1]) { beyond += 1; continue; }
    let i = days;
    while (i > 0 && w.srs.due < bounds[i]) i -= 1;
    bins[i].count += 1;
  }
  return { bins, beyond, unscheduled, overdue };
}

// Short status string for list views.
export function srsStatus(word, now) {
  if (!word.srs) return 'new';
  if (word.srs.due <= now) return 'due';
  const ahead = daysBetween(now, word.srs.due);
  if (ahead <= 0) return 'due today';
  if (ahead === 1) return 'tomorrow';
  return `in ${ahead}d`;
}
