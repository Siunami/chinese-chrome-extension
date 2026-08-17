// Spaced-repetition review of saved words. Cards show the hanzi first; reveal
// shows pinyin, definition, and a real example sentence. SM-2 scheduling via
// lib/srs.js; state lives on each wordlist entry in chrome.storage.local.

import {
  GRADES, DEFAULT_LIMITS, schedule, intervalPreview, buildQueue, planSession,
  cardSeed, dueLaterToday, nextDueText,
} from './lib/srs.js';
import { cardKey } from './lib/merge.js';
import { forecastChart, stageBar } from './lib/progress.js';
import { createLookup } from './lib/lookup.js';
import { createTutor } from './lib/tutor.js';
import { mountShell } from './lib/shell.js';
import { forms, getHanziPref, onHanziPref } from './lib/hanzi.js';
import {
  hskPracticeHref, hskReviewCards, hskSetName, isHskPracticeParams, loadHskVocabulary,
  vocabularyForLevel,
} from './lib/hsk-vocab.js';
import {
  applySharedProgress, latestSrs, recordSharedProgress, STUDY_PROGRESS_KEY,
  uniqueStudyCards,
} from './lib/studysets.js';

const { createSelectionBar } = globalThis.ZhongwenSaveCard;


mountShell({ active: 'review' });

const appEl = document.getElementById('app');
const statsEl = document.getElementById('stats');
const keyhintEl = document.getElementById('keyhint');
const titleEl = document.getElementById('reviewTitle');
const setbarEl = document.getElementById('setbar');

const params = new URLSearchParams(location.search);
const hskMode = isHskPracticeParams(params);
const hskLevel = hskMode ? Number(params.get('hsk')) : null;
const hskScope = hskMode && params.get('scope') === 'cumulative' ? 'cumulative' : 'level';
const embedded = params.has('embedded');
let hskBaseCards = null;
let hskSourceCount = 0;

let queue = [];
let current = null;
let revealed = false;
let grading = false; // synchronous guard: a grade is being persisted
let sessionAgain = []; // 'again' cards come back at the end of the session

// Which script to lead with, read at init and kept live by the navbar toggle.
let hanziPref = 'simp-first';

// Daily limits, read from options at init.
let limits = { ...DEFAULT_LIMITS };
// Allowance the learner asked for on top of today's limits ("study 5 more").
let extraNew = 0;
let extraReviews = 0;

// Session tally. `seen` holds card keys so a card failed and re-shown counts
// once; `answers` counts every button press.
const session = {
  seen: new Set(),
  answers: 0,
  newStarted: 0,
  again: 0,
  startedAt: Date.now(),
  planned: 0, // cards in the queue when the session (or extension) began
};

// Hover-to-define popup (shared with every other surface). On a review card,
// definitions only appear after the answer is revealed — and never while the
// "Ask about this" button is up, or the popup would open on top of it.
const lookup = createLookup({
  getEnabled: () => revealed && !tutor.isPointing(),
  hoverTitle: 'Hover for a phrase-aware definition after revealing the answer',
});

// Highlight-to-save and highlight-to-ask, on the same terms as the popup: only
// once the answer is showing. Highlighting the question side is not a lookup,
// it is the answer.
const selectionBar = createSelectionBar({ root: () => appEl, lookup,
  getEnabled: () => revealed });

// The example sentence shown on the current answer, captured so the tutor can
// see the same context the learner is looking at.
let currentExample = null;

