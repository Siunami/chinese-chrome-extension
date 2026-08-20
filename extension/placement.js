// The placement interview: a dozen turns of Mandarin back-and-forth that end
// in a level, a chart of what held and what did not, and a pile of corrections
// you can put straight into the deck.
//
// The page owns the conversation and the transport; the rules — which level to
// probe, when to stop, what the marks add up to — are lib/placement.js, so
// they can be tested without a model. The Worker's /api/placement marks one
// answer and sets one task per call and knows nothing about the run it is in.
//
// Three views live here, and the same DOM is reused for all of them: the
// standing result (or an invitation, first time), the interview itself, and
// the report it produces. They are one page rather than three because the
// report IS the standing result — the thing you come back to look at.

import {
  MAX_TURNS, MIN_LEVEL, MAX_LEVEL,
  estimate, planNext, progression, rubricFor, loadResults, saveResult,
} from './lib/placement.js';
import { buildProfile } from './lib/profile.js';
import {
  SIMP_FIRST, convertDeep, getHanziPref, isTradFirst, onHanziPref,
} from './lib/hanzi.js';
import { levelLadder, levelTrend } from './lib/progress.js';
import { createLookup } from './lib/lookup.js';
import { mountShell } from './lib/shell.js';
import { getSyncMeta, hasDefaultServer, pairWith } from './lib/sync.js';
import {
  AI_BAD_KEY, AI_NO_KEY, AI_NO_QUOTA, AI_NOTICES, AI_STALE_SERVER,
  openOptionsAt, postAi,
} from './lib/aistatus.js';
import { guideByLevel } from './guides/index.js';

const { saver } = globalThis.ZhongwenSaveCard;

mountShell({ active: 'placement' });

const viewEl = document.getElementById('view');
const cards = saver();

// The interview is the one place in the app where hovering for a definition
// would defeat the point: the task is written in Chinese because reading it is
// part of what is being measured. Definitions come back on the report, where
// every piece of Chinese said during the run is hoverable again.
let reading = false;
const lookup = createLookup({
  getEnabled: () => !reading,
  hoverTitle: 'Hover for definition, examples, and related words',
});

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function button(className, label, onClick) {
  const b = el('button', className, label);
  b.type = 'button';
  b.addEventListener('click', onClick);
  return b;
}

function speakButton(text) {
  const b = el('button', 'speak', '🔊');
  b.type = 'button';
  b.title = 'Play Mandarin pronunciation';
  b.setAttribute('aria-label', `Play pronunciation for ${text}`);
  b.addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: 'speak', text }).catch(() => {});
  });
  return b;
}

const fmtDate = (ts) => new Date(ts).toLocaleDateString(undefined,
  { year: 'numeric', month: 'short', day: 'numeric' });

// ---------------------------------------------------------------------------
// Which script the interview is in
// ---------------------------------------------------------------------------
//
// The 简/繁 toggle travels with each turn, so the examiner writes its tasks and
// its corrections in the script the learner reads — without it, a traditional
// reader who answered 博物館 was told the correct character is 馆, which is not
// an error at all, and saving that correction put a simplified card in a deck
// they read in traditional.
//
// The examiner is told, and what comes back is converted anyway: the toggle is
// the app's promise rather than the model's, and it also has to apply to a
// report sat before the toggle last moved. Conversion is at display time, so
// what is stored stays exactly what the examiner wrote.
let hanziPref = SIMP_FIRST;

// The report currently on screen, kept unconverted so flipping 简/繁 repaints
// it rather than converting an already-converted copy.
let standing = null;

// Every task asked so far, in the learner's script. Rebuilt rather than
// appended to, so a flip mid-interview repaints the questions already on
// screen along with the new one.
async function reshowTurns() {
  if (!run || !run.turns.length) return;
  const shown = await convertDeep(run.turns.map((t) => t.prompt || ''), hanziPref);
  run.turns.forEach((turn, i) => { turn.shown = shown[i]; });
}

