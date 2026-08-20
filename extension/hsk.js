// HSK study guides: one reviewable guide per level, every Chinese character
// hoverable for the universal definition popup, with a tutor in the sidebar
// you can point at a highlighted passage.
//
// Readings are never stored in the guide data — the service worker annotates
// every Chinese string with the same `sentencePinyin` used for the bundled
// example corpus, so the page and the popup can never disagree about a
// reading. Questions go to the sync Worker's /api/ask with the same private
// pairing token as sync and the news digest.

import { HSK_GUIDES, BANDS, guideByLevel, chineseStrings } from './guides/index.js';
import { splitSentences } from './lib/cards.js';
import { createLookup } from './lib/lookup.js';
import { createTutor } from './lib/tutor.js';
import { mountShell } from './lib/shell.js';
import {
  convertDeep, forms, getHanziPref, isTradFirst, onHanziPref,
} from './lib/hanzi.js';
import {
  HSK_LEVEL_COUNTS, cumulativeHskCount, hskLevelKey, hskPracticeHref,
  loadHskVocabulary, searchableHskText, vocabularyForLevel,
} from './lib/hsk-vocab.js';

const { saver, createSelectionBar } = globalThis.ZhongwenSaveCard;

mountShell({ active: 'guides' });

const railEl = document.getElementById('rail');
const guideEl = document.getElementById('guide');

// A study guide is reference material, never a test, so hovering always
// defines — the same popup you get on any web page.
//
// The one exception is while the selection bar is up: the popup anchors just
// below the line under the cursor, which is exactly where that bar sits, so
// travelling to it would open the popup on top of it. Reading and
// pointing-at-something are different modes; hovering resumes the moment the
// selection is resolved either way.
const lookup = createLookup({
  getEnabled: () => !tutor.isPointing(),
  hoverTitle: 'Hover for definition, examples, and related words',
});

// Highlighting anywhere in a guide raises the shared bar: ☆ Save for the
// highlighted phrase or sentence, and the tutor's "Ask about this" beside it.
// The per-item stars below cover what the guide already knows to be a card;
// this covers everything else the learner's eye lands on.
const selectionBar = createSelectionBar({ root: () => guideEl, lookup });
const cards = saver();

// A guide is dense, so the stars stay out of the way until the row is hovered
// (.zwe-savable) — except where they are already lit, which is the point: at a
// glance you can see what of this level is in your deck.
function saveStar(item, describe) {
  return cards.control(item, {
    label: '☆',
    savedLabel: '✓',
    title: 'Save for spaced repetition',
    savedTitle: 'In your vocab list — click to remove',
    describe,
  });
}

let guide = null;            // the level currently on screen, already converted
let currentLevel = null;     // its number, so a script flip can re-render it
let hanziPref = 'simp-first';
let readings = new Map();    // Chinese string -> pinyin, per guide
let showPassagePinyin = false;
let showPassageEnglish = false;
let renderSeq = 0;           // guards async renders against fast level switching
let hskVocabulary = [];      // the complete 11,092-row standard list
let hskVocabularyError = '';
let vocabScope = 'level';
let vocabQuery = '';
let vocabPage = 0;

const VOCAB_PAGE_SIZE = 100;
const HAS_CHINESE = /[\u3400-\u9fff\uf900-\ufaff]/;
const embedded = new URLSearchParams(location.search).has('embedded');

function el(tag, className, text) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}

// Titles and English prose in the guides often carry the exact Chinese item
// they are explaining ("Identity sentences with 是", for example). Rendering
// those strings as plain text made the most useful part of the title the one
// thing that would not highlight under the pointer.
function hoverText(tag, className, text) {
  return HAS_CHINESE.test(String(text || ''))
    ? lookup.hoverable(tag, className, text)
    : el(tag, className, text);
}

function speakButton(text, title) {
  const b = el('button', 'speak', '🔊');
  b.type = 'button';
  b.title = title || 'Play Mandarin pronunciation';
  b.setAttribute('aria-label', `Play pronunciation for ${text}`);
  b.addEventListener('click', (event) => {
    event.stopPropagation();
    chrome.runtime.sendMessage({ type: 'speak', text }).catch(() => {});
  });
  return b;
}

