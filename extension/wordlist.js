import {
  DAY_MS, DEFAULT_LIMITS, STAGES, cardStage, srsStatus, strength, planSession, formatDelay,
  stageCounts, isDue,
} from './lib/srs.js';
import {
  STAGE_COLORS, STAGE_LABELS, STAGE_NOTES, forecastChart, stageBar, strengthMeter,
} from './lib/progress.js';
import { cardKey, tombstoneFor } from './lib/merge.js';
import { parsePlecoExport } from './lib/pleco.js';
import { createLookup } from './lib/lookup.js';
import { createTutor } from './lib/tutor.js';
import { mountShell } from './lib/shell.js';
import { forms, getHanziPref, onHanziPref, secondaryLabel } from './lib/hanzi.js';

const { createSelectionBar } = globalThis.ZhongwenSaveCard;

mountShell({ active: 'library' });

// Nothing here is a test, so hovering always defines — the same popup you get
// on a web page, including saving a word you meet inside a definition.
const lookup = createLookup({
  getEnabled: () => !tutor.isPointing(),
  hoverTitle: 'Hover for definition, examples, and related words',
});

// Highlighting inside a row raises the shared bar. Saving from here is how a
// sentence card's own words become cards of their own.
const selectionBar = createSelectionBar({ root: () => listEl, lookup });

// The same tutor as the guides, the review card and the news digest. Highlight
// a word in any row to ask about that one; otherwise it answers about the
// collection.
const tutor = createTutor({
  lookup,
  subtitle: 'Highlight a word in any row to ask about it',
  selectionBar,
  sectionFor: () => ({ section: 'Saved library', text: '' }),
  context: () => ({ where: 'their saved flashcard library' }),
  intro: () => 'Highlight a word in the list and ask why it keeps slipping, how it '
    + 'differs from a word you already know, or for a sentence that would make it '
    + 'stick.',
  starters: () => [
    'Give me a memorable example sentence for a word I keep forgetting.',
    'How should I tell apart words that look similar to me?',
    'What is a good order to learn these words in?',
  ],
});

const listEl = document.getElementById('list');
const countEl = document.getElementById('count');
const overviewEl = document.getElementById('overview');
const filtersEl = document.getElementById('filters');

// View state. Cards themselves live in storage; this is only how they are
// shown, so it never needs persisting.
let allWords = [];
let stageFilter = 'all';
let sortBy = 'saved';
let limits = { ...DEFAULT_LIMITS };
// Which script the table leads with; kept live by the navbar toggle.
let hanziPref = 'simp-first';

const SORTS = {
  saved: { label: 'Recently saved', compare: (a, b) => savedAt(b) - savedAt(a) },
  due: {
    label: 'Next review first',
    // Unstudied cards have no schedule at all; they sort after everything that
    // does, rather than to an arbitrary end of the timeline.
    compare: (a, b) => (a.srs ? a.srs.due : Infinity) - (b.srs ? b.srs.due : Infinity),
  },
  weakest: { label: 'Weakest first', compare: (a, b) => strength(a) - strength(b) },
  strongest: { label: 'Strongest first', compare: (a, b) => strength(b) - strength(a) },
  touches: { label: 'Most looked up', compare: (a, b) => (b.touches || 1) - (a.touches || 1) },
};

const savedAt = (w) => w.lastSavedAt || w.savedAt || 0;

