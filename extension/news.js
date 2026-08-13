// Personalized Mandarin news, and everything it has already written you.
//
// Builds a learner profile from the saved wordlist (recently studied +
// struggling words + skill stats) and asks the sync Worker's /api/news endpoint
// to search current news and write a short passage from it. There are three
// ways in, and they all end at the same endpoint: the Generate button (topics
// inferred from your deck), a category chip (suggested by the model and
// labelled in Chinese, the way a Chinese news site labels its sections), or
// anything typed into the search box — a topic, a phrase, a question, in
// either language.
//
// Every article is kept. `newsHistory` in chrome.storage.local is a small
// archive, newest first, so generating one no longer destroys the last: Past
// articles lists them under the day they were written and any of them can be
// reopened. Generation is still button-triggered, so opening a new tab never
// spends model credits on its own — and neither does the categories call, which
// is why the chips start as one "Suggest topics" button and are then cached for
// a week.

import { buildProfile } from './lib/profile.js';
import { DEFAULT_SERVER_URL, getSyncMeta, newToken } from './lib/sync.js';
import { postAi } from './lib/aistatus.js';
import { createLookup } from './lib/lookup.js';
import { createTutor } from './lib/tutor.js';
import { mountShell } from './lib/shell.js';
import { convertDeep, getHanziPref, onHanziPref } from './lib/hanzi.js';

const { createSelectionBar } = globalThis.ZhongwenSaveCard;

const MIN_WORDS = 5;
// Roughly two months of a daily habit. A digest is a couple of kilobytes, so
// the whole archive is smaller than one saved web page.
const MAX_HISTORY = 60;
// Suggested categories follow the deck, which moves slowly. A week is long
// enough that the chips cost about one model call a month.
const CATEGORY_TTL_MS = 7 * 24 * 60 * 60 * 1000;

mountShell({ active: 'news' });

const appEl = document.getElementById('app');
const statusEl = document.getElementById('status');
const searchForm = document.getElementById('searchForm');
const searchEl = document.getElementById('search');
const generateBtn = document.getElementById('generate');
const catsEl = document.getElementById('cats');
const historyBtn = document.getElementById('history');
const englishBtn = document.getElementById('english');
const difficultyLabel = document.getElementById('difficultyLabel');
const difficultyEl = document.getElementById('difficulty');

// Hover any hanzi in the passage for the same phrase-aware definition popup you
// get on a web page (definitions, examples, characters, related words, save).
const lookup = createLookup({
  getEnabled: () => !tutor.isPointing(),
  hoverTitle: 'Hover for definition, examples, and related words',
});

// Highlighting any phrase or sentence of the passage raises the shared bar:
// save it as a card, or ask the tutor about it.
const selectionBar = createSelectionBar({ root: () => appEl, lookup });

// The same tutor as the study guides and the review card, as a drawer.
// Highlight any run of the passage and ask what it means or why it is phrased
// that way.
let digest = null; // the digest currently rendered, for the tutor's context

const tutor = createTutor({
  lookup,
  subtitle: 'Highlight any part of the article to ask about it',
  selectionBar,
  sectionFor: () => ({
    section: 'News passage',
    text: [digest?.title, digest?.article].filter(Boolean).join('\n\n').slice(0, 4000),
  }),
  context: () => ({
    where: 'a short Mandarin news passage written for their level',
    section: 'News passage',
    text: [digest?.title, digest?.article].filter(Boolean).join('\n\n').slice(0, 4000),
  }),
  startAvailable: false, // nothing to ask about until a digest exists
  intro: () => 'Ask about anything in the passage — a word you half-recognise, a '
    + 'sentence that will not parse, or why the writer chose one phrasing over '
    + 'another. Highlight it first and the answer will be about that exact text.',
  starters: () => [
    'Which words here are above my level, and what do they mean?',
    'Break the first paragraph down sentence by sentence.',
    'What grammar patterns should I notice in this passage?',
  ],
});

let hanziPref = 'simp-first';
// The archive, newest first. Entries are { id, generatedAt, data }, and `data`
// is the digest as the model wrote it — always simplified, so flipping the
// script re-converts from the original rather than converting a conversion.
let history = [];
let current = null; // the entry on screen, or null in the empty and list states
let listing = false; // Past articles is open
let categories = []; // as suggested (simplified): the source for a request
let shownCategories = []; // the same, converted for whichever script is on
let englishShown = false;
let busy = false;
let difficulty = 'normal'; // 'easier' | 'normal' | 'harder', persisted below

function el(tag, className, text) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}