// What the card is, in the words the tutor needs. Kept short: the model is
// answering about one card, not summarising a deck.
function cardBrief() {
  if (!current) return '';
  const lines = [];
  if (hskMode) {
    lines.push(`Practice set: ${hskSetName(hskLevel, hskScope)}.`);
    if (current.pos) lines.push(`HSK part of speech: ${current.pos}.`);
  }
  if (current.cardType === 'sentence') {
    lines.push(`Sentence card: ${current.simp}`);
    if (current.pinyin) lines.push(`Pinyin: ${current.pinyin}`);
    if (current.defs) lines.push(`Translation: ${current.defs}`);
  } else {
    const trad = current.trad && current.trad !== current.simp ? ` (traditional ${current.trad})` : '';
    lines.push(`Word card: ${current.simp}${trad}`);
    if (current.pinyin) lines.push(`Pinyin: ${current.pinyin}`);
    if (current.defs) lines.push(`Dictionary gloss: ${current.defs}`);
    if (currentExample) {
      lines.push(`Example shown on the card: ${currentExample.zh} — ${currentExample.en}`);
    }
  }
  const srs = current.srs;
  if (srs && srs.lapses > 0) {
    lines.push(`The learner has forgotten this card ${srs.lapses} time${srs.lapses === 1 ? '' : 's'}.`);
  }
  return lines.join('\n');
}

// The tutor rides along as a drawer, available only once the answer is
// showing: before that, asking about the card would just be a way to be told
// the answer.
const tutor = createTutor({
  lookup,
  subtitle: 'Highlight anything on the card to ask about it',
  selectionBar,
  sectionFor: () => ({ section: 'Flashcard', text: cardBrief() }),
  context: () => ({
    where: hskMode
      ? `a flashcard in the ${hskSetName(hskLevel, hskScope)} set`
      : 'a flashcard they are reviewing',
    section: current?.cardType === 'sentence' ? 'Sentence card' : 'Word card',
    text: cardBrief(),
  }),
  startAvailable: false, // earned by revealing the answer / having a passage
  intro: () => (current
    ? `Confused about ${current.simp}? Ask how it is actually used, how it differs `
      + 'from a near synonym, or why the example sentence is built that way. You can '
      + 'also highlight part of the card and ask about just that.'
    : ''),
  starters: () => {
    if (!current) return [];
    if (current.cardType === 'sentence') {
      return [
        'Explain the grammar of this sentence piece by piece.',
        'Why is the word order like this?',
        'Give me two more sentences using the same pattern.',
      ];
    }
    return [
      `How is ${current.simp} actually used? Give me two natural sentences.`,
      `What is the difference between ${current.simp} and its close synonyms?`,
      `Break down the characters in ${current.simp}.`,
      'Is this word spoken, written, or both?',
    ];
  },
});

async function getWords() {
  const { wordlist = [], [STUDY_PROGRESS_KEY]: studyProgress = {} } =
    await chrome.storage.local.get(['wordlist', STUDY_PROGRESS_KEY]);

  // A library row may have arrived from phone sync with a newer grade than
  // this browser's shared map. Fold those states in while reading; whichever
  // surface is graded next will persist the winner back to both places.
  const shared = { ...studyProgress };
  for (const word of wordlist) {
    const key = cardKey(word);
    shared[key] = latestSrs(shared[key], word.srs);
  }

  if (!hskMode) return applySharedProgress(wordlist, shared);
  if (!hskBaseCards) {
    const vocabulary = await loadHskVocabulary();
    const selected = vocabularyForLevel(vocabulary, hskLevel, hskScope);
    hskSourceCount = selected.length;
    hskBaseCards = hskReviewCards(selected);
  }
  return uniqueStudyCards(applySharedProgress(hskBaseCards, shared));
}

async function persistGrade(card, srs) {
  const { wordlist = [], [STUDY_PROGRESS_KEY]: progress = {} } =
    await chrome.storage.local.get(['wordlist', STUDY_PROGRESS_KEY]);
  const key = cardKey(card);
  const nextProgress = recordSharedProgress(progress, card, srs);
  const target = wordlist.find((word) => cardKey(word) === key);
  if (target) target.srs = { ...srs };
  await chrome.storage.local.set({
    [STUDY_PROGRESS_KEY]: nextProgress,
    ...(target ? { wordlist } : {}),
  });
}

