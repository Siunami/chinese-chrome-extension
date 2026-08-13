// Word-detail bottom sheet: the mobile counterpart of the extension's hover
// popup. Tap any hanzi (review answers, word list rows) to open it. Shows the
// chunk-aware containing word with every dictionary entry and numbered
// senses, example sentences, a per-character breakdown, and related words —
// all tappable to navigate deeper, with a back button through the trail.
// Words can be saved straight into the local deck; they sync out like any
// card graded here.

import { lookupDetails } from './lib/dict.js';
import { cardKey, tombstoneFor } from './lib/merge.js';
import * as db from './db.js';
import { speak } from './speech.js';

const CJK_RE = /[㐀-鿿豈-﫿]|[\ud840-\ud87f][\udc00-\udfff]/;

let requestSyncFn = () => {};
let deckChangedFn = () => {};

// `onDeckChange` fires after a save or a removal made from the sheet, so the
// view behind it does not go on showing a card that is no longer in the deck.
export function initDetails({ requestSync, onDeckChange = () => {} }) {
  requestSyncFn = requestSync;
  deckChangedFn = onDeckChange;
}

function el(tag, cls, text) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined) node.textContent = text;
  return node;
}

// ---------------------------------------------------------------------------
// Sheet shell
// ---------------------------------------------------------------------------

let overlayEl = null;
let sheetBodyEl = null;
let backBtnEl = null;
let navStack = []; // [{ text, cursorIndex }]
let renderSeq = 0;

function ensureSheet() {
  if (overlayEl) return;
  overlayEl = el('div', 'sheet-overlay');
  overlayEl.addEventListener('click', (e) => {
    if (e.target === overlayEl) closeDetails();
  });
  const sheet = el('div', 'sheet');
  const bar = el('div', 'sheet-bar');
  backBtnEl = el('button', 'sheet-back', '‹ back');
  backBtnEl.addEventListener('click', () => {
    if (navStack.length < 2) return;
    navStack.pop();
    showPage(navStack[navStack.length - 1]);
  });
  const close = el('button', 'sheet-close', '✕');
  close.setAttribute('aria-label', 'Close');
  close.addEventListener('click', closeDetails);
  bar.append(backBtnEl, el('span', 'sheet-grab'), close);
  sheetBodyEl = el('div', 'sheet-body');
  sheet.append(bar, sheetBodyEl);
  overlayEl.append(sheet);
  document.body.append(overlayEl);
}

export function closeDetails() {
  renderSeq++;
  navStack = [];
  if (overlayEl) overlayEl.classList.remove('open');
}

// ---------------------------------------------------------------------------
// Tappable Chinese text
// ---------------------------------------------------------------------------

// Wraps each hanzi of `text` in a tappable span; tapping opens the sheet on
// the chunk-aware word containing that character (欢 in 我喜欢你 → 喜欢).
export function tappableChinese(tag, cls, text, { push = false } = {}) {
  const wrap = el(tag, cls);
  Array.from(text).forEach((ch, index) => {
    if (!CJK_RE.test(ch)) {
      wrap.append(document.createTextNode(ch));
      return;
    }
    const s = el('span', 'tap-char', ch);
    s.addEventListener('click', (e) => {
      e.stopPropagation();
      openDetailsAt(text, index, { push });
    });
    wrap.append(s);
  });
  return wrap;
}

export function openDetailsAt(text, cursorIndex, { push = false } = {}) {
  ensureSheet();
  overlayEl.classList.add('open');
  const page = { text, cursorIndex };
  if (push && navStack.length > 0) navStack.push(page);
  else navStack = [page];
  showPage(page);
}

// ---------------------------------------------------------------------------
// Save to deck
// ---------------------------------------------------------------------------

// Cards already in the deck, by cardKey — refreshed whenever the sheet renders
// so a save control can show whether it is already saved rather than only
// offering to save again.
let savedKeys = new Set();

async function refreshSavedKeys() {
  savedKeys = new Set((await db.allDocs()).filter((d) => !d.deleted).map(cardKey));
}

// Same doc shape and identity as handleSaveWord in the extension's
// background.js.
function entryDoc(entry) {
  return {
    cardType: 'word',
    simp: entry.simp,
    trad: entry.trad,
    pinyin: entry.pinyin.map((p) => p.text).join(' '),
    tones: entry.pinyin.map((p) => p.tone).join(','),
    defs: entry.defs.join('; '),
  };
}

