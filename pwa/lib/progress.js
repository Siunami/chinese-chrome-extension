// Shared progress visuals: the upcoming-reviews forecast, the collection's
// position on the spaced-repetition curve, the small per-card strength meter,
// and the HSK level ladder a placement interview leaves behind. Used by the
// review page's end-of-session screen, the saved library, and the placement
// page, so they tell the same story with the same colors.
//
// Palette notes (these are not arbitrary — they were validated for contrast
// and color-vision deficiency against a white surface):
//   forecast   one series, blue #3987e5, with today emphasized in the app's
//              red #b5232b and directly labelled.
//   stages     new → learning → young → mature is an *ordered* scale, so it
//              gets one hue stepped light→dark rather than four unrelated
//              colors; the lightest step still clears the surface.
//   ladder     held / shaky / lost is ordered too, but it is a verdict rather
//              than a quantity, so it borrows the same ramp's ends and takes
//              the app's red for the level that came apart — the one row a
//              reader should find without hunting.

import { STAGES, forecast, stageCounts, strength, cardStage } from './srs.js';

export const STAGE_COLORS = {
  new: '#86b6ef',
  learning: '#3987e5',
  young: '#256abf',
  mature: '#104281',
};

export const STAGE_LABELS = {
  new: 'New',
  learning: 'Learning',
  young: 'Young',
  mature: 'Mature',
};

export const STAGE_NOTES = {
  new: 'saved but never studied',
  learning: 'seen, still under a day apart',
  young: 'coming back within 3 weeks',
  mature: '3 weeks or more between reviews',
};

