// Personalized Mandarin news digest. Builds a learner profile from the saved
// wordlist (recently studied + struggling words + skill stats), and on a
// button press asks the sync Worker's /api/news endpoint to search current
// news on those topics and synthesize a short passage pitched just above the
// learner's level. Rendered here with a glossary of the stretch words and a
// hideable English summary for self-testing. Generation is button-triggered
// and cached, so opening a new tab never spends model credits on its own.

import { buildProfile } from './lib/profile.js';
import { DEFAULT_SERVER_URL, aiHeaders, getSyncMeta, newToken } from './lib/sync.js';
import { createLookup } from './lib/lookup.js';
import { createTutor } from './lib/tutor.js';
import { mountShell } from './lib/shell.js';
import { convertDeep, getHanziPref, onHanziPref } from './lib/hanzi.js';

const { createSelectionBar } = globalThis.ZhongwenSaveCard;

const CACHE_TTL_MS = 12 * 60 * 60 * 1000;
const MIN_WORDS = 5;

mountShell({ active: 'news' });

const appEl = document.getElementById('app');
const statusEl = document.getElementById('status');
const generateBtn = document.getElementById('generate');
const regenerateBtn = document.getElementById('regenerate');
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
// The digest as the model wrote it, always simplified. `digest` holds the
// converted copy that is on screen, so flipping the script re-converts from
// the original rather than converting a conversion.
let sourceDigest = null;
let englishShown = false;
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

function hideActionButtons() {
  generateBtn.hidden = true;
  regenerateBtn.hidden = true;
  englishBtn.hidden = true;
  difficultyLabel.hidden = true;
}

// `data` is the digest as stored: simplified, as the model wrote it.
async function render(data, fetchedAt) {
  sourceDigest = data;
  return paint(await convertDeep(data, hanziPref), fetchedAt);
}