// ---------------------------------------------------------------------------
// Pinyin: one batched request per guide, then a plain lookup while rendering.
// ---------------------------------------------------------------------------

async function loadReadings(texts) {
  const unique = [...new Set(texts.filter(Boolean))];
  const map = new Map();
  const r = await chrome.runtime.sendMessage({ type: 'pinyinBatch', texts: unique })
    .catch(() => null);
  (r?.pinyin || []).forEach((py, i) => { if (py) map.set(unique[i], py); });
  return map;
}

const py = (text) => readings.get(text) || '';

// ---------------------------------------------------------------------------
// Level rail
// ---------------------------------------------------------------------------

function renderRail(activeLevel) {
  railEl.replaceChildren();
  for (const band of BANDS) {
    const box = el('div', 'band');
    box.append(el('div', 'band-name', `${band.name} · ${band.label}`));
    for (const level of band.levels) {
      const g = guideByLevel(level);
      const btn = el('button', `lvl${level === activeLevel ? ' active' : ''}`);
      btn.type = 'button';
      btn.append(g.name, el('small', null, `${g.stats.totalWords.toLocaleString()} words`));
      btn.setAttribute('aria-current', level === activeLevel ? 'true' : 'false');
      btn.addEventListener('click', () => selectLevel(level));
      box.append(btn);
    }
    if (band.note) box.append(el('div', 'band-note', band.note));
    railEl.append(box);
  }
}

// ---------------------------------------------------------------------------
// Guide body. Every section carries data-section so a question can say which
// part of the guide the learner was reading.
// ---------------------------------------------------------------------------

function section(title) {
  const s = document.createElement('section');
  s.dataset.section = title;
  s.append(el('h3', null, title));
  return s;
}

function statBlock(value, label) {
  const box = el('div', 'stat');
  box.append(el('b', null, value), el('span', null, label));
  return box;
}

function renderHead(g) {
  const head = el('div', 'guide-head');
  head.append(el('h2', null, g.name), el('span', 'badge', g.band));
  guideEl.append(head);
  guideEl.append(el('p', 'tagline', g.tagline));

  const stats = el('div', 'stats');
  stats.append(
    statBlock(g.stats.totalWords.toLocaleString(), 'words cumulative'),
    statBlock(`+${g.stats.newWords.toLocaleString()}`, 'new at this level'),
    statBlock(g.stats.totalChars.toLocaleString(), 'characters'),
    statBlock(String(g.stats.grammarPoints), 'grammar points'),
    statBlock(g.stats.studyHours, 'typical study time'),
  );
  guideEl.append(stats);

  const levelKey = hskLevelKey(g.level);
  const levelCount = HSK_LEVEL_COUNTS[levelKey];
  const totalCount = cumulativeHskCount(g.level);
  const sets = el('div', 'set-actions');
  sets.append(el('strong', null, 'Practice this vocabulary as flashcards'));
  const buttons = el('div', 'set-buttons');

  function practice(label, scope, primary = false) {
    const link = el('a', `practice${primary ? ' primary' : ''}`, label);
    link.href = hskPracticeHref(g.level, scope);
    if (embedded) {
      link.addEventListener('click', (event) => {
        event.preventDefault();
        parent.postMessage({
          type: 'zx-open',
          view: 'review',
          url: hskPracticeHref(g.level, scope, { embedded: true }),
        }, '*');
      });
    }
    return link;
  }

  const levelLabel = levelKey === '7-9'
    ? `Practice ${levelCount.toLocaleString()} shared HSK 7–9 words`
    : g.level === 1
      ? `Practice all ${levelCount.toLocaleString()} HSK 1 words`
      : `Practice ${levelCount.toLocaleString()} new HSK ${g.level} words`;
  buttons.append(practice(levelLabel, 'level', true));
  if (totalCount !== levelCount) {
    const through = levelKey === '7-9' ? 'HSK 1–9' : `HSK 1–${g.level}`;
    buttons.append(practice(
      `Practice all ${totalCount.toLocaleString()} through ${through}`,
      'cumulative',
    ));
  }
  sets.append(buttons, el('p', 'set-note',
    'HSK sets stay out of your saved library unless you add a word there. The word keeps one review schedule wherever it appears.'));
  guideEl.append(sets);
}