// Re-saves bump touches and keep SRS progress, as they do in the extension.
async function saveEntry(entry) {
  const now = Date.now();
  const doc = {
    ...entryDoc(entry),
    savedAt: now,
    lastSavedAt: now,
    touches: 1,
    srs: null,
    sourceWord: '',
  };
  const key = cardKey(doc);
  const existing = (await db.allDocs()).find((d) => cardKey(d) === key);
  if (existing && !existing.deleted) {
    existing.touches = (existing.touches || 1) + 1;
    existing.lastSavedAt = now;
    existing.defs = doc.defs;
    existing.tones = doc.tones;
    await db.putDocs([existing]);
  } else {
    // A fresh save over a tombstone resurrects the card on merge, because
    // lastSavedAt is newer than deletedAt.
    await db.putDocs([doc]);
  }
  requestSyncFn();
  deckChangedFn();
}

// Tombstoned like a delete from the word list, so the removal syncs out
// instead of coming back on the next pull.
async function unsaveEntry(entry) {
  await db.putDocs([tombstoneFor(entryDoc(entry), Date.now())]);
  requestSyncFn();
  deckChangedFn();
}

// One control for both directions: a word already in the deck shows a check
// and tapping it takes the word back out.
function saveButton(entry, { compact = false } = {}) {
  const btn = el('button', 'sheet-save');
  const key = cardKey(entryDoc(entry));
  let busy = false;

  function paint() {
    const saved = savedKeys.has(key);
    btn.textContent = saved ? (compact ? '✓' : '✓ saved') : (compact ? '☆' : '☆ save');
    btn.classList.toggle('saved', saved);
    btn.setAttribute('aria-pressed', saved ? 'true' : 'false');
    btn.title = saved
      ? `In your word list — tap to remove ${entry.simp}`
      : `Save ${entry.simp} to your word list`;
  }
  paint();

  btn.addEventListener('click', async (e) => {
    e.stopPropagation();
    if (busy) return;
    busy = true;
    const saved = savedKeys.has(key);
    try {
      if (saved) {
        await unsaveEntry(entry);
        savedKeys.delete(key);
      } else {
        await saveEntry(entry);
        savedKeys.add(key);
      }
      paint();
    } catch {
      btn.textContent = 'try again';
    }
    busy = false;
  });
  return btn;
}

// ---------------------------------------------------------------------------
// Rendering (same sections as the extension popup)
// ---------------------------------------------------------------------------

function tonedHanzi(word, pinyin, cls) {
  const wrap = el('span', cls);
  const chars = Array.from(word);
  const toned = pinyin.filter((p) => p.tone > 0);
  const usable = toned.length === chars.length;
  chars.forEach((ch, i) => wrap.append(el('span', usable ? `tone${toned[i].tone}` : '', ch)));
  return wrap;
}

function tonedPinyin(pinyin, cls) {
  const wrap = el('span', cls);
  pinyin.forEach((p, i) => {
    if (i > 0) wrap.append(' ');
    wrap.append(el('span', p.tone >= 0 && p.tone <= 5 ? `tone${p.tone}` : '', p.text));
  });
  return wrap;
}

function speakBtn(text) {
  const btn = el('button', 'sheet-speak', '🔊');
  btn.setAttribute('aria-label', `Play pronunciation for ${text}`);
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    speak(text);
  });
  return btn;
}

function entryBlock(entry) {
  const box = el('div', 'sheet-entry');
  const head = el('div', 'sheet-head');
  head.append(tonedHanzi(entry.simp, entry.pinyin, 'sheet-word'));
  if (entry.trad && entry.trad !== entry.simp) {
    head.append(tonedHanzi(entry.trad, entry.pinyin, 'sheet-word alt'));
  }
  head.append(
    tonedPinyin(entry.pinyin, 'sheet-pinyin'),
    speakBtn(entry.simp),
    saveButton(entry),
  );
  box.append(head);
  const defs = el('div', 'sheet-defs');
  entry.defs.forEach((definition, i) => {
    const sense = el('div', 'sheet-sense');
    if (entry.defs.length > 1) sense.append(el('span', 'sheet-sense-num', String(i + 1)));
    sense.append(el('span', '', definition));
    defs.append(sense);
  });
  box.append(defs);
  return box;
}