// The examiner's half of a finished run, in the learner's script.
//
// The learner's own Chinese is left exactly as they typed it — their answers
// in the transcript, and the span quoting them beside each correction. A
// transcript that rewrites what you wrote is not a transcript, and a "you
// wrote" line that is not what you wrote teaches nothing.
async function inReadingScript(result) {
  const transcript = result.transcript || [];
  const shown = await convertDeep({
    report: result.report || null,
    prompts: transcript.map((t) => t.prompt || ''),
    fixes: transcript.map((t) => (t.assess?.errors || []).map((e) => e.correction || '')),
  }, hanziPref);
  return {
    ...result,
    report: shown.report,
    transcript: transcript.map((turn, i) => ({
      ...turn,
      prompt: shown.prompts[i],
      assess: turn.assess && {
        ...turn.assess,
        errors: (turn.assess.errors || [])
          .map((error, j) => ({ ...error, correction: shown.fixes[i][j] })),
      },
    })),
  };
}

// ---------------------------------------------------------------------------
// The run in progress
// ---------------------------------------------------------------------------

// turns: one per task asked, in order.
//   { level, taskType, prompt, shown, answer, assess }
// `prompt` is what the examiner wrote and `shown` is that in the learner's
// script; the stored transcript keeps the former.
// `assess` arrives with the NEXT response — the call that marks this answer is
// the same call that sets the following task — so the last turn of a run is
// always unmarked until the reply after it lands.
let run = null;

function newRun(startLevel, profile) {
  return {
    startLevel, profile, turns: [], busy: false, error: '', errorCode: '', finished: false,
  };
}

const messagesFor = (turns) => turns.flatMap((t) => [
  { role: 'examiner', content: t.prompt },
  ...(t.answer ? [{ role: 'learner', content: t.answer }] : []),
]);

// lib/aistatus.js owns the transport: it turns a rejected key or an
// out-of-date Worker into something the navbar can act on, rather than a
// sentence only this page shows.
async function post(payload) {
  const meta = await getSyncMeta();
  if (!meta || !meta.token || !meta.serverUrl) throw new Error('not paired');
  return postAi(meta, '/api/placement', payload);
}

// One turn: send the answer just typed (if any), get back its mark and the
// next task. `answer` is empty on the opening turn.
async function step(answer = '') {
  const last = run.turns[run.turns.length - 1] || null;
  if (last) last.answer = answer;

  const plan = planNext(run.turns, { startLevel: run.startLevel, maxTurns: MAX_TURNS });
  const finish = !!plan.done;
  // On the closing turn there is no next task to pitch, so the level sent is
  // simply the one the answer being marked belongs to.
  const target = finish ? (last ? last.level : run.startLevel) : plan.level;
  const allowed = finish ? [target] : plan.allowed;

  run.busy = true;
  run.error = '';
  render();

  let data;
  try {
    data = await post({
      target,
      allowed,
      finish,
      answer,
      answeredLevel: last ? last.level : undefined,
      rubrics: allowed.map(rubricFor).filter(Boolean),
      script: isTradFirst(hanziPref) ? 'trad' : 'simp',
      profile: run.profile,
      history: messagesFor(run.turns),
    });
  } catch (err) {
    run.busy = false;
    // The answer stays on the turn, so retrying re-sends it rather than
    // asking the learner to type it again.
    run.error = err.message === 'not paired' ? 'not paired' : err.message;
    // A key that was refused, or a server too old to have this route, is not
    // something Try again will ever get past — postAi names those, and the box
    // offers the thing that would actually fix them.
    run.errorCode = err.message === 'not paired' ? 'not paired' : (err.code || '');
    render();
    return;
  }

  run.busy = false;
  if (last && data.assess) last.assess = data.assess;

  if (finish) {
    run.finished = true;
    await complete(data);
    return;
  }
  run.turns.push({
    level: data.level || target,
    taskType: data.taskType || '',
    prompt: data.reply,
    shown: data.reply,
    answer: '',
    assess: null,
  });
  await reshowTurns();
  render();
}

// The run is over: turn the marks into a result, store it, and show the report.
async function complete(data) {
  const summary = estimate(run.turns);
  const result = {
    at: Date.now(),
    level: summary.level,
    confidence: summary.confidence,
    studyLevel: summary.studyLevel,
    perLevel: summary.perLevel,
    turns: summary.turns,
    comprehension: summary.comprehension,
    production: summary.production,
    report: data.result || null,
    transcript: run.turns.map((t) => ({
      level: t.level, prompt: t.prompt, answer: t.answer, assess: t.assess,
    })),
  };
  await saveResult(result);
  // The guides open on the first level not yet held, so "what do I study now"
  // is answered by the app rather than by the learner doing arithmetic.
  if (summary.level) await chrome.storage.local.set({ hskLevel: summary.studyLevel });
  run = null;
  showResult(result);
}