const CSS = `
.viz { --viz-ink: #333; --viz-muted: #888; --viz-line: #e6e6e6;
  --viz-series: #3987e5; --viz-accent: #b5232b; --viz-track: #eef1f5;
  font-size: 13px; color: var(--viz-ink); }
.viz-title { font-size: 13px; font-weight: 700; margin: 0 0 2px; }
.viz-sub { font-size: 12px; color: var(--viz-muted); margin: 0 0 10px; }
.viz-readout { min-height: 16px; font-size: 12px; color: var(--viz-muted);
  margin-top: 7px; font-variant-numeric: tabular-nums; }
.viz-readout b { color: var(--viz-ink); }

/* Forecast columns: thin marks on a recessive baseline, 2px gaps. */
.fc-plot { display: flex; align-items: flex-end; gap: 2px; height: 92px;
  border-bottom: 1px solid var(--viz-line); padding-bottom: 0; }
.fc-col { flex: 1 1 0; display: flex; flex-direction: column;
  justify-content: flex-end; align-items: stretch; height: 100%;
  background: none; border: 0; padding: 0; cursor: default; min-width: 0; }
.fc-bar { background: var(--viz-series); border-radius: 4px 4px 0 0;
  min-height: 2px; transition: filter 0.1s; }
.fc-col[data-empty="1"] .fc-bar { background: var(--viz-track); }
.fc-col[data-today="1"] .fc-bar { background: var(--viz-accent); }
.fc-col:hover .fc-bar, .fc-col:focus-visible .fc-bar { filter: brightness(1.15); }
.fc-col:focus-visible { outline: 2px solid var(--viz-accent); outline-offset: 1px; }
.fc-value { font-size: 10px; line-height: 1.2; color: var(--viz-ink);
  text-align: center; font-variant-numeric: tabular-nums; margin-bottom: 2px; }
.fc-axis { display: flex; gap: 2px; margin-top: 5px; }
.fc-tick { flex: 1 1 0; min-width: 0; text-align: center; font-size: 10px;
  color: var(--viz-muted); white-space: nowrap; overflow: visible; }
.fc-tick[data-today="1"] { color: var(--viz-accent); font-weight: 700; }
.fc-note { font-size: 11.5px; color: var(--viz-muted); margin-top: 8px; }

/* Stage bar: one ordinal ramp, 2px surface gaps between segments. */
.stage-bar { display: flex; gap: 2px; height: 14px; margin: 2px 0 9px; }
.stage-seg { border-radius: 3px; min-width: 3px; }
.stage-legend { display: flex; flex-wrap: wrap; gap: 4px 16px; }
.stage-item { display: flex; align-items: baseline; gap: 6px; font-size: 12px; }
.stage-swatch { width: 9px; height: 9px; border-radius: 2px; flex: none;
  transform: translateY(0.5px); }
.stage-name { color: var(--viz-ink); font-weight: 600; }
.stage-n { color: var(--viz-ink); font-variant-numeric: tabular-nums; }
.stage-note { color: var(--viz-muted); }

/* Per-row strength meter (library table). */
.meter { display: inline-block; width: 54px; height: 6px; border-radius: 3px;
  background: var(--viz-track); overflow: hidden; vertical-align: middle; }
.meter i { display: block; height: 100%; border-radius: 3px; }

.viz-table { width: 100%; border-collapse: collapse; margin-top: 8px;
  font-size: 12px; }
.viz-table th, .viz-table td { text-align: left; padding: 3px 8px 3px 0;
  border-bottom: 1px solid var(--viz-line); color: var(--viz-ink);
  font-weight: 400; }
.viz-table th { color: var(--viz-muted); font-size: 11px; }
.viz-details > summary { cursor: pointer; color: var(--viz-muted);
  font-size: 11.5px; margin-top: 8px; }

/* Level ladder: nine rows, HSK 9 at the top, so it reads as a staircase you
   climb rather than a list you scroll. Each row's bar is that level's mark on
   a fixed 0-100% track — fixed, because the point of the chart is comparing
   level against level, and a bar rescaled to the run's own maximum would draw
   a level you barely held exactly as long as one you aced. */
.ladder { display: flex; flex-direction: column-reverse; gap: 3px; margin: 4px 0 2px; }
.lad-row { display: grid; grid-template-columns: 46px 1fr 64px; align-items: center;
  gap: 8px; padding: 2px 0; border-radius: 5px; }
/* The row the placement came from. A tint plus the accent on its own label —
   an inset rule down the left edge picked up the row's corner radius and read
   as a stray bracket in front of the level number. */
.lad-row[data-here="1"] { background: #fdf6e8; }
.lad-row[data-here="1"] .lad-name { color: var(--viz-accent); font-weight: 700; }
.lad-name { font-size: 11.5px; font-weight: 600; color: var(--viz-ink);
  padding-left: 5px; }
.lad-row[data-verdict="untested"] .lad-name { color: var(--viz-muted); font-weight: 400; }
.lad-track { position: relative; height: 13px; border-radius: 3px;
  background: var(--viz-track); overflow: hidden; }
/* The threshold a level has to clear to count as held. Drawn on every row so
   the bars are read against the rule, not against each other. */
.lad-track::after { content: ''; position: absolute; top: 0; bottom: 0;
  left: 70%; width: 1px; background: rgba(0, 0, 0, 0.18); }
.lad-fill { height: 100%; border-radius: 3px; }
.lad-verdict { font-size: 10.5px; color: var(--viz-muted); text-align: right;
  font-variant-numeric: tabular-nums; }
.lad-row[data-verdict="sustained"] .lad-verdict,
.lad-row[data-verdict="struggled"] .lad-verdict { color: var(--viz-ink); }
.lad-legend { display: flex; flex-wrap: wrap; gap: 4px 14px; margin-top: 9px; }

/* Placement trend: one column per sitting, oldest on the left, on a fixed
   0-9 scale for the same reason the ladder's rows are fixed — the question is
   "did HSK 3 become HSK 4", and a chart rescaled to the learner's own best
   result draws every history as a triumph ending at the top of the box. */
.tr-plot { display: flex; align-items: flex-end; gap: 4px; height: 96px;
  border-bottom: 1px solid var(--viz-line); }
.tr-col { flex: 1 1 0; min-width: 0; display: flex; flex-direction: column;
  justify-content: flex-end; height: 100%; background: none; border: 0;
  padding: 0; cursor: pointer; }
.tr-bar { background: var(--viz-series); border-radius: 4px 4px 0 0; min-height: 2px;
  transition: filter 0.1s; }
.tr-col[data-latest="1"] .tr-bar { background: var(--viz-accent); }
.tr-col[data-zero="1"] .tr-bar { background: var(--viz-track); }
.tr-col:hover .tr-bar, .tr-col:focus-visible .tr-bar { filter: brightness(1.15); }
.tr-col:focus-visible { outline: 2px solid var(--viz-accent); outline-offset: 1px; }
.tr-value { font-size: 10px; line-height: 1.2; text-align: center;
  color: var(--viz-ink); font-variant-numeric: tabular-nums; margin-bottom: 2px; }
.tr-axis { display: flex; gap: 4px; margin-top: 5px; }
.tr-tick { flex: 1 1 0; min-width: 0; text-align: center; font-size: 10px;
  color: var(--viz-muted); white-space: nowrap; overflow: hidden; }
.tr-tick[data-latest="1"] { color: var(--viz-accent); font-weight: 700; }
`;