async function libraryState(card) {
  const { wordlist = [] } = await chrome.storage.local.get('wordlist');
  return wordlist.some((word) => cardKey(word) === cardKey(card));
}

function el(tag, className, text) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}

function pinyinEl(word) {
  // Saved words carry display pinyin ("shì fǒu") plus the tone list ("4,3")
  // captured at save time; older entries without tones render uncolored.
  const wrap = el('div', 'pinyin');
  const syls = word.pinyin.split(' ');
  const tones = (word.tones || '').split(',').map(Number);
  if (tones.length === syls.length && tones.every((t) => t >= 0 && t <= 5)) {
    syls.forEach((s, i) => {
      if (i > 0) wrap.append(' ');
      wrap.append(el('span', `tone${tones[i]}`, s));
    });
  } else {
    wrap.textContent = word.pinyin;
  }
  return wrap;
}

function speakButton(text) {
  const button = el('button', 'speak', '🔊');
  button.title = 'Play Mandarin pronunciation (Shift-click: extra slow)';
  button.setAttribute('aria-label', `Play pronunciation for ${text}`);
  button.addEventListener('click', (event) => {
    event.stopPropagation();
    chrome.runtime.sendMessage({ type: 'speak', text, slow: event.shiftKey });
  });
  return button;
}

// A session progress bar plus the two numbers that actually change during a
// session. Everything else (what is being held back, what comes next) belongs
// on the end-of-session panel, not in a running ticker.
function updateStats() {
  const left = queue.length + (current ? 1 : 0) + sessionAgain.length;
  const done = session.seen.size;
  const total = Math.max(session.planned, done + left);
  statsEl.replaceChildren();
  if (!total) return;

  const bar = el('div', 'progress');
  const fill = el('i');
  fill.style.width = `${total ? Math.round((done / total) * 100) : 0}%`;
  bar.append(fill);
  const line = el('div', 'progress-line');
  line.append(el('b', '', `${done} of ${total}`), ' reviewed');
  if (left) line.append(` · ${left} to go`);
  if (session.newStarted) line.append(` · ${session.newStarted} new`);
  statsEl.append(bar, line);
}

async function exampleBlock(word) {
  try {
    const r = await chrome.runtime.sendMessage({
      type: 'examples', simp: word.simp, trad: word.trad, count: 1,
    });
    const ex = r && r.examples && r.examples[0];
    if (!ex) return null;
    currentExample = ex; // the tutor answers about the sentence on screen
    const box = el('div', 'example');
    const zh = lookup.hoverable('div', 'zh', ex.zh);
    const form = ex.zh.includes(word.simp) ? word.simp
      : ex.zh.includes(word.trad) ? word.trad : null;
    if (form) {
      const chars = Array.from(ex.zh);
      const formChars = Array.from(form);
      let start = -1;
      for (let i = 0; i <= chars.length - formChars.length; i++) {
        if (chars.slice(i, i + formChars.length).join('') === form) {
          start = i;
          break;
        }
      }
      if (start !== -1) {
        for (let i = start; i < start + formChars.length; i++) {
          zh.lookupSource.spans[i]?.classList.add('hl');
        }
      }
    }
    zh.append(speakButton(ex.zh));
    box.append(zh);
    if (ex.py) box.append(el('div', 'py', ex.py));
    box.append(el('div', 'en', ex.en));
    return box;
  } catch {
    return null;
  }
}

function gradeLabel(g) {
  return { again: 'Again', hard: 'Hard', good: 'Good', easy: 'Easy' }[g];
}

// ---------------------------------------------------------------------------
// End of session
//
// "Done for the day" is a claim about the schedule, and an unexplained one is
// indistinguishable from a bug — especially with unstudied words still sitting
// in the library. So the panel says what was finished, what is deliberately
// being held back and why, when the next card arrives, and offers a way past
// the limits for anyone who wants it.
// ---------------------------------------------------------------------------

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

function tile(value, label) {
  const box = el('div', 'tile');
  box.append(el('div', 'tile-n', String(value)), el('div', 'tile-l', label));
  return box;
}