async function getWords() {
  const { wordlist = [] } = await chrome.storage.local.get('wordlist');
  return wordlist;
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function fmtDate(ts) {
  if (!ts) return '';
  return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function plural(n, word) {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

// ---------------------------------------------------------------------------
// Overview: the whole collection's position on the curve, and what is coming
// ---------------------------------------------------------------------------

function renderOverview(words) {
  overviewEl.replaceChildren();
  if (!words.length) return;
  const now = Date.now();
  const plan = planSession(words, now, limits);
  const counts = stageCounts(words);

  const line = el('div', 'overview-line');
  line.append(el('b', '', String(words.length)), ' saved');
  line.append(' · ', el('b', '', String(plan.queued)), ' in today’s session');
  // Spelled out because "ready to review" and the forecast's today column can
  // otherwise look contradictory: new words have no due date at all.
  if (plan.queued) {
    line.append(` (${plan.dueSelected.length} due, ${plan.newSelected.length} new)`);
  }
  if (plan.newHeld) line.append(` · ${plural(plan.newHeld, 'new word')} waiting for a later day`);
  if (counts.mature) line.append(` · ${counts.mature} mature`);
  overviewEl.append(line);

  const grid = el('div', 'overview-grid');
  grid.append(
    stageBar(words),
    forecastChart(words, now, { days: 21, newToday: plan.newSelected.length }),
  );
  overviewEl.append(grid);
}

// ---------------------------------------------------------------------------
// Filter + sort controls
// ---------------------------------------------------------------------------

function renderFilters(words) {
  filtersEl.replaceChildren();
  if (!words.length) return;
  const counts = stageCounts(words);
  const now = Date.now();
  const dueCount = words.filter((w) => w.srs && isDue(w.srs, now)).length;

  const chips = el('div', 'chips');
  const options = [
    ['all', 'All', words.length, null],
    ['due', 'Ready now', dueCount, '#b5232b'],
    ...STAGES.map((s) => [s, STAGE_LABELS[s], counts[s], STAGE_COLORS[s]]),
  ];
  for (const [key, label, count, color] of options) {
    const chip = el('button', 'chip');
    chip.type = 'button';
    if (key === stageFilter) chip.classList.add('on');
    if (color) {
      const dot = el('span', 'chip-dot');
      dot.style.background = color;
      chip.append(dot);
    }
    chip.append(el('span', '', label), el('span', 'chip-n', String(count)));
    if (STAGE_NOTES[key]) chip.title = `${label} — ${STAGE_NOTES[key]}`;
    chip.addEventListener('click', () => {
      stageFilter = key;
      render(allWords);
    });
    chips.append(chip);
  }

  const sortWrap = el('label', 'sort');
  sortWrap.append(el('span', '', 'Sort'));
  const select = el('select');
  for (const [key, { label }] of Object.entries(SORTS)) {
    const option = el('option', '', label);
    option.value = key;
    if (key === sortBy) option.selected = true;
    select.append(option);
  }
  select.addEventListener('change', () => {
    sortBy = select.value;
    render(allWords);
  });
  sortWrap.append(select);

  filtersEl.append(chips, sortWrap);
}

function visible(words) {
  const now = Date.now();
  const filtered = stageFilter === 'all' ? words.slice()
    : stageFilter === 'due' ? words.filter((w) => w.srs && isDue(w.srs, now))
    : words.filter((w) => cardStage(w) === stageFilter);
  return filtered.sort(SORTS[sortBy].compare);
}

// ---------------------------------------------------------------------------
// Card rows
// ---------------------------------------------------------------------------

// The scheduling story for one card: how far apart its reviews have stretched,
// how often it has been forgotten, and when it comes back.
function scheduleCell(word, now) {
  const td = el('td', 'sched');
  const stage = cardStage(word);
  const row = el('div', 'sched-top');
  row.append(strengthMeter(word));
  const chip = el('span', `stage-chip stage-${stage}`, STAGE_LABELS[stage]);
  chip.title = STAGE_NOTES[stage];
  row.append(chip);
  td.append(row);

  const s = word.srs;
  const detail = s
    ? `${s.ivl >= 1 ? `every ${formatDelay(s.ivl * DAY_MS)}` : 'relearning'}` +
      ` · ${plural(s.reps, 'rep')}` +
      (s.lapses ? ` · ${plural(s.lapses, 'lapse')}` : '') +
      ` · ease ${s.ease.toFixed(2)}`
    : 'not started';
  td.append(el('div', 'sched-detail', detail));
  return td;
}

function render(words) {
  lookup.hide(); // the rows it was anchored to are about to be replaced
  selectionBar.hide();
  allWords = words;
  const now = Date.now();
  const plan = planSession(words, now, limits);
  countEl.textContent = words.length
    ? `${plural(words.length, 'card')}`
    : '';
  renderOverview(words);
  renderFilters(words);
  listEl.replaceChildren();
  if (words.length === 0) {
    const p = el('p', 'empty',
      'No saved cards yet. Save a word or click "☆ save sentence" beside an example sentence.');
    listEl.append(p);
    return;
  }

  const shown = visible(words);
  if (shown.length === 0) {
    listEl.append(el('p', 'empty', 'No cards in that group yet.'));
    return;
  }

  const table = document.createElement('table');
  const thead = document.createElement('thead');
  const hrow = document.createElement('tr');
  // The look-up count used to be its own column headed "×", which read as a
  // delete column and was empty for most rows. It belongs with the date.
  // The second column is whichever script the learner is NOT reading in, so
  // its heading follows the toggle.
  for (const h of ['Card', secondaryLabel(hanziPref), 'Pinyin', 'Definition',
    'Saved', 'Progress', 'Next', '']) {
    const th = document.createElement('th');
    th.textContent = h;
    hrow.append(th);
  }
  thead.append(hrow);
  table.append(thead);
  const tbody = document.createElement('tbody');
  for (const w of shown) {
    const tr = document.createElement('tr');
    const sentenceCard = w.cardType === 'sentence';
    if (sentenceCard) tr.className = 'sentence-card';
    const status = srsStatus(w, now);
    const stClass =
      status === 'new' ? 'st-new' : status.startsWith('due') ? 'st-due' : 'st-later';
    const face = forms(w, hanziPref);
    const cells = [
      ['hanzi', face.primary],
      ['hanzi', face.secondary || ''],
      ['pinyin', w.pinyin],
      ['', w.defs],
      ['meta', fmtDate(savedAt(w))],
    ];
    cells.forEach(([cls, text], cellIndex) => {
      const td = document.createElement('td');
      if (cls) td.className = cls;
      if (cellIndex === 0) {
        // Headword, badge and speaker share one flex line so the button stops
        // dropping below the text as soon as the column gets narrow.
        const wrap = document.createElement('div');
        wrap.className = 'card-cell';
        wrap.append(lookup.hoverable('span', null, text));
        if (sentenceCard) {
          const badge = document.createElement('span');
          badge.className = 'type-badge';
          badge.textContent = 'Sentence';
          wrap.append(badge);
        }
        const speak = document.createElement('button');
        speak.className = 'speak';
        speak.textContent = '🔊';
        speak.title = 'Play Mandarin pronunciation (Shift-click: extra slow)';
        speak.setAttribute('aria-label', `Play pronunciation for ${face.primary}`);
        speak.addEventListener('click', (event) => {
          event.stopPropagation();
          chrome.runtime.sendMessage({
            type: 'speak', text: face.primary, slow: event.shiftKey,
          });
        });
        wrap.append(speak);
        td.append(wrap);
      } else if (cls === 'hanzi' && text) {
        // The other hanzi column is hoverable too; the rest are plain text.
        td.append(lookup.hoverable('span', null, text));
      } else {
        td.textContent = text;
      }
      // How many times this word was looked up, folded in beside its date.
      if (cls === 'meta' && (w.touches || 1) > 1) {
        td.append(el('span', 'touches', ` · ${w.touches}×`));
      }
      tr.append(td);
    });
    tr.append(scheduleCell(w, now));
    tr.append(el('td', `status ${stClass}`, status));
    const del = document.createElement('td');
    del.className = 'del';
    const btn = document.createElement('button');
    btn.textContent = '✕';
    btn.title = 'Remove';
    btn.addEventListener('click', async () => {
      // Delete by identity, not by row index: storage may have changed since
      // render (e.g. a word saved from another tab shifts every index).
      const words2 = (await getWords()).filter(
        (x) => !((x.cardType || 'word') === (w.cardType || 'word') &&
          x.simp === w.simp &&
          (x.trad || x.simp) === (w.trad || w.simp) &&
          x.pinyin === w.pinyin),
      );
      // Tombstone the deletion so sync removes the card on other devices
      // instead of resurrecting it on the next pull.
      const { tombstones = [] } = await chrome.storage.local.get('tombstones');
      tombstones.unshift(tombstoneFor(w, Date.now()));
      await chrome.storage.local.set({
        wordlist: words2,
        tombstones: tombstones.slice(0, 5000),
      });
      render(words2);
    });
    del.append(btn);
    tr.append(del);
    tbody.append(tr);
  }
  table.append(tbody);
  listEl.append(table);
}

// ---------------------------------------------------------------------------
// Importing a Pleco deck
//
// Pleco is where a lot of people's Chinese already lives, and its cards are
// the words they actually looked up — a much better starting deck than
// anything this extension could guess for them.
//
// Nothing is added on picking the file. A deck is hundreds of cards and a
// review queue you did not choose is worse than no import at all, so the file
// is parsed and resolved into a list you scroll, drop rows from, and then
// confirm. Cards already in the library never appear in it.
//
// Each headword goes through the same resolver a word saved from a web page
// does (lib/cards.js, in the background worker where the dictionary lives), so
// an imported card is indistinguishable from a saved one: real CC-CEDICT
// definitions, both scripts, tone-coloured pinyin. Pleco's own pinyin and
// definition are the fallback for a word CC-CEDICT has never heard of — a
// name, slang, something out of a user dictionary — rather than a reason to
// drop the card.
// ---------------------------------------------------------------------------

const RESOLVE_BATCH = 300; // the background worker caps a single request at 400

const importStatusEl = document.getElementById('importStatus');
const importFileEl = document.getElementById('importFile');
const importPreviewEl = document.getElementById('importPreview');

let pending = []; // candidates on screen, in the order they will be added

function showImportStatus(nodes, bad = false) {
  importStatusEl.replaceChildren(...nodes);
  importStatusEl.classList.toggle('bad', bad);
  importStatusEl.hidden = false;
}

function closeImport() {
  pending = [];
  importPreviewEl.replaceChildren();
  importPreviewEl.hidden = true;
}

// A card built from what Pleco said, for a headword the dictionary does not
// have. Pleco's numbered pinyin is kept as written rather than dressed up as
// something it is not.
function plecoCard(item) {
  return {
    cardType: 'word',
    simp: item.simp,
    trad: item.trad || item.simp,
    pinyin: item.pinyin || '',
    tones: '',
    defs: item.defs || '',
    sourceWord: '',
  };
}

function renderImportPreview(summary) {
  importPreviewEl.replaceChildren();
  importPreviewEl.hidden = false;

  const head = el('div', 'imp-head');
  head.append(el('b', '', `${plural(pending.length, 'card')} to add`));
  const notes = [];
  if (summary.duplicate) notes.push(`${summary.duplicate} already in your library`);
  if (summary.skipped) notes.push(`${plural(summary.skipped, 'row')} with no Chinese`);
  notes.push(`from a Pleco ${summary.format === 'xml' ? 'XML' : 'text'} export`);
  head.append(el('span', 'imp-note', ` · ${notes.join(' · ')}`));
  importPreviewEl.append(head);

  const list = el('div', 'imp-list');
  if (!pending.length) {
    list.append(el('div', 'imp-empty',
      'Nothing left to add — every card in that file is already in your library, '
      + 'or you removed it from this list.'));
  }
  for (const item of pending) {
    const row = el('div', 'imp-row');
    const text = el('div', 'imp-text');
    const face = forms(item.card, hanziPref);
    const headline = el('div', 'imp-word');
    // Hoverable like every other run of hanzi in the app — deciding whether to
    // keep a card is exactly when you want to look it up.
    headline.append(lookup.hoverable('span', 'imp-hanzi', face.primary));
    if (face.secondary) headline.append(lookup.hoverable('span', 'imp-alt', face.secondary));
    if (item.pinyin) headline.append(el('span', 'imp-pinyin', item.pinyin));
    // Worth flagging: this row's definition is Pleco's, not the dictionary's.
    if (!item.known) headline.append(el('span', 'imp-badge', 'not in CC-CEDICT'));
    text.append(headline, el('div', 'imp-defs', item.card.defs || '(no definition)'));
    const drop = el('button', 'imp-drop', '✕');
    drop.type = 'button';
    drop.title = `Do not import ${face.primary}`;
    drop.setAttribute('aria-label', `Remove ${face.primary} from this import`);
    drop.addEventListener('click', () => {
      pending = pending.filter((p) => p.key !== item.key);
      renderImportPreview(summary);
    });
    row.append(text, drop);
    list.append(row);
  }
  importPreviewEl.append(list);

  const actions = el('div', 'imp-actions');
  const confirm = el('button', 'primary', `Add ${plural(pending.length, 'card')}`);
  confirm.type = 'button';
  confirm.id = 'importConfirm';
  confirm.disabled = !pending.length;
  confirm.addEventListener('click', commitImport);
  const cancel = el('button', '', 'Cancel');
  cancel.type = 'button';
  cancel.id = 'importCancel';
  cancel.addEventListener('click', () => {
    closeImport();
    showImportStatus([el('span', '', 'Import cancelled — nothing was added.')]);
  });
  actions.append(confirm, cancel);
  importPreviewEl.append(actions);
}

async function commitImport() {
  const now = Date.now();
  const cards = pending.map((p) => ({
    ...p.card, savedAt: now, lastSavedAt: now, touches: 1, srs: null,
  }));
  const count = cards.length;
  closeImport();
  if (!count) return;
  // Re-read rather than trusting the list this preview was built from: a sync
  // or another tab may have added cards while it was on screen.
  const existing = await getWords();
  const have = new Set(existing.map(cardKey));
  const fresh = cards.filter((c) => !have.has(cardKey(c)));
  await chrome.storage.local.set({ wordlist: fresh.concat(existing) });
  chrome.runtime.sendMessage({ type: 'syncNow' }).catch(() => {});
  showImportStatus([
    el('b', '', `Added ${plural(fresh.length, 'card')}`),
    el('span', '', ' to your library. They start as new cards, due today.'),
  ]);
  render(await getWords());
}

async function importPleco(text) {
  closeImport();
  const { items, format, skipped } = parsePlecoExport(text);
  if (!items.length) {
    showImportStatus([el('span', '', skipped
      ? `Found ${plural(skipped, 'row')} but no Chinese in any of them — is this a Pleco card export?`
      : 'No cards in that file. Export from Pleco with Cards → Export Cards, as either a '
        + 'Pleco Flashcard File (XML) or a Text File.')], true);
    return;
  }

  showImportStatus([el('span', '', `Looking up ${plural(items.length, 'card')}…`)]);

  const have = new Set((await getWords()).map(cardKey));
  const summary = { duplicate: 0, skipped, format };
  pending = [];

  for (let i = 0; i < items.length; i += RESOLVE_BATCH) {
    const chunk = items.slice(i, i + RESOLVE_BATCH);
    const answer = await chrome.runtime.sendMessage({
      type: 'resolveCards',
      // `unit: true` says this is one dictionary headword, not prose, so the
      // resolver does not refuse a card for looking like several sentences.
      items: chunk.map((item) => ({ text: item.simp, unit: true })),
    }).catch(() => null);

    chunk.forEach((item, n) => {
      const resolved = answer?.cards?.[n];
      // Only take the resolver's word when it actually matched a headword: its
      // fallback is a sentence card, which is not what a Pleco entry is.
      const known = !!(resolved?.card && resolved.card.cardType === 'word');
      const card = known ? resolved.card : plecoCard(item);
      const key = cardKey(card);
      if (have.has(key)) { summary.duplicate++; return; }
      have.add(key); // the same word under two headwords is still one card
      pending.push({ key, card, known, pinyin: card.pinyin || item.pinyin });
    });
  }

  importStatusEl.hidden = true;
  renderImportPreview(summary);
}

document.getElementById('import').addEventListener('click', () => importFileEl.click());

importFileEl.addEventListener('change', async () => {
  const file = importFileEl.files?.[0];
  // Reset first: picking the same file twice in a row must re-run the import.
  importFileEl.value = '';
  if (!file) return;
  try {
    await importPleco(await file.text());
  } catch (err) {
    showImportStatus([el('span', '', `Could not read that file: ${err.message}`)], true);
  }
});

document.getElementById('export').addEventListener('click', async () => {
  const words = await getWords();
  // Pleco flashcard format: headword \t pinyin \t definition, with the
  // traditional form embedded in the headword as 简[繁]. Anki maps columns
  // freely at import, so this works for both.
  const tsv = words
    .map((w) => {
      const head = w.trad && w.trad !== w.simp ? `${w.simp}[${w.trad}]` : w.simp;
      return [head, w.pinyin, w.defs].join('\t');
    })
    .join('\n');
  const blob = new Blob([tsv], { type: 'text/tab-separated-values' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'zhongwen-explorer-cards.tsv';
  a.click();
  URL.revokeObjectURL(url);
});

document.getElementById('clear').addEventListener('click', async () => {
  if (!confirm('Delete all saved cards (including review progress)?')) return;
  const now = Date.now();
  const words = await getWords();
  const { tombstones = [] } = await chrome.storage.local.get('tombstones');
  const cleared = words.map((w) => tombstoneFor(w, now)).concat(tombstones);
  await chrome.storage.local.set({
    wordlist: [],
    tombstones: cleared.slice(0, 5000),
  });
  render([]);
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.wordlist) render(changes.wordlist.newValue || []);
});

// The whole table is headwords, so a flip repaints all of it — including the
// second column's heading, which names the script you are not reading in.
onHanziPref((pref) => {
  hanziPref = pref;
  render(allWords);
});

async function init() {
  [limits, hanziPref] = await Promise.all([
    chrome.storage.sync.get(DEFAULT_LIMITS).catch(() => DEFAULT_LIMITS),
    getHanziPref(),
  ]);
  render(await getWords());
}

init();

// Pull phone-side changes whenever the library is opened; the storage
// listener above repaints when they land. No-op while sync is unpaired.
chrome.runtime.sendMessage({ type: 'syncNow' }).catch(() => {});