// ---------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------

function page(title, sub) {
  viewEl.replaceChildren();
  const head = el('div', 'page-head');
  head.append(el('h2', null, title));
  if (sub) head.append(el('p', 'sub', sub));
  viewEl.append(head);
  return viewEl;
}

// --- the invitation, and the standing result ------------------------------

async function showIntro() {
  reading = true;
  standing = null;
  const results = await loadResults();
  if (results.length) { showResult(results[0], results); return; }

  const root = page('Where are you on the HSK scale?',
    'A short interview in Mandarin — you will be asked things and you type back.');
  const box = el('div', 'panel');
  box.append(el('p', null,
    'Roughly a dozen questions, five to ten minutes. It starts somewhere you are '
    + 'comfortable and works upward until the questions stop being answerable, then '
    + 'comes back to confirm the highest level you actually held. That is where the '
    + 'number comes from — a level you sustained, with a level above it you did not.'));
  box.append(el('p', null,
    'Answer in Chinese as best you can. Answering in English, or saying you do not '
    + 'know, is a real answer too — it is scored as one, and it is how the interview '
    + 'finds your ceiling. Nothing is corrected while you are in it; every correction '
    + 'is waiting at the end, and each one can be saved as a flashcard.'));
  box.append(el('p', 'note',
    'Your saved deck is sent along so the questions lean on words you already know. '
    + 'It runs on the same AI key and private token as the tutor and the news digest.'));
  box.append(button('primary', 'Start the interview', start));
  root.append(box);
}

// --- the interview --------------------------------------------------------

function renderInterview() {
  reading = false;
  const root = page('Placement interview', '');
  const asked = run.turns.length;

  const bar = el('div', 'progress');
  const fill = el('i');
  // The scale is the run's ceiling, not a promise: the ladder usually settles
  // before it. Under-promising the length is better than a bar that fills and
  // then keeps going.
  fill.style.width = `${Math.min(100, (asked / MAX_TURNS) * 100)}%`;
  bar.append(fill);
  const count = el('p', 'progress-note',
    asked ? `Question ${asked} · up to ${MAX_TURNS}` : 'Starting…');
  root.append(bar, count);

  const log = el('div', 'log');
  for (const turn of run.turns) {
    const ask = el('div', 'msg examiner');
    const bubble = el('div', 'bubble');
    const asked = turn.shown || turn.prompt;
    bubble.append(lookup.hoverable('div', 'zh', asked));
    bubble.append(speakButton(asked));
    ask.append(bubble);
    log.append(ask);
    if (turn.answer) {
      const said = el('div', 'msg learner');
      said.append(el('div', 'bubble', turn.answer));
      log.append(said);
    }
  }
  if (run.busy) {
    const wait = el('div', 'msg examiner');
    wait.append(el('div', 'thinking', asked ? 'Reading your answer…' : 'Getting started…'));
    log.append(wait);
  }
  root.append(log);

  if (run.error) {
    // Three kinds of stop, and only one of them is worth a Try again button.
    const settled = [AI_BAD_KEY, AI_NO_QUOTA, AI_NO_KEY, AI_STALE_SERVER]
      .includes(run.errorCode);
    const box = el('div', 'error');
    box.append(el('p', null, run.error === 'not paired'
      ? 'The interview runs through a Cloudflare Worker you deploy to your own '
        + 'account, on the same private token as the tutor and phone sync — and '
        + 'there is not one on this device yet. It takes about two minutes to set '
        + 'up, and keeps your answers off anyone else\'s server.'
      : settled ? run.error
        : `Could not reach the examiner: ${run.error}`));
    const actions = el('div', 'row');
    if (run.error === 'not paired') {
      if (hasDefaultServer()) {
        actions.append(button('primary', 'Enable it', async () => {
          await pairWith();
          retry();
        }));
      }
      actions.append(button(hasDefaultServer() ? '' : 'primary',
        hasDefaultServer() ? 'Open Options' : 'Set it up in Options',
        () => chrome.runtime.openOptionsPage()));
    } else if (settled) {
      // Pressing Try again against a rejected key just spends another minute
      // being told the same thing. Send them where the fix is instead — and
      // keep a retry beside it, for once they are back.
      const target = AI_NOTICES[run.errorCode]?.target || 'ai';
      actions.append(button('primary', 'Open Options',
        () => openOptionsAt(target, { newTab: window.parent !== window })));
      actions.append(button('', 'Try again', retry));
    } else {
      // Retry re-sends the answer already sitting on the turn, so a dropped
      // request costs the connection and not the answer.
      actions.append(button('primary', 'Try again', retry));
    }
    actions.append(button('', 'Abandon this run', () => { run = null; showIntro(); }));
    box.append(actions);
    root.append(box);
  }

  const form = el('form', 'composer');
  const field = el('textarea');
  field.id = 'answer';
  field.rows = 3;
  field.placeholder = '用中文回答…';
  field.disabled = run.busy || !!run.error || !run.turns.length;
  const row = el('div', 'row');
  const send = el('button', 'primary', 'Send');
  send.type = 'submit';
  send.disabled = field.disabled;
  row.append(el('span', 'hint', 'Enter to send · Shift+Enter for a new line'), send);
  form.append(field, row);
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = field.value.trim();
    if (!text || run.busy) return;
    step(text);
  });
  field.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      form.requestSubmit();
    }
  });
  root.append(form);
  if (!field.disabled) field.focus();

  root.append(button('quit', 'Stop the interview', () => {
    // Stopping is not failing: the marks so far are real, and a run abandoned
    // at question eight is worth more than no placement at all. Only a run
    // with nothing in it is dropped outright.
    if (run.turns.some((t) => t.assess)) finishEarly();
    else { run = null; showIntro(); }
  }));
}

