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
  estimate, planNext, rubricFor, loadResults, saveResult,
} from './lib/placement.js';
import { buildProfile } from './lib/profile.js';
import { levelLadder } from './lib/progress.js';
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
// The run in progress
// ---------------------------------------------------------------------------

// turns: one per task asked, in order.
//   { level, taskType, prompt, answer, assess }
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
    answer: '',
    assess: null,
  });
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
    bubble.append(lookup.hoverable('div', 'zh', turn.prompt));
    bubble.append(speakButton(turn.prompt));
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

function historyBlock(results) {
  if (results.length < 2) return null;
  const box = el('section');
  box.append(el('h3', null, 'Previous placements'));
  const table = el('table', 'hist');
  for (const past of results.slice(1)) {
    const row = document.createElement('tr');
    row.append(
      el('td', null, fmtDate(past.at)),
      el('td', 'lv', past.level ? `HSK ${past.level}` : 'Below HSK 1'),
      el('td', null, `${past.turns} questions · ${past.confidence} confidence`),
    );
    table.append(row);
  }
  box.append(table);
  return box;
}

async function showResult(result, cached) {
  reading = true;
  const results = cached || await loadResults();
  const root = page('Your placement', '');
  root.append(levelHeadline(result));

  const actions = el('div', 'row actions');
  if (result.level) {
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
  root.append(transcriptBlock(result));
  const history = historyBlock(results);
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
  run = newRun(Math.min(MAX_LEVEL, Math.max(MIN_LEVEL, startLevel)), buildProfile(wordlist));
  render();
  step();
}

showIntro();