async function extendSession({ addNew = 0, addReviews = 0 }) {
  extraNew += addNew;
  extraReviews += addReviews;
  const words = await getWords();
  const more = buildQueue(words, Date.now(), { ...limits, extraNew, extraReviews })
    .filter((w) => !session.seen.has(cardKey(w)));
  if (!more.length) {
    renderSummary(words);
    return;
  }
  queue = more;
  session.planned = session.seen.size + queue.length;
  advance();
  updateStats();
  renderCard();
}

function actionButton(label, handler) {
  const button = el('button', 'more-btn', label);
  button.addEventListener('click', handler);
  return button;
}

function renderSummary(words) {
  const now = Date.now();
  const plan = planSession(words, now, { ...limits, extraNew, extraReviews });
  const finished = session.seen.size > 0;
  const laterToday = dueLaterToday(words, now);

  const panel = el('div', 'summary');

  if (!words.length) {
    panel.append(el('div', 'summary-head', 'Nothing saved yet'));
    panel.append(el('p', 'summary-sub',
      'Hover Chinese text on any page and press ☆ save (or s) to add a word. Saved words show up here as flashcards.'));
    appEl.append(panel);
    return;
  }

  panel.append(el('div', 'summary-head',
    plan.queued > 0 ? 'More cards are ready'
      : finished ? 'Done for today ✓'
      : 'Nothing is due right now'));

  // What "done" means, in the case that actually applies.
  const why = el('p', 'summary-sub');
  if (plan.queued > 0) {
    why.textContent = `${plural(plan.queued, 'card')} came due while you were working.`;
    const go = actionButton('Keep going', () => extendSession({}));
    why.append(' ', go);
  } else if (finished) {
    why.textContent =
      'Every card the scheduler had for today has been reviewed. It stops here on purpose: a card you just saw teaches you almost nothing, so each one is held back until you are on the edge of forgetting it.';
  } else {
    why.textContent =
      'You are between reviews. Cards come back on a widening schedule, so an empty queue means everything is still fresh — not that you are finished with them.';
  }
  panel.append(why);

  if (finished) {
    const tiles = el('div', 'tiles');
    tiles.append(tile(session.seen.size,
      session.seen.size === 1 ? 'card reviewed' : 'cards reviewed'));
    if (session.newStarted) {
      tiles.append(tile(session.newStarted,
        session.newStarted === 1 ? 'new word started' : 'new words started'));
    }
    tiles.append(tile(session.again, 'marked Again'));
    const minutes = Math.max(1, Math.round((now - session.startedAt) / 60000));
    tiles.append(tile(minutes, 'minute' + (minutes === 1 ? '' : 's')));
    panel.append(tiles);
  }

  // Anything held back, and the escape hatch for it.
  const held = el('div', 'held');
  if (plan.newHeld > 0 && plan.newAllowed <= 0) {
    const row = el('p', 'held-row');
    row.append(el('b', '', `${plural(plan.newHeld, 'new word')} still unstudied.`));
    row.append(` Today's introduction limit of ${limits.newPerDay} is used up (${plan.introducedToday} started today), so they queue up at ${limits.newPerDay} a day. Learning a batch and then meeting it again tomorrow is what makes it stick — but you can pull more forward.`);
    row.append(actionButton(`Start ${Math.min(5, plan.newHeld)} more now`,
      () => extendSession({ addNew: Math.min(5, plan.newHeld) })));
    held.append(row);
  } else if (plan.newHeld > 0) {
    held.append(el('p', 'held-row',
      `${plural(plan.newHeld, 'new word')} unstudied — they will come up in the next sessions.`));
  }
  if (plan.dueHeld > 0) {
    const row = el('p', 'held-row');
    row.append(el('b', '', `${plural(plan.dueHeld, 'due card')} held back.`));
    row.append(` Today's cap is ${limits.maxPerDay} cards so a backlog never turns into a wall.`);
    row.append(actionButton(`Review ${Math.min(20, plan.dueHeld)} more`,
      () => extendSession({ addReviews: Math.min(20, plan.dueHeld) })));
    held.append(row);
  }
  if (held.childElementCount) panel.append(held);

  // When the next card actually arrives.
  const next = el('p', 'next-up');
  if (laterToday) {
    next.append(el('b', '', `${plural(laterToday, 'card')} come back later today`));
    next.append(' — the ones you rated Again or Hard sit on a short relearning step.');
    if (plan.nextDue) next.append(` Next: ${nextDueText(plan.nextDue, now)}.`);
  } else if (plan.nextDue) {
    next.append('Next card due ', el('b', '', nextDueText(plan.nextDue, now)), '.');
  } else {
    next.append('No cards are scheduled yet — grade a few and the schedule builds itself.');
  }
  panel.append(next);

  panel.append(forecastChart(words, now, {
    days: 14, newToday: plan.newSelected.length,
  }));
  panel.append(stageBar(words));

  const foot = el('p', 'summary-foot');
  if (hskMode) {
    const guide = el('a', '', `Back to the HSK ${hskLevel} guide`);
    guide.href = `hsk.html#${hskLevel}`;
    const saved = el('a', '', 'Review your saved library →');
    saved.href = 'review.html';
    if (embedded) {
      guide.addEventListener('click', (event) => {
        event.preventDefault();
        parent.postMessage({ type: 'zx-open', view: 'guides' }, '*');
      });
      saved.addEventListener('click', (event) => {
        event.preventDefault();
        parent.postMessage({
          type: 'zx-open', view: 'review', url: 'review.html?embedded=1',
        }, '*');
      });
    }
    foot.append(guide, ' · ', saved);
  } else {
    const link = el('a', '', 'See every card and its schedule →');
    link.href = 'wordlist.html';
    // Inside the dashboard the library is a sibling frame, so switch tabs there
    // instead of replacing this frame with a second copy of the library.
    if (embedded) {
      link.addEventListener('click', (event) => {
        event.preventDefault();
        parent.postMessage({ type: 'zx-open', view: 'library' }, '*');
      });
    }
    foot.append(link);
  }
  panel.append(foot);
  appEl.append(panel);
}