// Wrap up without another model call — the report is the one the marks
// already support, minus the examiner's written summary.
async function finishEarly() {
  run.finished = true;
  await complete({ result: null });
}

function retry() {
  const last = run.turns[run.turns.length - 1];
  run.error = '';
  run.errorCode = '';
  step(last && last.answer ? last.answer : '');
}

// --- the report -----------------------------------------------------------

function levelHeadline(result) {
  const box = el('div', 'headline');
  const value = el('div', 'level');
  if (result.level) {
    value.append(el('b', null, `HSK ${result.level}`));
    value.append(el('span', null, guideByLevel(result.level)?.band || ''));
  } else {
    value.append(el('b', null, 'Below HSK 1'));
  }
  box.append(value);

  const CONFIDENCE = {
    high: 'Confident — the interview found a level you held and a level you did not, with more than one question at each.',
    medium: 'Reasonably confident — a level you held and a level you did not, on one question apiece at the boundary.',
    low: 'Rough — the interview ended before it pinned down a boundary. Sit it again for a firmer number.',
  };
  box.append(el('p', 'confidence', CONFIDENCE[result.confidence] || ''));
  box.append(el('p', 'meta', [
    result.level
      ? `Highest level sustained over ${result.turns} questions`
      : `No level sustained over ${result.turns} questions`,
    result.comprehension != null ? `Understanding ${result.comprehension}/3` : '',
    result.production != null ? `Production ${result.production}/3` : '',
    fmtDate(result.at),
  ].filter(Boolean).join(' · ')));
  return box;
}

// Every correction the examiner wrote down, each with its own ☆. This is the
// point of keeping the marks per turn rather than one score: a placement that
// ends in a number tells you where you are, and a placement that ends in
// fifteen saveable corrections tells you what to do about it.
function corrections(result) {
  const found = [];
  for (const turn of result.transcript || []) {
    for (const error of turn.assess?.errors || []) {
      if (error.correction) found.push({ ...error, level: turn.level });
    }
  }
  if (!found.length) return null;

  const box = el('section');
  box.append(el('h3', null, `Corrections (${found.length})`));
  box.append(el('p', 'sub', 'Save any of these and it becomes a flashcard like any other.'));
  for (const error of found) {
    // Not .zwe-savable — the guides hide their stars until a row is hovered
    // because a guide is dense reference material you are mostly reading past.
    // Here there are a handful of rows and saving them is the entire point of
    // the section, so a control you have to go looking for is the wrong one.
    const item = el('div', 'fix');
    if (error.span) item.append(el('div', 'was', error.span));
    const fixed = lookup.hoverable('div', 'zh', error.correction);
    fixed.append(speakButton(error.correction));
    fixed.append(cards.control({ text: error.correction, unit: true }, {
      label: '☆',
      savedLabel: '✓',
      describe: error.correction,
    }));
    item.append(fixed);
    if (error.note) item.append(el('div', 'why', error.note));
    item.append(el('div', 'from', `HSK ${error.level}`));
    box.append(item);
  }
  return box;
}