function renderGrammar(g) {
  const s = section('Grammar');
  for (const point of g.grammar) {
    const box = el('div', 'point');
    const head = el('div', 'point-head');
    head.append(hoverText('span', 'point-name', point.point));
    head.append(lookup.hoverable('span', 'formula', point.formula));
    box.append(head);
    box.append(hoverText('p', 'explain', point.explain));
    for (const ex of point.examples) {
      const eg = el('div', 'eg zwe-savable');
      const zh = lookup.hoverable('div', 'zh', ex.zh);
      zh.append(speakButton(ex.zh, `Play ${ex.zh}`));
      // The guide has a translation for this one, so the card gets a real
      // English back rather than a word-by-word gloss — and `unit` says the
      // example is one item even where it took two sentences to show the
      // pattern.
      zh.append(saveStar({ text: ex.zh, en: ex.en, unit: true }, ex.zh));
      eg.append(zh);
      if (py(ex.zh)) eg.append(el('div', 'py', py(ex.zh)));
      eg.append(el('div', 'en', ex.en));
      box.append(eg);
    }
    s.append(box);
  }
  guideEl.append(s);
}

function renderVocab(g) {
  const s = section('Core vocabulary');
  for (const group of g.vocab) {
    s.append(hoverText('div', 'theme-name', group.theme));
    const words = el('div', 'words');
    for (const w of group.words) {
      const box = el('div', 'word zwe-savable');
      const zh = lookup.hoverable('div', 'zh', w.zh);
      zh.append(speakButton(w.zh, `Play ${w.zh}`));
      zh.append(saveStar({ text: w.zh }, w.zh));
      box.append(zh);
      if (py(w.zh)) box.append(el('div', 'py', py(w.zh)));
      box.append(el('div', 'en', w.en));
      words.append(box);
    }
    s.append(words);
  }
  guideEl.append(s);
}