async function renderCard() {
  revealed = false;
  grading = false;
  currentExample = null;
  lookup.hide();
  // Asking about the card before answering it would just be a way to be told
  // the answer, so the tutor is not offered until reveal().
  tutor.setAvailable(false);
  appEl.replaceChildren();
  keyhintEl.hidden = false;
  if (!current) {
    keyhintEl.hidden = true;
    renderSummary(await getWords());
    if (session.seen.size) {
      // Push this session's grades to the phone right away rather than
      // waiting for the background debounce alarm.
      chrome.runtime.sendMessage({ type: 'syncNow' }).catch(() => {});
    }
    return;
  }
  const card = el('div', 'card');
  const sentenceCard = current.cardType === 'sentence';
  if (sentenceCard) card.append(el('div', 'card-type', 'Sentence'));
  else if (hskMode) {
    const level = current.hskLevel === '7-9' ? 'HSK 7–9' : `HSK ${current.hskLevel}`;
    card.append(el('div', 'card-type', `${level}${current.pos ? ` · ${current.pos}` : ''}`));
  }
  // Lead with the script the learner reads in; the other form stays below,
  // smaller, so the card still teaches both.
  const face = forms(current, hanziPref);
  card.append(lookup.hoverable(
    'div', `hanzi${sentenceCard ? ' sentence' : ''}`, face.primary,
  ));
  if (!sentenceCard && face.secondary) {
    card.append(lookup.hoverable('div', 'trad', face.secondary));
  }
  const controls = el('div', 'controls');
  const revealBtn = el('button', '', 'Show answer');
  revealBtn.id = 'reveal';
  revealBtn.addEventListener('click', reveal);
  controls.append(revealBtn);
  card.append(controls);
  appEl.append(card);
}