function transcriptBlock(result) {
  const box = el('details', 'transcript');
  box.append(el('summary', null, 'Read the whole interview back'));
  for (const turn of result.transcript || []) {
    const wrap = el('div', 'turn');
    wrap.append(el('div', 'turn-level', `HSK ${turn.level}`));
    const asked = lookup.hoverable('div', 'zh', turn.prompt);
    asked.append(speakButton(turn.prompt));
    wrap.append(asked);
    if (turn.answer) wrap.append(el('div', 'said', turn.answer));
    if (turn.assess) {
      wrap.append(el('div', 'mark',
        `Understanding ${turn.assess.comprehension}/3 · `
        + `Production ${turn.assess.production}/3`));
      if (turn.assess.comment) wrap.append(el('div', 'why', turn.assess.comment));
    } else {
      // The final answer of a run is sent to be marked in the same call that
      // closes the interview; a run stopped early never sends it at all.
      wrap.append(el('div', 'mark', 'Not marked'));
    }
    box.append(wrap);
  }
  return box;
}

const levelName = (level) => (level ? `HSK ${level}` : 'Below HSK 1');
// Checked against the stored result rather than the displayed one: converting
// a report into the reading script leaves an empty transcript as an empty
// array, and an empty array is not the same answer as "never kept one".
const hasTranscript = (result) => Array.isArray(result?.transcript)
  && result.transcript.length > 0;

// What the sittings add up to, in a sentence. A number on its own cannot say
// whether the last six months did anything; two numbers and the gap between
// them can, and that is the whole reason the history is kept.
//
// A drop is reported as a drop. The honest gloss on one is that a placement is
// a measurement with noise in it — a bad afternoon, an unlucky topic — not
// that the learner went backwards, and saying so is not the same as hiding it.
function movementLine({ first, latest, change, sittings }) {
  if (change === null) return '';
  const span = `since ${fmtDate(first.at)}`;
  if (change > 0) {
    return `Up ${change} level${change === 1 ? '' : 's'} ${span}: `
      + `${levelName(first.level)} then, ${levelName(latest.level)} now, over ${sittings} sittings.`;
  }
  if (change === 0) {
    return `Still ${levelName(latest.level)} ${span}, over ${sittings} sittings. `
      + 'A level takes months of reading and reviewing to move — the deck is where '
      + 'the work shows up first.';
  }
  return `Down ${-change} level${change === -1 ? '' : 's'} ${span}: `
    + `${levelName(first.level)} then, ${levelName(latest.level)} now. `
    + 'One interview is a measurement with noise in it — an unlucky topic or a tired '
    + 'afternoon moves it a level. Sit it again before reading much into a drop.';
}

// Every sitting, oldest to newest, with each one openable. This is the part of
// the app that answers "is any of this working?" — the deck's counters go up
// whether or not the Chinese does, and the interview is the only thing here
// that measures rather than counts.
function historyBlock(results, current) {
  if (results.length < 2) return null;
  const box = el('section');
  box.append(el('h3', null, `Every placement (${results.length})`));
  const trail = progression(results);
  const moved = movementLine(trail);
  if (moved) box.append(el('p', 'sub', moved));

  const byTime = new Map(results.map((r) => [r.at, r]));
  box.append(levelTrend(trail.points, {
    onPick: (point) => {
      const picked = byTime.get(point.at);
      if (picked) showResult(picked, results);
    },
  }));

  const table = el('table', 'hist');
  for (const past of results) {
    const row = document.createElement('tr');
    if (past.at === current?.at) row.dataset.here = '1';
    const when = el('td', null);
    when.append(button('link', fmtDate(past.at), () => showResult(past, results)));
    row.append(
      when,
      el('td', 'lv', levelName(past.level)),
      el('td', null, `${past.turns} questions · ${past.confidence} confidence`
        // Old sittings keep their numbers but not their transcript, and a row
        // that opens onto a shorter report should say so before it is clicked.
        + (hasTranscript(past) ? '' : ' · numbers only')),
    );
    table.append(row);
  }
  box.append(table);
  return box;
}