function renderFullVocabulary(g) {
  const s = section('Complete vocabulary list');
  const box = el('div', 'full-vocab');
  if (hskVocabularyError) {
    box.append(el('p', 'vocab-empty',
      'The complete vocabulary list could not be loaded. Reload the extension and try again.'));
    s.append(box);
    guideEl.append(s);
    return;
  }

  const key = hskLevelKey(g.level);
  const levelCount = HSK_LEVEL_COUNTS[key];
  const totalCount = cumulativeHskCount(g.level);
  const shared = key === '7-9';
  box.append(el('p', 'vocab-intro', shared
    ? 'The standard publishes one shared vocabulary band for HSK 7–9, not separate level 7, 8, and 9 word lists. Search it here or switch to the complete cumulative list.'
    : `This is the full 2021-standard list: ${levelCount.toLocaleString()} words introduced at HSK ${g.level}. Switch to cumulative to include every earlier level too.`));

  const tools = el('div', 'vocab-tools');
  const tabs = el('div', 'vocab-tabs');
  const levelTab = el('button', null, shared
    ? `Shared HSK 7–9 · ${levelCount.toLocaleString()}`
    : `New at HSK ${g.level} · ${levelCount.toLocaleString()}`);
  levelTab.type = 'button';
  levelTab.setAttribute('aria-pressed', 'false');
  tabs.append(levelTab);

  let cumulativeTab = null;
  if (totalCount !== levelCount) {
    cumulativeTab = el('button', null,
      `Cumulative · ${totalCount.toLocaleString()}`);
    cumulativeTab.type = 'button';
    cumulativeTab.setAttribute('aria-pressed', 'false');
    tabs.append(cumulativeTab);
  } else {
    vocabScope = 'level';
  }

  const search = el('input', 'vocab-search');
  search.type = 'search';
  search.placeholder = 'Search hanzi, pinyin, part of speech, or definition';
  search.setAttribute('aria-label', `Search HSK ${g.level} vocabulary`);
  search.value = vocabQuery;
  tools.append(tabs, search);

  const meta = el('p', 'vocab-meta');
  meta.setAttribute('aria-live', 'polite');
  const scroll = el('div', 'vocab-scroll');
  const pages = el('div', 'vocab-pages');
  box.append(tools, meta, scroll, pages);

  function renderRows() {
    const source = vocabularyForLevel(hskVocabulary, g.level, vocabScope);
    const needle = vocabQuery.trim().toLocaleLowerCase();
    const filtered = needle
      ? source.filter((word) => searchableHskText(word).includes(needle))
      : source;
    const pageCount = Math.max(1, Math.ceil(filtered.length / VOCAB_PAGE_SIZE));
    vocabPage = Math.min(vocabPage, pageCount - 1);
    const start = vocabPage * VOCAB_PAGE_SIZE;
    const shown = filtered.slice(start, start + VOCAB_PAGE_SIZE);

    levelTab.classList.toggle('active', vocabScope === 'level');
    levelTab.setAttribute('aria-pressed', String(vocabScope === 'level'));
    if (cumulativeTab) {
      cumulativeTab.classList.toggle('active', vocabScope === 'cumulative');
      cumulativeTab.setAttribute('aria-pressed', String(vocabScope === 'cumulative'));
    }

    if (!filtered.length) {
      meta.textContent = `No matches in ${source.length.toLocaleString()} vocabulary items`;
      scroll.replaceChildren(el('div', 'vocab-empty', `No HSK words match “${vocabQuery}”.`));
      pages.replaceChildren();
      return;
    }
    meta.textContent = `Showing ${(start + 1).toLocaleString()}–${(start + shown.length).toLocaleString()} of ${filtered.length.toLocaleString()}${needle ? ` matches (${source.length.toLocaleString()} in this set)` : ''}`;

    const table = el('table', 'vocab-table');
    const thead = document.createElement('thead');
    const hr = document.createElement('tr');
    for (const label of ['No.', 'Word', 'Pinyin', 'Type', 'Definition']) {
      hr.append(el('th', null, label));
    }
    thead.append(hr);
    const tbody = document.createElement('tbody');
    for (const word of shown) {
      const tr = document.createElement('tr');
      tr.append(el('td', 'vocab-no', word.id.slice(1).replace('-', ' · ')));

      const wordCell = document.createElement('td');
      const face = forms(word, hanziPref);
      const head = el('div', 'vocab-head');
      head.append(lookup.hoverable('span', 'vocab-hanzi', face.primary));
      if (face.secondary) head.append(lookup.hoverable('span', 'vocab-alt', face.secondary));
      head.append(speakButton(face.primary, `Play ${face.primary}`));
      wordCell.append(head);
      const notation = isTradFirst(hanziPref) ? word.notationTrad : word.notationSimp;
      if (notation && notation !== face.primary && notation !== face.secondary) {
        const listed = hoverText('span', 'vocab-listed',
          `listed as ${notation.replaceAll('|', ' / ')}`);
        wordCell.append(listed);
      }
      tr.append(wordCell);
      tr.append(el('td', 'vocab-py', word.pinyin));
      tr.append(el('td', 'vocab-pos', word.pos || '—'));
      tr.append(hoverText('td', 'vocab-def', word.defs));
      tbody.append(tr);
    }
    table.append(thead, tbody);
    scroll.replaceChildren(table);

    pages.replaceChildren();
    if (pageCount > 1) {
      const previous = el('button', null, '← Previous');
      previous.type = 'button';
      previous.disabled = vocabPage === 0;
      previous.addEventListener('click', () => {
        vocabPage--;
        renderRows();
        box.scrollIntoView({ block: 'start' });
      });
      const status = el('span', null, `Page ${vocabPage + 1} of ${pageCount}`);
      const next = el('button', null, 'Next →');
      next.type = 'button';
      next.disabled = vocabPage === pageCount - 1;
      next.addEventListener('click', () => {
        vocabPage++;
        renderRows();
        box.scrollIntoView({ block: 'start' });
      });
      pages.append(previous, status, next);
    }
  }

  levelTab.addEventListener('click', () => {
    vocabScope = 'level';
    vocabPage = 0;
    renderRows();
  });
  cumulativeTab?.addEventListener('click', () => {
    vocabScope = 'cumulative';
    vocabPage = 0;
    renderRows();
  });
  search.addEventListener('input', () => {
    vocabQuery = search.value;
    vocabPage = 0;
    renderRows();
  });

  renderRows();
  s.append(box);
  guideEl.append(s);
}