async function reveal() {
  if (!current || revealed || grading) return;
  revealed = true;
  const card = appEl.querySelector('.card');
  card.querySelector('.controls').remove();

  const answerLine = el('div', 'answer-line');
  answerLine.append(pinyinEl(current), speakButton(forms(current, hanziPref).primary));
  card.append(answerLine);
  card.append(el('div', 'defs', current.defs));
  if (hskMode) {
    const reviewed = current;
    const library = el('button', 'library-add', 'Checking saved library…');
    library.type = 'button';
    library.disabled = true;
    card.append(library);
    const saved = await libraryState(reviewed);
    if (!revealed || current !== reviewed || !card.isConnected) return;
    library.disabled = saved;
    library.classList.toggle('on', saved);
    library.textContent = saved ? '✓ In saved library' : '☆ Add to saved library';
    if (!saved) {
      library.addEventListener('click', async () => {
        library.disabled = true;
        library.textContent = 'Adding…';
        const result = await chrome.runtime.sendMessage({
          type: 'saveWord',
          entry: {
            cardType: 'word',
            simp: reviewed.simp,
            trad: reviewed.trad,
            pinyin: reviewed.pinyin,
            tones: reviewed.tones,
            defs: reviewed.defs,
            sourceWord: '',
          },
        }).catch(() => null);
        if (result?.ok) {
          library.textContent = '✓ Added to saved library';
          library.classList.add('on');
        } else {
          library.disabled = false;
          library.textContent = 'Could not add — try again';
        }
      });
    }
  }
  const ex = current.cardType === 'sentence' ? null : await exampleBlock(current);
  if (!revealed || !card.isConnected) return; // card changed while fetching
  if (ex) card.append(ex);

  const controls = el('div', 'controls');
  const now = Date.now();
  const seed = cardSeed(current);
  for (const g of GRADES) {
    const btn = el('button', `grade g-${g}`);
    btn.append(el('span', '', gradeLabel(g)));
    // Same seed the grade itself will use, so the preview is the real interval
    // (fuzz included) rather than an average the card never gets.
    btn.append(el('small', '', intervalPreview(current.srs, g, now, { seed })));
    btn.addEventListener('click', () => grade(g));
    controls.append(btn);
  }
  card.append(controls);

  // The answer is on screen: questions about this card can no longer give it
  // away. Each card keeps its own conversation.
  tutor.setAvailable(true);
  await tutor.setThread();
}

async function grade(g) {
  // `grading` blocks re-entry (double-click / key auto-repeat) during the
  // storage awaits below; renderCard() clears it for the next card.
  if (!current || !revealed || grading) return;
  grading = true;
  const graded = current;
  const now = Date.now();
  const wasNew = !graded.srs;
  const newSrs = schedule(graded.srs, g, now, { seed: cardSeed(graded) });

  // The schedule is independent of set membership. Persist it in the shared
  // map and mirror it into the saved-library row when one exists, so an HSK
  // grade, a saved-deck grade and phone sync all converge on one memory.
  await persistGrade(graded, newSrs);

  session.seen.add(cardKey(graded));
  session.answers += 1;
  if (wasNew) session.newStarted += 1;
  if (g === 'again') {
    session.again += 1;
    sessionAgain.push({ ...graded, srs: newSrs });
  }
  advance();
  updateStats();
  renderCard();
}

function advance() {
  if (queue.length > 0) {
    current = queue.shift();
  } else if (sessionAgain.length > 0) {
    current = sessionAgain.shift();
  } else {
    current = null;
  }
}

function isTyping(target) {
  const tag = target && target.tagName;
  return tag === 'TEXTAREA' || tag === 'INPUT' || (target && target.isContentEditable);
}