async function showResult(stored, cached) {
  reading = true;
  standing = stored;
  const results = cached || await loadResults();
  const result = await inReadingScript(stored);
  // The latest sitting is where you stand; an older one is a thing you are
  // looking back at, and the page says which it is rather than presenting a
  // placement from March as though it were today's.
  const latest = !results.length || results[0].at === stored.at;
  const root = page(latest ? 'Your placement' : 'A past placement',
    latest ? '' : `Sat ${fmtDate(stored.at)} · your latest is further down`);
  root.append(levelHeadline(result));

  const actions = el('div', 'row actions');
  if (!latest) {
    actions.append(button('primary', 'Back to the latest',
      () => showResult(results[0], results)));
  }
  if (latest && result.level) {
    actions.append(button('primary', `Study HSK ${result.studyLevel}`, () => {
      chrome.storage.local.set({ hskLevel: result.studyLevel });
      // Inside the dashboard the frame asks the shell to switch tabs rather
      // than navigating, or the guides would load inside this frame.
      if (window.parent !== window) {
        window.parent.postMessage({ type: 'zx-open', view: 'guides' }, '*');
      } else {
        location.href = 'hsk.html';
      }
    }));
  }
  actions.append(button('', 'Sit it again', start));
  root.append(actions);

  root.append(levelLadder(result.perLevel, { here: result.level }));

  if (result.report) {
    const box = el('section');
    box.append(el('h3', null, 'What the examiner said'));
    if (result.report.summary) box.append(el('p', null, result.report.summary));
    for (const [heading, items] of [
      ['Holding up', result.report.strengths],
      ['Coming apart', result.report.gaps],
      ['Worth working on', result.report.advice],
    ]) {
      if (!items || !items.length) continue;
      box.append(el('div', 'list-head', heading));
      const list = el('ul', 'plain');
      for (const line of items) list.append(el('li', null, line));
      box.append(list);
    }
    root.append(box);
  }

  const fixes = corrections(result);
  if (fixes) root.append(fixes);
  // Sittings past the most recent few keep their numbers and lose their
  // transcript, so there is a report to open for every interview ever sat
  // without the storage growing without bound. Say which one this is.
  if (hasTranscript(stored)) root.append(transcriptBlock(result));
  else if (!latest) {
    root.append(el('p', 'gone',
      'The questions and answers from this interview are no longer kept — only '
      + 'the marks it produced. The last twenty sittings keep theirs in full.'));
  }
  const history = historyBlock(results, stored);
  if (history) root.append(history);
}

// ---------------------------------------------------------------------------

function render() {
  if (run) renderInterview();
}

async function start() {
  const { wordlist = [] } = await chrome.storage.local.get('wordlist');
  const { hskLevel } = await chrome.storage.local.get('hskLevel');
  const [previous] = await loadResults();
  // Where to open: the last placement if there is one, otherwise whichever
  // guide they have been reading, otherwise the middle of the scale.
  const startLevel = previous?.level || hskLevel || 3;
  standing = null;
  run = newRun(Math.min(MAX_LEVEL, Math.max(MIN_LEVEL, startLevel)), buildProfile(wordlist));
  render();
  step();
}

// The toggle repaints what is on screen, the same as everywhere else it
// appears: a question already asked, or a report already sat.
onHanziPref(async (pref) => {
  hanziPref = pref;
  if (run) {
    await reshowTurns();
    render();
  } else if (standing) {
    showResult(standing);
  }
});

// The preference has to be in hand before the first paint: a standing report
// is drawn in the learner's script, not redrawn into it a moment later.
async function boot() {
  hanziPref = await getHanziPref();
  showIntro();
}

boot();