function fmtAgo(ts) {
  const mins = Math.round((Date.now() - ts) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  return hours < 48 ? `${hours}h ago` : `${Math.round(hours / 24)}d ago`;
}

const startOfDay = (ts) => new Date(ts).setHours(0, 0, 0, 0);

// The archive is read by day, so a row carries the clock time and its heading
// carries the day — "2:15 PM" under "Today", not a date stamp on every line.
const fmtClock = (ts) => new Date(ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

function dayLabel(ts) {
  const days = Math.round((startOfDay(Date.now()) - startOfDay(ts)) / 86400000);
  if (days <= 0) return 'Today';
  if (days === 1) return 'Yesterday';
  const sameYear = new Date(ts).getFullYear() === new Date().getFullYear();
  return new Date(ts).toLocaleDateString([], {
    weekday: 'long', month: 'long', day: 'numeric', ...(sameYear ? {} : { year: 'numeric' }),
  });
}

// "3h ago" is what you want to hear about this morning's article, and nothing
// at all about one from last week.
function fmtWhen(ts) {
  return Date.now() - ts < 24 * 60 * 60 * 1000 ? fmtAgo(ts) : `${dayLabel(ts)}, ${fmtClock(ts)}`;
}

function speak(text) {
  if (!text) return;
  chrome.runtime.sendMessage({ type: 'speak', text }).catch(() => {});
}

function speakButton(text, title) {
  const b = el('button', 'speak', '🔊');
  b.type = 'button';
  b.title = title || 'Play';
  b.addEventListener('click', () => speak(text));
  return b;
}

// --- the toolbar -----------------------------------------------------------

// Which controls belong on screen. One function, because there are six of them
// and four states, and hiding them one at a time is how they drift apart.
//
//   article   a passage is open
//   empty     set up and ready, nothing generated yet
//   list      Past articles
//   blocked   too few words, or sync not enabled — nothing to drive
function toolbar(state) {
  const usable = state !== 'blocked';
  listing = state === 'list';
  searchForm.hidden = !usable;
  catsEl.hidden = !usable;
  difficultyLabel.hidden = !usable;
  generateBtn.textContent = state === 'article' ? '↻ New article' : "Generate today's news";
  generateBtn.title = state === 'article'
    ? 'Write another one from your deck — this article is kept in Past articles'
    : '';
  englishBtn.hidden = !(state === 'article' && current?.data.englishSummary);
  historyBtn.hidden = !usable || !history.length;
  historyBtn.textContent = listing ? '← Back to the article' : `Past articles (${history.length})`;
}

function setBusy(on) {
  busy = on;
  searchEl.disabled = on;
  generateBtn.disabled = on;
  historyBtn.disabled = on;
  for (const b of catsEl.querySelectorAll('button')) b.disabled = on;
}

// --- the archive -----------------------------------------------------------

async function readHistory() {
  const { newsHistory, newsDigest } = await chrome.storage.local.get(['newsHistory', 'newsDigest']);
  if (Array.isArray(newsHistory)) return newsHistory;
  // Before this page kept an archive there was exactly one digest in storage.
  // Promote it, so upgrading does not look like losing your last article.
  if (newsDigest?.data) {
    const migrated = [{
      id: String(newsDigest.fetchedAt),
      generatedAt: newsDigest.fetchedAt,
      data: newsDigest.data,
    }];
    await chrome.storage.local.set({ newsHistory: migrated });
    await chrome.storage.local.remove('newsDigest');
    return migrated;
  }
  return [];
}

// The Worker answers a repeat of the same request inside its anti-spam floor
// with the article it already wrote, stamped with the time it was written.
// Keying on that stamp is what stops a double-click filing one passage twice.
async function remember(entry) {
  history = [entry, ...history.filter((e) => e.id !== entry.id)]
    .sort((a, b) => b.generatedAt - a.generatedAt)
    .slice(0, MAX_HISTORY);
  await chrome.storage.local.set({ newsHistory: history });
}

// --- reading an article ----------------------------------------------------

async function show(entry) {
  current = entry;
  paint(await convertDeep(entry.data, hanziPref), entry.generatedAt);
}

function paint(data, generatedAt) {
  lookup.hide();
  selectionBar.hide(); // its range points into the passage we are replacing
  appEl.replaceChildren();
  englishShown = false;
  // Each digest gets its own conversation; a new passage starts a new one.
  digest = data;
  tutor.setAvailable(true);
  tutor.setThread();

  const chips = el('div', 'chips');
  // What was asked for leads the row, marked as the request rather than as one
  // more theme the model inferred — and skipped below, so it prints once.
  const asked = data.topic?.label || '';
  if (asked) chips.append(lookup.hoverable('span', 'chip asked', asked));
  if (data.level) chips.append(el('span', 'chip level', data.level));
  if (data.targetHsk) chips.append(el('span', 'chip', `reading at HSK ${data.targetHsk}`));
  // Topics come back in Chinese as often as not, so they are hoverable too.
  for (const topic of data.topics || []) {
    if (topic !== asked) chips.append(lookup.hoverable('span', 'chip', topic));
  }
  if (chips.childElementCount) appEl.append(chips);

  if (data.title) {
    const head = el('div', 'headline');
    head.append(lookup.hoverable('h2', null, data.title));
    head.append(speakButton(paragraphs(data).join('\n'), 'Read the whole passage'));
    appEl.append(head);
    if (data.titlePinyin) appEl.append(el('div', 'title-pinyin', data.titlePinyin));
  }

  const article = el('div', 'article');
  for (const para of paragraphs(data)) article.append(lookup.hoverable('p', null, para));
  appEl.append(article);

  if ((data.glossary || []).length) {
    const section = el('div', 'section');
    const head = el('div', 'section-head');
    head.append(el('h3', null, 'Stretch vocabulary'));
    section.append(head);
    for (const g of data.glossary) {
      const row = el('div', 'gloss-row');
      // The stretch words are the hardest Chinese on the page and the most
      // worth looking up, so they get the same popup the passage does — they
      // were the one run of hanzi here rendered as plain text.
      row.append(lookup.hoverable('div', 'gloss-word', g.word));
      row.append(el('div', 'gloss-pinyin', g.pinyin || ''));
      row.append(speakButton(g.word, `Play ${g.word}`));
      row.append(el('div', 'gloss-meaning', g.meaning || ''));
      section.append(row);
    }
    appEl.append(section);
  }

  if (data.sources && data.sources.length) {
    const section = el('div', 'section sources');
    const head = el('div', 'section-head');
    head.append(el('h3', null, 'Based on'));
    section.append(head);
    const list = el('ul');
    for (const s of data.sources) {
      const li = el('li');
      const a = el('a', null, s.title || s.url);
      a.href = s.url; a.target = '_blank'; a.rel = 'noopener noreferrer';
      li.append(a);
      list.append(li);
    }
    section.append(list);
    appEl.append(section);
  }

  englishBtn.textContent = 'Show English';
  toolbar('article');
  paintCategories(); // the chip for the topic this article answers lights up
  statusEl.textContent = generatedAt ? `Generated ${fmtWhen(generatedAt)}` : '';
}

function paragraphs(data) {
  return (data.article || '').split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
}

function toggleEnglish(data) {
  englishShown = !englishShown;
  const existing = appEl.querySelector('.summary-box');
  if (existing) existing.remove();
  englishBtn.textContent = englishShown ? 'Hide English' : 'Show English';
  if (englishShown) {
    const box = el('div', 'summary-box', data.englishSummary);
    // Place the summary right after the article.
    const article = appEl.querySelector('.article');
    article.insertAdjacentElement('afterend', box);
  }
}

// --- past articles ---------------------------------------------------------

async function paintHistory() {
  lookup.hide();
  selectionBar.hide();
  // Headlines and topics are Chinese, and this page is read in either script.
  // One round trip for the whole list, the same as an article gets.
  const labels = await convertDeep(
    history.map((e) => ({ title: e.data.title || '', topic: e.data.topic?.label || '' })),
    hanziPref,
  );
  appEl.replaceChildren();
  const list = el('div', 'history');
  let day = '';
  history.forEach((entry, i) => {
    const label = dayLabel(entry.generatedAt);
    if (label !== day) { list.append(el('div', 'day', label)); day = label; }
    const row = el('button', 'past');
    row.type = 'button';
    if (entry.id === current?.id) row.classList.add('current');
    row.append(el('span', 'past-time', fmtClock(entry.generatedAt)));
    const body = el('div', 'past-body');
    // A headline is Chinese like everything else here, so it answers the
    // pointer like everything else here — you can read the list without
    // opening every article in it.
    body.append(lookup.hoverable('div', 'past-title', labels[i].title || 'Untitled passage'));
    const meta = el('div', 'past-meta');
    if (labels[i].topic) meta.append(el('span', 'chip asked', labels[i].topic));
    if (entry.data.targetHsk) meta.append(el('span', 'chip', `HSK ${entry.data.targetHsk}`));
    if (meta.childElementCount) body.append(meta);
    row.append(body);
    row.addEventListener('click', () => show(entry));
    list.append(row);
  });
  appEl.append(list);
  toolbar('list');
  statusEl.textContent = `${history.length} ${history.length === 1 ? 'article' : 'articles'}, kept in this browser`;
}

// --- suggested categories --------------------------------------------------

function paintCategories() {
  catsEl.replaceChildren();
  const asked = current?.data.topic?.label || '';
  if (!shownCategories.length) {
    // Suggesting them is a model call, so it waits for a click like everything
    // else on this page. After one click the chips are simply there for a week.
    const suggest = el('button', 'cat quiet', 'Suggest topics for me');
    suggest.type = 'button';
    suggest.title = 'Ask for news sections picked from the words you study';
    suggest.addEventListener('click', suggestCategories);
    catsEl.append(suggest);
    return;
  }
  for (const c of shownCategories) {
    const chip = el('button', 'cat');
    chip.type = 'button';
    chip.append(document.createTextNode(c.label));
    if (c.english) chip.append(el('span', 'cat-en', c.english));
    chip.title = [c.pinyin, c.english].filter(Boolean).join(' · ') || c.label;
    // `source` is the model's own simplified label; `c.label` may have been
    // converted for a traditional reader, and the search should not be.
    if (c.source === asked) chip.classList.add('active');
    chip.addEventListener('click', () => generate({
      topic: { label: c.source, query: c.query, english: c.english },
    }));
    catsEl.append(chip);
  }
  const again = el('button', 'cat quiet', '↻');
  again.type = 'button';
  again.title = 'Suggest a different set of topics';
  again.addEventListener('click', suggestCategories);
  catsEl.append(again);
  if (busy) setBusy(true); // the row was just rebuilt; keep it disabled
}

async function setCategories(items) {
  categories = items;
  // Each chip keeps the model's simplified label beside the converted one, so
  // clicking a traditional chip still searches in the model's own wording.
  shownCategories = (await convertDeep(items, hanziPref))
    .map((c, i) => ({ ...c, source: items[i].label, query: items[i].query }));
  paintCategories();
}

async function suggestCategories() {
  if (busy) return;
  setBusy(true);
  const before = statusEl.textContent;
  statusEl.textContent = 'Picking topics out of your deck…';
  try {
    const { wordlist = [] } = await chrome.storage.local.get('wordlist');
    const meta = await getSyncMeta();
    if (!meta?.token || !meta?.serverUrl) { showSetup(); return; }
    const data = await postAi(meta, '/api/news/categories', { profile: buildProfile(wordlist) });
    if (!data.categories?.length) throw new Error('no topics came back');
    await chrome.storage.local.set({
      newsCategories: { fetchedAt: Date.now(), items: data.categories },
    });
    await setCategories(data.categories);
    statusEl.textContent = before;
  } catch (err) {
    statusEl.textContent = `Could not suggest topics: ${err.message}`;
  } finally {
    setBusy(false);
  }
}

// --- generating ------------------------------------------------------------

// Always forced: the button means "write me one", and every article it writes
// is kept rather than replacing the last. The Worker still refuses to run the
// same request twice inside a minute, and hands back what it wrote if asked.
const postNews = (meta, profile, topic) =>
  postAi(meta, '/api/news', { profile, force: true, difficulty, topic: topic || null });

async function generate({ topic = null } = {}) {
  if (busy) return;
  setBusy(true);
  statusEl.textContent = topic
    ? `Reading the news on ${topic.label}… this can take up to a minute`
    : 'Reading the news and writing your passage… this can take up to a minute';
  try {
    const { wordlist = [] } = await chrome.storage.local.get('wordlist');
    const meta = await getSyncMeta();
    if (!meta || !meta.token || !meta.serverUrl) { showSetup(); return; }
    const data = await postNews(meta, buildProfile(wordlist), topic);
    const generatedAt = data.generatedAt || Date.now();
    const entry = { id: String(generatedAt), generatedAt, data };
    await remember(entry);
    await show(entry);
    if (data.stale) {
      statusEl.textContent = `Showing your last article (${fmtWhen(generatedAt)}) — the refresh failed, try again shortly`;
    } else if (data.cached) {
      statusEl.textContent = `Generated ${fmtWhen(generatedAt)} — a new article is limited to about one a minute`;
    }
  } catch (err) {
    // The archive is the fallback now: whatever went wrong, the articles you
    // already have are still here, and one of them goes back on screen.
    const message = `Could not write a new article: ${err.message}`;
    const fallback = current || history[0];
    if (fallback) {
      await show(fallback);
      statusEl.textContent = message;
    } else {
      appEl.replaceChildren(el('div', 'empty', `Could not generate your news: ${err.message}`));
      toolbar('empty');
      statusEl.textContent = '';
    }
  } finally {
    setBusy(false);
  }
}

// Reading news rides on the same capability token as phone sync. If the user
// never enabled sync, offer to create one right here. The second half of setup
// — an AI key — lives in Options, and the Worker's 503 names it, so this only
// has to get them past the token.
function showSetup() {
  appEl.replaceChildren();
  toolbar('blocked');
  statusEl.textContent = '';
  const box = el('div', 'setup');
  box.append(el('p', null,
    'Your personalized news is written by AI, matched to the words you study. '
    + 'Enabling it creates a private token — only word statistics (which words '
    + 'you study and struggle with) are ever sent, never page content or '
    + 'browsing history.'));
  box.append(el('p', null,
    'You will also need your own AI API key, pasted once into the extension\'s '
    + 'Options page. It pays for your digests and nobody else\'s.'));
  const btn = el('button', 'primary', 'Enable news');
  btn.type = 'button';
  btn.addEventListener('click', async () => {
    await chrome.storage.local.set({
      syncMeta: { token: newToken(), serverUrl: DEFAULT_SERVER_URL, cursor: 0, lastPushAt: 0 },
    });
    chrome.runtime.sendMessage({ type: 'syncNow' }).catch(() => {});
    load();
  });
  const options = el('button', 'starter', 'Open Options');
  options.type = 'button';
  options.addEventListener('click', () => chrome.runtime.openOptionsPage());
  box.append(btn, options);
  appEl.append(box);
}

function showEmpty() {
  const intro = el('div', 'empty');
  intro.append(el('p', null,
    'Get a short news passage in Chinese, built from what you\'re currently '
    + 'studying and matched to your level — or search for a topic, and the news '
    + 'you get back will be about that.'));
  appEl.replaceChildren(intro);
  toolbar('empty');
  paintCategories();
}

// A passage is nothing but Chinese, so flipping the script repaints it —
// converting the model's original again rather than converting what is on
// screen, which would be a conversion of a conversion. The chips and the list
// of past headlines are Chinese too, and flip with it.
onHanziPref(async (pref) => {
  hanziPref = pref;
  if (categories.length) await setCategories(categories);
  if (listing) await paintHistory();
  else if (current) await show(current);
});

async function load() {
  hanziPref = await getHanziPref();
  lookup.hide();
  // No passage yet means nothing to ask about; show() turns it back on.
  tutor.setAvailable(false);
  const { wordlist = [], newsCategories = null } =
    await chrome.storage.local.get(['wordlist', 'newsCategories']);
  history = await readHistory();
  if (wordlist.length < MIN_WORDS) {
    appEl.replaceChildren(el('div', 'empty',
      `Save at least ${MIN_WORDS} words first — your news is written around the words you're learning.`));
    toolbar('blocked');
    return;
  }
  const meta = await getSyncMeta();
  if (!meta || !meta.token || !meta.serverUrl) { showSetup(); return; }

  // Cached chips only: suggesting a fresh set is a model call, and this is a
  // page load.
  if (newsCategories && Date.now() - newsCategories.fetchedAt < CATEGORY_TTL_MS) {
    await setCategories(newsCategories.items || []);
  }
  // The last article you were given is the one on screen; the rest are one
  // click away.
  if (history.length) await show(history[0]);
  else showEmpty();
}

searchForm.addEventListener('submit', (e) => {
  e.preventDefault();
  // Whatever they typed is both the label and the search: the Worker's planner
  // turns an English phrase or a whole question into Chinese search terms.
  const asked = searchEl.value.trim();
  if (asked) generate({ topic: { label: asked, query: asked } });
});
generateBtn.addEventListener('click', () => {
  searchEl.value = ''; // this one is from the deck, not from the box
  generate();
});
historyBtn.addEventListener('click', () => {
  if (!listing) paintHistory();
  else if (current) show(current);
  else showEmpty();
});
englishBtn.addEventListener('click', () => {
  if (digest) toggleEnglish(digest);
});
// The level dial is about the next article, not this one. Changing it spends
// nothing; it says what the next passage will be written at.
difficultyEl.addEventListener('change', async () => {
  difficulty = difficultyEl.value;
  await chrome.storage.local.set({ newsDifficulty: difficulty });
  statusEl.textContent = difficulty === 'normal'
    ? 'Your next article will be written at your level.'
    : `Your next article will be a little ${difficulty}.`;
});

// Restore the saved difficulty before the first render, then load.
chrome.storage.local.get('newsDifficulty').then(({ newsDifficulty }) => {
  if (['easier', 'normal', 'harder'].includes(newsDifficulty)) difficulty = newsDifficulty;
  difficultyEl.value = difficulty;
  load();
});