function exampleBlock(ex, forms) {
  const box = el('div', 'sheet-example');
  const zh = tappableChinese('div', 'sheet-ex-zh', ex.zh, { push: true });
  let found = -1;
  let form = '';
  for (const f of forms) {
    const i = f ? ex.zh.indexOf(f) : -1;
    if (i !== -1 && (found === -1 || i < found)) { found = i; form = f; }
  }
  if (found !== -1) {
    // Every child of the tappable text is exactly one code point (span for
    // CJK, text node otherwise); walk them with a code-point counter.
    const start = Array.from(ex.zh.slice(0, found)).length;
    const length = Array.from(form).length;
    let unit = 0;
    for (const node of zh.childNodes) {
      if (node.nodeType === 1 && unit >= start && unit < start + length) {
        node.classList.add('hl');
      }
      unit += 1;
    }
  }
  zh.append(speakBtn(ex.zh));
  box.append(zh);
  if (ex.py) box.append(el('div', 'sheet-ex-py', ex.py));
  box.append(el('div', 'sheet-ex-en', ex.en));
  return box;
}

function charRow(character) {
  const entry = character.entries?.[0];
  if (!entry) return null;
  const row = el('div', 'sheet-char-row');
  const info = el('div', 'sheet-char-info');
  const more = character.entryCount > 1 ? `  (+${character.entryCount - 1} more)` : '';
  info.append(
    tonedPinyin(entry.pinyin, 'sheet-char-pinyin'),
    el('div', 'sheet-char-def', entry.defs.join(' ◆ ') + more),
  );
  row.append(
    tonedHanzi(character.char, entry.pinyin, 'sheet-char-word'),
    info,
    saveButton(entry, { compact: true }),
  );
  row.addEventListener('click', () => {
    navStack.push({ text: character.char, cursorIndex: 0 });
    showPage(navStack[navStack.length - 1]);
  });
  return row;
}

function relatedRow(entry) {
  const row = el('div', 'sheet-related-row');
  const head = el('div', 'sheet-head');
  head.append(
    tonedHanzi(entry.simp, entry.pinyin, 'sheet-related-word'),
    tonedPinyin(entry.pinyin, 'sheet-char-pinyin'),
    speakBtn(entry.simp),
    saveButton(entry, { compact: true }),
    el('span', 'sheet-related-reason', entry.reason),
  );
  row.append(head);
  const shown = entry.defs.slice(0, 3);
  const extra = entry.defs.length - shown.length;
  row.append(el('div', 'sheet-char-def',
    shown.join(' ◆ ') + (extra > 0 ? `  (+${extra} more senses)` : '')));
  row.addEventListener('click', () => {
    navStack.push({ text: entry.simp, cursorIndex: 0 });
    showPage(navStack[navStack.length - 1]);
  });
  return row;
}

function section(label) {
  const wrap = el('div', 'sheet-section');
  wrap.append(el('div', 'sheet-label', label));
  return wrap;
}

async function showPage(page) {
  const seq = ++renderSeq;
  backBtnEl.classList.toggle('hidden', navStack.length < 2);
  sheetBodyEl.replaceChildren(el('p', 'sheet-loading',
    'Loading dictionary… (first time only, cached for offline use)'));
  let result = null;
  try {
    result = await lookupDetails(page.text, page.cursorIndex);
  } catch {
    result = null;
  }
  // Which of these are already in the deck; a failure here only means the
  // controls render as unsaved, which the tap itself then corrects.
  try {
    await refreshSavedKeys();
  } catch { /* keep whatever we knew */ }
  if (seq !== renderSeq) return; // navigated away or closed mid-load
  sheetBodyEl.replaceChildren();
  if (!result) {
    sheetBodyEl.append(el('p', 'sheet-loading',
      'Could not load the dictionary. Check your connection and tap the word again.'));
    return;
  }
  if (!result.matches?.length) {
    sheetBodyEl.append(el('p', 'sheet-loading', 'No dictionary entry found.'));
    return;
  }

  const entries = el('div', 'sheet-entries');
  for (const match of result.matches) {
    for (const entry of match.entries) entries.append(entryBlock(entry));
  }
  sheetBodyEl.append(entries);

  if (result.examples?.length) {
    const wrap = section('Example sentences');
    const forms = [result.exampleWord?.simp, result.exampleWord?.trad];
    for (const ex of result.examples) wrap.append(exampleBlock(ex, forms));
    sheetBodyEl.append(wrap);
  }

  if (result.chars?.length) {
    const wrap = section('Characters');
    for (const character of result.chars) {
      const row = charRow(character);
      if (row) wrap.append(row);
    }
    sheetBodyEl.append(wrap);
  }

  if (result.related?.length) {
    const wrap = section('Related words');
    for (const entry of result.related) wrap.append(relatedRow(entry));
    sheetBodyEl.append(wrap);
  }
  sheetBodyEl.scrollTop = 0;
}