function renderPassage(g) {
  const s = section('Reading practice');
  const box = el('div', 'passage');
  const title = lookup.hoverable('div', 'passage-title zwe-savable', g.passage.title);
  title.append(speakButton(g.passage.title, `Play ${g.passage.title}`));
  title.append(saveStar({ text: g.passage.title }, g.passage.title));
  box.append(title);
  if (py(g.passage.title)) box.append(el('div', 'passage-title-py', py(g.passage.title)));

  // One speaker per paragraph rather than one for the passage: the TTS
  // message caps at 300 characters, and a passage runs longer than that.
  //
  // Saving, though, is per sentence. A paragraph is not a flashcard, and the
  // sentence is the unit a learner actually wants to be able to produce, so
  // each one gets its own star while the paragraph stays one block of prose.
  for (const para of g.passage.text.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean)) {
    const p = el('p');
    for (const sentence of splitSentences(para)) {
      const holder = el('span', 'sent zwe-savable');
      holder.append(lookup.hoverable('span', null, sentence));
      holder.append(saveStar({ text: sentence }, sentence));
      p.append(holder);
    }
    p.append(speakButton(para, 'Read this paragraph'));
    box.append(p);
    if (showPassagePinyin && py(para)) box.append(el('div', 'py', py(para)));
  }
  if (showPassageEnglish) box.append(el('div', 'translation', g.passage.en));

  const toggles = el('div', 'toggles');
  const pinyinBtn = el('button', null, showPassagePinyin ? 'Hide pinyin' : 'Show pinyin');
  pinyinBtn.type = 'button';
  pinyinBtn.addEventListener('click', () => {
    showPassagePinyin = !showPassagePinyin;
    renderGuideBody();
  });
  const englishBtn = el('button', null, showPassageEnglish ? 'Hide translation' : 'Show translation');
  englishBtn.type = 'button';
  englishBtn.addEventListener('click', () => {
    showPassageEnglish = !showPassageEnglish;
    renderGuideBody();
  });
  toggles.append(pinyinBtn, englishBtn);
  box.append(toggles);
  s.append(box);
  guideEl.append(s);
}

function renderList(title, items) {
  const s = section(title);
  const ul = el('ul', 'plain');
  for (const item of items) ul.append(hoverText('li', null, item));
  s.append(ul);
  guideEl.append(s);
}

function renderPitfalls(g) {
  const s = section('Common mistakes');
  for (const p of g.pitfalls) {
    const box = el('div', 'pitfall');
    box.append(hoverText('b', null, p.title), hoverText('p', null, p.detail));
    s.append(box);
  }
  guideEl.append(s);
}

function renderExam(g) {
  const s = section('The exam');
  const box = el('div', 'exam');
  box.append(hoverText('p', null, g.exam.format), hoverText('p', null, g.exam.tips));
  s.append(box);
  guideEl.append(s);
}

function renderGuideBody() {
  const g = guide;
  lookup.hide();
  selectionBar.hide(); // its range points into the DOM we are about to replace
  // The pinyin/translation toggles re-render in place; keep the reader where
  // they were instead of throwing them back to the top of the guide.
  const scrollTop = guideEl.scrollTop;
  guideEl.replaceChildren();
  renderHead(g);
  const overview = section('Overview');
  overview.append(hoverText('p', 'overview', g.overview));
  guideEl.append(overview);
  renderList('What you can do at this level', g.canDo);
  renderGrammar(g);
  renderVocab(g);
  renderFullVocabulary(g);
  renderPassage(g);
  renderPitfalls(g);
  renderList('How to study this level', g.tips);
  renderExam(g);
  guideEl.scrollTop = scrollTop;
}