function paint(data, fetchedAt) {
  lookup.hide();
  selectionBar.hide(); // its range points into the passage we are replacing
  appEl.replaceChildren();
  englishShown = false;
  // Each digest gets its own conversation; a new passage starts a new one.
  digest = data;
  tutor.setAvailable(true);
  tutor.setThread();

  const chips = el('div', 'chips');
  if (data.level) chips.append(el('span', 'chip level', data.level));
  if (data.targetHsk) chips.append(el('span', 'chip', `reading at HSK ${data.targetHsk}`));
  for (const topic of data.topics || []) chips.append(el('span', 'chip', topic));
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
      row.append(el('div', 'gloss-word', g.word));
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

  hideActionButtons();
  regenerateBtn.hidden = false;
  difficultyLabel.hidden = false;
  englishBtn.hidden = !data.englishSummary;
  englishBtn.textContent = 'Show English';
  statusEl.textContent = fetchedAt ? `Generated ${fmtAgo(fetchedAt)}` : '';
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

async function postNews(meta, profile, force) {
  const res = await fetch(`${meta.serverUrl.replace(/\/+$/, '')}/api/news`, {
    method: 'POST',
    headers: await aiHeaders(meta),
    body: JSON.stringify({ profile, force, difficulty }),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok || !data || data.error) {
    // The Worker adds `detail` (e.g. "no current news found for these topics")
    // — more actionable than the generic error.
    throw new Error(data?.detail || data?.error || `server error (http ${res.status})`);
  }
  return data;
}

let busy = false;

async function generate(force) {
  if (busy) return;
  busy = true;
  hideActionButtons();
  statusEl.textContent = 'Reading the news and writing your passage… this can take up to a minute';
  try {
    const { wordlist = [] } = await chrome.storage.local.get('wordlist');
    const meta = await getSyncMeta();
    if (!meta || !meta.token || !meta.serverUrl) { showSetup(); return; }
    const data = await postNews(meta, buildProfile(wordlist), force);
    const fetchedAt = data.generatedAt || Date.now();
    await chrome.storage.local.set({ newsDigest: { fetchedAt, data } });
    await render(data, fetchedAt);
    if (data.stale) statusEl.textContent = `Showing your last digest (${fmtAgo(fetchedAt)}) — refresh failed, try again shortly`;
    else if (data.cached && force) statusEl.textContent = `Generated ${fmtAgo(fetchedAt)} — regenerating is limited to about once a minute`;
  } catch (err) {
    const { newsDigest = null } = await chrome.storage.local.get('newsDigest');
    if (newsDigest) {
      await render(newsDigest.data, newsDigest.fetchedAt);
      statusEl.textContent = `Could not refresh: ${err.message}`;
    } else {
      appEl.replaceChildren(el('div', 'empty', `Could not generate your news: ${err.message}`));
      hideActionButtons();
      generateBtn.hidden = false;
      generateBtn.textContent = 'Try again';
      statusEl.textContent = '';
    }
  } finally {
    busy = false;
  }
}

// Reading news rides on the same capability token as phone sync. If the user
// never enabled sync, offer to create one right here. The second half of setup
// — an AI key — lives in Options, and the Worker's 503 names it, so this only
// has to get them past the token.
function showSetup() {
  appEl.replaceChildren();
  hideActionButtons();
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

// A passage is nothing but Chinese, so flipping the script repaints it —
// converting the model's original again rather than converting what is on
// screen, which would be a conversion of a conversion.
onHanziPref(async (pref) => {
  hanziPref = pref;
  if (!sourceDigest) return;
  const { newsDigest = null } = await chrome.storage.local.get('newsDigest');
  await render(sourceDigest, newsDigest?.fetchedAt);
});

async function load() {
  hanziPref = await getHanziPref();
  lookup.hide();
  // No passage yet means nothing to ask about; render() turns it back on.
  tutor.setAvailable(false);
  const { wordlist = [], newsDigest = null } =
    await chrome.storage.local.get(['wordlist', 'newsDigest']);
  if (wordlist.length < MIN_WORDS) {
    appEl.replaceChildren(el('div', 'empty',
      `Save at least ${MIN_WORDS} words first — your news is written around the words you're learning.`));
    hideActionButtons();
    return;
  }
  const meta = await getSyncMeta();
  if (!meta || !meta.token || !meta.serverUrl) { showSetup(); return; }

  if (newsDigest) {
    await render(newsDigest.data, newsDigest.fetchedAt);
    if (Date.now() - newsDigest.fetchedAt >= CACHE_TTL_MS) {
      statusEl.textContent = `Generated ${fmtAgo(newsDigest.fetchedAt)} — tap Regenerate for today's`;
    }
    return;
  }
  // No digest yet: show the pitch and wait for the button.
  const intro = el('div', 'empty');
  intro.append(el('p', null,
    'Get a short news passage in Chinese, built from what you\'re currently '
    + 'studying and matched to your level. Too hard or too easy? Use the '
    + 'Difficulty control to dial it in.'));
  appEl.replaceChildren(intro);
  hideActionButtons();
  generateBtn.hidden = false;
  generateBtn.textContent = "Generate today's news";
  difficultyLabel.hidden = false;
}

generateBtn.addEventListener('click', () => generate(false));
regenerateBtn.addEventListener('click', () => generate(true));
englishBtn.addEventListener('click', async () => {
  const { newsDigest = null } = await chrome.storage.local.get('newsDigest');
  if (newsDigest) toggleEnglish(newsDigest.data);
});
// Changing difficulty persists the choice and regenerates at the new level.
difficultyEl.addEventListener('change', async () => {
  difficulty = difficultyEl.value;
  await chrome.storage.local.set({ newsDifficulty: difficulty });
  generate(true);
});

// Restore the saved difficulty before the first render, then load.
chrome.storage.local.get('newsDifficulty').then(({ newsDifficulty }) => {
  if (['easier', 'normal', 'harder'].includes(newsDifficulty)) difficulty = newsDifficulty;
  difficultyEl.value = difficulty;
  load();
});