let cssInjected = false;
function ensureCss(doc = document) {
  if (cssInjected) return;
  cssInjected = true;
  const style = doc.createElement('style');
  style.textContent = CSS;
  doc.head.append(style);
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

// Day-of-month numbers rather than weekday letters: at this width two letters
// of "Tue"/"Thu" are indistinguishable, and a date is never ambiguous.
function dayLabel(ts, offset) {
  return offset === 0 ? 'today' : String(new Date(ts).getDate());
}

function fullDayLabel(ts, offset) {
  if (offset === 0) return 'Today';
  const d = new Date(ts);
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

// ---------------------------------------------------------------------------
// Forecast: how many cards come back on each of the next N days
// ---------------------------------------------------------------------------

// `newToday` is the number of never-studied cards today's session will
// introduce. They have no due date — a new card is not "scheduled" for
// anything — so the raw forecast leaves them out entirely, which makes today's
// column read as 0 on a day with a full session waiting. Counting them into
// today (a fact) without projecting them onto later days (a guess) is the
// honest version.
export function forecastChart(words, now, { days = 14, title = 'Coming up', newToday = 0 } = {}) {
  ensureCss();
  const data = forecast(words, now, days);
  const scheduledToday = data.bins[0].count;
  data.bins[0].count += newToday;
  const max = Math.max(1, ...data.bins.map((b) => b.count));

  const root = el('div', 'viz fc');
  root.append(el('p', 'viz-title', title));
  root.append(el('p', 'viz-sub',
    `Cards scheduled to come back over the next ${days} days.`));

  const plot = el('div', 'fc-plot');
  const axis = el('div', 'fc-axis');
  const readout = el('div', 'viz-readout');

  // Today and the busiest day are labelled directly; the rest read off hover
  // (a number over every bar is noise).
  const peak = data.bins.reduce((best, b) => (b.count > best.count ? b : best), data.bins[0]);

  for (const bin of data.bins) {
    const col = el('button', 'fc-col');
    col.type = 'button';
    if (bin.offset === 0) col.dataset.today = '1';
    if (bin.count === 0) col.dataset.empty = '1';
    const label = `${fullDayLabel(bin.start, bin.offset)}: ${plural(bin.count, 'card')}` +
      (bin.offset === 0 && newToday
        ? ` (${scheduledToday} due, ${newToday} new to introduce)` : '');
    col.title = label;
    col.setAttribute('aria-label', label);

    const showValue = bin.count > 0 && (bin.offset === 0 || bin === peak);
    if (showValue) col.append(el('div', 'fc-value', String(bin.count)));
    const bar = el('div', 'fc-bar');
    bar.style.height = `${(bin.count / max) * (showValue ? 78 : 100)}%`;
    col.append(bar);
    const describe = () => { readout.replaceChildren(el('b', '', label)); };
    col.addEventListener('mouseenter', describe);
    col.addEventListener('focus', describe);
    col.addEventListener('mouseleave', () => readout.replaceChildren());
    col.addEventListener('blur', () => readout.replaceChildren());
    plot.append(col);

    // One tick per bar keeps the axis aligned, but at 21 days each slot is
    // ~24px — narrower than the word "today", which was rendering as "toda".
    // Label today and every third day, and let those labels overflow into the
    // blank slots either side rather than clipping.
    const labelled = bin.offset === 0 || bin.offset % 3 === 0;
    const tick = el('div', 'fc-tick', labelled ? dayLabel(bin.start, bin.offset) : '');
    if (bin.offset === 0) tick.dataset.today = '1';
    axis.append(tick);
  }

  root.append(plot, axis, readout);

  const notes = [];
  if (newToday) {
    notes.push(`Today includes ${plural(newToday, 'new word')} being introduced — later days show only cards already scheduled, so they will fill in as you study`);
  }
  if (data.overdue) notes.push(`${plural(data.overdue, 'card')} overdue (folded into today)`);
  if (data.beyond) notes.push(`${plural(data.beyond, 'card')} scheduled beyond ${days} days`);
  if (data.unscheduled) {
    notes.push(`${plural(data.unscheduled - newToday, 'card')} not started yet`);
  }
  if (notes.length) root.append(el('div', 'fc-note', notes.join(' · ')));

  // Table view of the same numbers: the chart is small, and hover is not
  // available to every reader.
  const details = el('details', 'viz-details');
  details.append(el('summary', '', 'Show these numbers as a table'));
  const table = el('table', 'viz-table');
  const head = document.createElement('tr');
  head.append(el('th', '', 'Day'), el('th', '', 'Cards due'));
  table.append(head);
  for (const bin of data.bins) {
    const row = document.createElement('tr');
    row.append(el('td', '', fullDayLabel(bin.start, bin.offset)), el('td', '', String(bin.count)));
    table.append(row);
  }
  details.append(table);
  root.append(details);
  return root;
}

// ---------------------------------------------------------------------------
// Stage distribution: where the collection sits on the curve
// ---------------------------------------------------------------------------

export function stageBar(words, { title = 'Where your cards are' } = {}) {
  ensureCss();
  const counts = stageCounts(words);
  const total = words.length || 1;

  const root = el('div', 'viz stages');
  if (title) root.append(el('p', 'viz-title', title));

  const bar = el('div', 'stage-bar');
  bar.setAttribute('role', 'img');
  bar.setAttribute('aria-label', STAGES
    .map((s) => `${STAGE_LABELS[s]} ${counts[s]}`).join(', '));
  for (const stage of STAGES) {
    if (!counts[stage]) continue;
    const seg = el('div', 'stage-seg');
    seg.style.flex = `${counts[stage]} 1 0`;
    seg.style.background = STAGE_COLORS[stage];
    seg.title = `${STAGE_LABELS[stage]}: ${counts[stage]} (${Math.round(counts[stage] / total * 100)}%)`;
    bar.append(seg);
  }
  if (!words.length) {
    const seg = el('div', 'stage-seg');
    seg.style.flex = '1';
    seg.style.background = 'var(--viz-track)';
    bar.append(seg);
  }
  root.append(bar);

  const legend = el('div', 'stage-legend');
  for (const stage of STAGES) {
    const item = el('div', 'stage-item');
    const swatch = el('span', 'stage-swatch');
    swatch.style.background = STAGE_COLORS[stage];
    item.append(swatch, el('span', 'stage-name', STAGE_LABELS[stage]));
    item.append(el('span', 'stage-n', String(counts[stage])));
    item.append(el('span', 'stage-note', STAGE_NOTES[stage]));
    legend.append(item);
  }
  root.append(legend);
  return root;
}

// ---------------------------------------------------------------------------
// Level ladder: what a placement interview found at each HSK level
// ---------------------------------------------------------------------------

export const VERDICT_COLORS = {
  sustained: '#256abf',  // held — the ramp's established end
  partial: '#86b6ef',    // shaky — the same hue, unresolved
  struggled: '#b5232b',  // lost — the app's red, and the row that matters
  untested: '#d8dee6',
};

const VERDICT_TEXT = {
  sustained: 'held',
  partial: 'shaky',
  struggled: 'lost it',
  untested: 'not asked',
};

// `perLevel` is estimate().perLevel from lib/placement.js: one row per level
// with { level, probes, score, verdict }. `here` is the placement itself, so
// the row the number came from is marked in the chart rather than only stated
// above it.
//
// Levels that were never probed are drawn as empty rather than left out. An
// interview walks a few rungs of a nine-rung ladder, and a chart that silently
// omitted the rest would read as a complete picture of nine levels.
export function levelLadder(perLevel, { here = 0, title = 'What the interview found' } = {}) {
  ensureCss();
  const root = el('div', 'viz ladder-box');
  if (title) root.append(el('p', 'viz-title', title));
  root.append(el('p', 'viz-sub',
    'Each level you were asked about, scored on understanding the task and '
    + 'answering it in Chinese. The line marks the mark needed to count as held.'));

  const rows = el('div', 'ladder');
  for (const row of perLevel) {
    const line = el('div', 'lad-row');
    line.dataset.verdict = row.verdict;
    if (row.level === here) line.dataset.here = '1';
    const pct = row.score == null ? 0 : Math.round(row.score * 100);
    const label = row.probes
      ? `HSK ${row.level}: ${VERDICT_TEXT[row.verdict]}, ${pct}% over `
        + `${plural(row.probes, 'question')}`
      : `HSK ${row.level}: not asked about`;
    line.title = label;
    line.setAttribute('aria-label', label);

    line.append(el('div', 'lad-name', `HSK ${row.level}`));
    const track = el('div', 'lad-track');
    const fill = el('div', 'lad-fill');
    // A probed level always shows something: a zero-width bar is
    // indistinguishable from a level nobody asked about, which is the one
    // distinction this chart exists to make.
    fill.style.width = row.probes ? `${Math.max(3, pct)}%` : '0';
    fill.style.background = VERDICT_COLORS[row.verdict];
    track.append(fill);
    line.append(track);
    line.append(el('div', 'lad-verdict', row.probes ? VERDICT_TEXT[row.verdict] : '—'));
    rows.append(line);
  }
  root.append(rows);

  const legend = el('div', 'stage-legend lad-legend');
  for (const verdict of ['sustained', 'partial', 'struggled', 'untested']) {
    const item = el('div', 'stage-item');
    const swatch = el('span', 'stage-swatch');
    swatch.style.background = VERDICT_COLORS[verdict];
    item.append(swatch, el('span', 'stage-name', VERDICT_TEXT[verdict]));
    legend.append(item);
  }
  root.append(legend);

  const details = el('details', 'viz-details');
  details.append(el('summary', '', 'Show these numbers as a table'));
  const table = el('table', 'viz-table');
  const head = document.createElement('tr');
  head.append(el('th', '', 'Level'), el('th', '', 'Questions'),
    el('th', '', 'Score'), el('th', '', 'Verdict'));
  table.append(head);
  for (const row of [...perLevel].reverse()) {
    const tr = document.createElement('tr');
    tr.append(
      el('td', '', `HSK ${row.level}`),
      el('td', '', String(row.probes)),
      el('td', '', row.score == null ? '—' : `${Math.round(row.score * 100)}%`),
      el('td', '', VERDICT_TEXT[row.verdict]),
    );
    table.append(tr);
  }
  details.append(table);
  root.append(details);
  return root;
}

// ---------------------------------------------------------------------------
// Level trend: every placement interview ever sat, in the order they were sat
// ---------------------------------------------------------------------------

// Columns per sitting the chart will draw before it starts leaving the oldest
// out. Past this each column is thinner than the level number over it; the
// table underneath still lists every sitting, and the chart says so.
export const TREND_COLUMNS = 24;

// The scale the columns are drawn against — the whole HSK ladder, always.
const MAX_TREND_LEVEL = 9;

const shortDate = (ts) => new Date(ts).toLocaleDateString(undefined,
  { month: 'short', day: 'numeric' });
const fullDate = (ts) => new Date(ts).toLocaleDateString(undefined,
  { year: 'numeric', month: 'short', day: 'numeric' });

// `points` is progression().points from lib/placement.js — one entry per
// sitting, oldest first, `level` 0 for a run that held nothing. `onPick` makes
// the columns open that sitting's report; without it they are still hoverable
// but inert.
export function levelTrend(points, { onPick = null, title = 'Your placements over time' } = {}) {
  ensureCss();
  const root = el('div', 'viz trend-box');
  if (title) root.append(el('p', 'viz-title', title));

  const shown = points.slice(-TREND_COLUMNS);
  const hidden = points.length - shown.length;
  root.append(el('p', 'viz-sub',
    `Each interview you have sat, oldest first, on the full HSK scale.${
      onPick ? ' Pick one to read its report.' : ''}`));

  const plot = el('div', 'tr-plot');
  const axis = el('div', 'tr-axis');
  const readout = el('div', 'viz-readout');
  const best = shown.reduce((top, p) => Math.max(top, p.level), 0);

  shown.forEach((point, i) => {
    const latest = i === shown.length - 1;
    const col = el(onPick ? 'button' : 'div', 'tr-col');
    if (onPick) col.type = 'button';
    if (latest) col.dataset.latest = '1';
    if (!point.level) col.dataset.zero = '1';
    const label = `${fullDate(point.at)}: `
      + `${point.level ? `HSK ${point.level}` : 'below HSK 1'}`
      + `, ${plural(point.turns, 'question')}, ${point.confidence} confidence`
      + (point.detailed ? '' : ' (transcript no longer kept)');
    col.title = label;
    col.setAttribute('aria-label', label);

    // The ends of the line and its high point carry their number; the rest
    // would be a row of digits saying what the bar heights already say.
    const showValue = latest || i === 0 || (point.level === best && point.level > 0);
    if (showValue) {
      col.append(el('div', 'tr-value', point.level ? String(point.level) : '–'));
    }
    const bar = el('div', 'tr-bar');
    // A sitting that held nothing still gets a visible stub: no column at all
    // reads as "did not sit it", which is the opposite of what happened.
    bar.style.height = `${Math.max(2, (point.level / MAX_TREND_LEVEL) * (showValue ? 82 : 100))}%`;
    col.append(bar);
    const describe = () => { readout.replaceChildren(el('b', '', label)); };
    col.addEventListener('mouseenter', describe);
    col.addEventListener('focus', describe);
    col.addEventListener('mouseleave', () => readout.replaceChildren());
    col.addEventListener('blur', () => readout.replaceChildren());
    if (onPick) col.addEventListener('click', () => onPick(point));
    plot.append(col);

    // At two dozen columns there is room for roughly every fourth date.
    const labelled = latest || i === 0 || i % 4 === 0;
    const tick = el('div', 'tr-tick', labelled ? shortDate(point.at) : '');
    if (latest) tick.dataset.latest = '1';
    axis.append(tick);
  });

  root.append(plot, axis, readout);
  if (hidden > 0) {
    root.append(el('div', 'fc-note',
      `Showing the last ${TREND_COLUMNS} of ${points.length} sittings — the table below has them all.`));
  }
  return root;
}

// A card's own place on the curve, for a table row.
export function strengthMeter(word) {
  ensureCss();
  const stage = cardStage(word);
  const value = strength(word);
  const meter = el('span', 'meter');
  meter.title = `${STAGE_LABELS[stage]} — ${STAGE_NOTES[stage]}`;
  const fill = el('i');
  fill.style.width = `${Math.max(word.srs ? 6 : 0, Math.round(value * 100))}%`;
  fill.style.background = STAGE_COLORS[stage];
  meter.append(fill);
  return meter;
}