async function selectLevel(level) {
  const seq = ++renderSeq;
  const source = guideByLevel(level);
  if (!source) return;
  currentLevel = level;
  showPassagePinyin = false;
  showPassageEnglish = false;
  vocabScope = 'level';
  vocabQuery = '';
  vocabPage = 0;
  renderRail(level);
  guideEl.replaceChildren(el('p', 'empty', 'Loading…'));
  // Guides are written in simplified. Convert the whole object up front rather
  // than at each place it prints a character: once the text is in per-character
  // spans there is no word left to segment, and 发 becomes a guess.
  const vocabularyPromise = loadHskVocabulary()
    .then((words) => ({ words, error: '' }))
    .catch((error) => ({ words: [], error: String(error?.message || error) }));
  const next = await convertDeep(source, hanziPref);
  if (seq !== renderSeq) return;
  guide = next;
  const [map, vocabulary] = await Promise.all([
    loadReadings(chineseStrings(next)),
    vocabularyPromise,
  ]);
  if (seq !== renderSeq) return; // the learner switched level while we waited
  readings = map;
  hskVocabulary = vocabulary.words;
  hskVocabularyError = vocabulary.error;
  renderGuideBody();
  guideEl.scrollTop = 0;
  await chrome.storage.local.set({ hskLevel: level });
  if (seq !== renderSeq) return;
  // Switching level drops any quote left pointing at the guide that just went
  // away.
  tutor.setThread();
}

// The whole guide is Chinese, so flipping the script re-renders it. Readings
// are re-derived too: pinyin is per character, and the characters changed.
onHanziPref(async (pref) => {
  hanziPref = pref;
  if (currentLevel) await selectLevel(currentLevel);
});

// ---------------------------------------------------------------------------
// The tutor sidebar (lib/tutor.js). It owns highlight-to-ask, the chat, and
// the call to /api/ask; this page only says what the learner is looking at.
// ---------------------------------------------------------------------------

// The whole section around a selection, so the tutor can see what the
// highlighted fragment belongs to.
function sectionContextFor(node) {
  const start = node.nodeType === Node.TEXT_NODE ? node.parentElement : node;
  const host = start?.closest?.('section[data-section]');
  if (!host) return { section: '', text: '' };
  return {
    section: host.dataset.section,
    text: host.textContent.replace(/\s+/g, ' ').trim().slice(0, 4000),
  };
}

const tutor = createTutor({
  lookup,
  subtitle: 'Highlight any part of the guide to ask about it',
  selectionBar,
  sectionFor: sectionContextFor,
  context: () => ({ level: guide?.level, where: `the HSK ${guide?.level} study guide` }),
  intro: () => `Ask anything about the HSK ${guide?.level} guide. Highlight a sentence, `
    + 'a grammar box, or a word first and the answer will be about that exact text.',
  starters: () => {
    const [first, second] = guide?.grammar || [];
    return [
      first && `Explain ${first.point} with one more example.`,
      second && `When would I use ${second.point} instead of just saying it plainly?`,
      'Translate the reading passage sentence by sentence and point out anything tricky.',
      'Quiz me on five words from this level.',
    ].filter(Boolean).slice(0, 4);
  },
});


// ---------------------------------------------------------------------------

async function init() {
  hanziPref = await getHanziPref();
  const { hskLevel } = await chrome.storage.local.get('hskLevel');
  const requestedLevel = Number(location.hash.slice(1));
  const level = HSK_GUIDES.some((g) => g.level === requestedLevel)
    ? requestedLevel
    : HSK_GUIDES.some((g) => g.level === hskLevel) ? hskLevel : 1;
  await selectLevel(level);
}

init();