document.addEventListener('keydown', (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  // Typing a question in the tutor must not grade the card: "1" is both a
  // digit and the Again key.
  if (isTyping(e.target)) return;
  if (!current) return;
  if (!revealed && (e.key === ' ' || e.key === 'Enter')) {
    e.preventDefault();
    reveal();
    return;
  }
  if (revealed && ['1', '2', '3', '4'].includes(e.key)) {
    e.preventDefault();
    grade(GRADES[Number(e.key) - 1]);
  } else if (revealed && e.key.toLowerCase() === 'p') {
    e.preventDefault();
    chrome.runtime.sendMessage({
      type: 'speak', text: forms(current, hanziPref).primary, slow: e.shiftKey,
    });
  }
});

async function loadLimits() {
  const stored = await chrome.storage.sync.get(DEFAULT_LIMITS).catch(() => DEFAULT_LIMITS);
  const clamp = (value, fallback, max) => {
    const n = Math.round(Number(value));
    return Number.isFinite(n) && n >= 0 && n <= max ? n : fallback;
  };
  limits = {
    newPerDay: clamp(stored.newPerDay, DEFAULT_LIMITS.newPerDay, 200),
    maxPerDay: clamp(stored.maxPerDay, DEFAULT_LIMITS.maxPerDay, 1000),
  };
}

// Flipping the navbar toggle changes the card in place — the point of a toggle
// is seeing the change. Swapping the two lines rather than re-rendering keeps a
// revealed card revealed; re-running renderCard() here would hide the answer
// the learner was in the middle of reading.
onHanziPref((pref) => {
  hanziPref = pref;
  if (!current) return;
  const card = appEl.querySelector('.card');
  if (!card) return;
  const face = forms(current, hanziPref);
  const primary = card.querySelector('.hanzi');
  if (primary) {
    primary.replaceWith(lookup.hoverable('div', primary.className, face.primary));
  }
  const secondary = card.querySelector('.trad');
  if (face.secondary && secondary) {
    secondary.replaceWith(lookup.hoverable('div', 'trad', face.secondary));
  }
});

function setLink(label, href) {
  const link = el('a', '', label);
  link.href = href;
  if (embedded) {
    link.addEventListener('click', (event) => {
      event.preventDefault();
      parent.postMessage({
        type: 'zx-open',
        view: 'review',
        url: href.includes('?') ? `${href}&embedded=1` : `${href}?embedded=1`,
      }, '*');
    });
  }
  return link;
}

function renderSetHeader(words) {
  if (!hskMode) {
    titleEl.textContent = 'Review';
    setbarEl.replaceChildren();
    return;
  }
  titleEl.textContent = hskSetName(hskLevel, hskScope);
  const unique = words.length;
  const detail = unique === hskSourceCount
    ? `${unique.toLocaleString()} cards`
    : `${unique.toLocaleString()} unique cards from ${hskSourceCount.toLocaleString()} syllabus entries`;
  setbarEl.replaceChildren(el('span', '',
    `${detail} · schedules are shared with every other set and the saved library`));
  if (hskLevel > 1) {
    const otherScope = hskScope === 'level' ? 'cumulative' : 'level';
    setbarEl.append(setLink(
      otherScope === 'cumulative' ? 'Switch to cumulative set' : 'Only this level',
      hskPracticeHref(hskLevel, otherScope),
    ));
  }
  setbarEl.append(setLink('Saved-library review', 'review.html'));
}

async function init() {
  // Pull grades made on the phone before building today's queue, but never
  // hold the page hostage to a slow network (no-op when sync is unpaired).
  await Promise.all([
    loadLimits(),
    getHanziPref().then((p) => { hanziPref = p; }),
    Promise.race([
      chrome.runtime.sendMessage({ type: 'syncNow' }).catch(() => {}),
      new Promise((resolve) => setTimeout(resolve, 1500)),
    ]),
  ]);
  const words = await getWords();
  renderSetHeader(words);
  queue = buildQueue(words, Date.now(), limits);
  session.planned = queue.length;
  advance();
  updateStats();
  renderCard();
}

init();
