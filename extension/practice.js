// Pronunciation practice: a free-form drill over your saved flashcards that is
// deliberately independent of the spaced-repetition system. You can record a
// card as many times as you like, shuffle, and filter — nothing here ever
// writes SRS state.
//
// The mic is captured with getUserMedia (a live level meter proves it's
// working), then the recording is sent through the sync Worker to Azure AI
// Speech Pronunciation Assessment, which scores each Mandarin syllable —
// including tone — and returns per-word accuracy. That's the purpose-built,
// known-good grader; the Worker holds the key so no audio touches a third
// party the user hasn't set up themselves.

import { encodeWav, resample } from './lib/wav.js';
import { getSyncMeta } from './lib/sync.js';
import { createLookup } from './lib/lookup.js';

const { createSelectionBar } = globalThis.ZhongwenSaveCard;

const CJK_RE = /[㐀-鿿豈-﫿]|[\ud840-\ud87f][\udc00-\udfff]/;

if (new URLSearchParams(location.search).has('embedded')) {
  document.body.classList.add('embedded');
}

// The card here is a pronunciation prompt, not a meaning test, so the
// definition is never the answer being withheld — hovering always defines.
const lookup = createLookup({
  getEnabled: () => !selectionBar.isOpen(),
  hoverTitle: 'Hover for definition, examples, and related words',
});

// No tutor on this page, so the selection bar carries the one action: save the
// highlighted phrase. Drilling a sentence often turns up a chunk of it worth
// learning on its own.
const selectionBar = createSelectionBar({ root: () => appEl, lookup });

const appEl = document.getElementById('app');
const keyhintEl = document.getElementById('keyhint');

let allWords = []; // full saved list, newest first
let deck = []; // current filtered (and maybe shuffled) practice order
let pos = 0; // index into deck
let filter = 'all'; // 'all' | 'word' | 'sentence'
let shuffled = false;
let showPinyin = true;
let mic = null; // active capture session (getUserMedia + Web Audio graph)
let pronounceSeq = 0; // invalidates a capture/result after the card changes
const session = { attempts: 0, scored: 0, sumPron: 0 };

function el(tag, className, text) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}

// ---------------------------------------------------------------------------
// Data + deck management
// ---------------------------------------------------------------------------

async function loadWords() {
  const { wordlist = [] } = await chrome.storage.local.get('wordlist');
  return wordlist;
}

function matchesFilter(word) {
  const type = word.cardType || 'word';
  return filter === 'all' || filter === type;
}

function buildDeck(keepCurrentSimp) {
  const current = deck[pos];
  deck = allWords.filter(matchesFilter);
  if (shuffled) {
    for (let i = deck.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [deck[i], deck[j]] = [deck[j], deck[i]];
    }
  }
  // Try to stay on the same card across a filter/shuffle change when asked.
  pos = 0;
  if (keepCurrentSimp && current) {
    const same = deck.findIndex((w) => w === current);
    if (same !== -1) pos = same;
  }
}

// ---------------------------------------------------------------------------
// Microphone capture (Web Audio) + tone grading
// ---------------------------------------------------------------------------

const MAX_RECORD_MS = 5000; // hard cap on a single take
const TRAIL_SILENCE_MS = 700; // auto-stop this long after the last voice
const VOICE_LEVEL = 0.03; // RMS above this counts as "speaking"

const STATUS_LABEL = {
  good: 'Well pronounced',
  warn: 'Needs work',
  miss: 'Poor / not heard',
};

// Fully tear down any in-flight capture and invalidate its pending result.
function stopPronounce() {
  pronounceSeq++;
  const m = mic;
  mic = null;
  if (!m) return;
  if (m.raf) cancelAnimationFrame(m.raf);
  try { m.processor.disconnect(); } catch { /* noop */ }
  try { m.source.disconnect(); } catch { /* noop */ }
  try { m.zero.disconnect(); } catch { /* noop */ }
  if (m.stream) for (const t of m.stream.getTracks()) t.stop();
  if (m.ctx && m.ctx.state !== 'closed') m.ctx.close().catch(() => {});
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

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

// Hanzi as one span per code point so a grade result can recolor each
// character in place. Tone colors are applied when the saved tone list lines
// up with the characters (always true for words; punctuation-free sentences).
function buildHanzi(word) {
  const sentence = (word.cardType || 'word') === 'sentence';
  const wrap = el('div', `hanzi${sentence ? ' sentence' : ''}`);
  const chars = Array.from(word.simp);
  const tones = String(word.tones || '').split(',').map(Number);
  const canTone = tones.length === chars.length && tones.every((t) => t >= 0 && t <= 5);
  const spans = [];
  chars.forEach((ch, i) => {
    if (!CJK_RE.test(ch)) {
      wrap.append(document.createTextNode(ch));
      spans.push(null);
      return;
    }
    const span = el('span', canTone ? `tone${tones[i]}` : '', ch);
    wrap.append(span);
    spans.push(span);
  });
  // Reuse these very spans for hover lookups rather than nesting a second set
  // inside them — a grade result recolors them in place.
  lookup.attach({ text: word.simp, spans });
  return { wrap, spans };
}

function pinyinEl(word) {
  const wrap = el('div', 'pinyin');
  const syls = String(word.pinyin || '').split(' ');
  const tones = String(word.tones || '').split(',').map(Number);
  if (tones.length === syls.length && tones.every((t) => t >= 0 && t <= 5)) {
    syls.forEach((s, i) => {
      if (i > 0) wrap.append(' ');
      wrap.append(el('span', `tone${tones[i]}`, s));
    });
  } else {
    wrap.textContent = word.pinyin || '';
  }
  return wrap;
}

function sessionLine() {
  if (!session.attempts) {
    return el('p', 'session', 'No attempts yet this session — press record and speak.');
  }
  const line = el('p', 'session');
  line.append(
    'This session: ', el('b', '', String(session.attempts)),
    ` attempt${session.attempts === 1 ? '' : 's'}`,
  );
  if (session.scored) {
    const avg = Math.round(session.sumPron / session.scored);
    line.append(' · avg ', el('b', '', `${avg}`), ' / 100');
  }
  return line;
}

function segButton(label, value, current, onPick) {
  const b = el('button', value === current ? 'active' : '', label);
  b.addEventListener('click', () => onPick(value));
  return b;
}

function renderControls() {
  const bar = el('div', 'bar');

  const seg = el('div', 'seg');
  const counts = {
    all: allWords.length,
    word: allWords.filter((w) => (w.cardType || 'word') === 'word').length,
    sentence: allWords.filter((w) => w.cardType === 'sentence').length,
  };
  seg.append(
    segButton(`All (${counts.all})`, 'all', filter, pickFilter),
    segButton(`Words (${counts.word})`, 'word', filter, pickFilter),
    segButton(`Sentences (${counts.sentence})`, 'sentence', filter, pickFilter),
  );
  bar.append(seg);

  const shuffle = el('button', 'chip', shuffled ? '🔀 Shuffled' : '🔀 Shuffle');
  shuffle.addEventListener('click', () => {
    shuffled = !shuffled;
    stopPronounce();
    buildDeck(false);
    render();
  });
  bar.append(shuffle);

  const pinyinToggle = el('button', 'chip', showPinyin ? '🅿 Hide pinyin' : '🅿 Show pinyin');
  pinyinToggle.addEventListener('click', () => {
    showPinyin = !showPinyin;
    render();
  });
  bar.append(pinyinToggle);

  bar.append(el('div', 'spacer'));
  if (deck.length) bar.append(el('div', 'counter', `${pos + 1} / ${deck.length}`));
  return bar;
}

function pickFilter(value) {
  if (filter === value) return;
  filter = value;
  stopPronounce();
  buildDeck(true);
  render();
}

function go(delta) {
  if (!deck.length) return;
  stopPronounce();
  pos = (pos + delta + deck.length) % deck.length;
  render();
}

// The record button: capture the mic (with a live level meter so you can see
// it working), then grade the recorded pitch contour against the card's tones.
function recordSection(word, hanziSpans) {
  const canRecord = !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia &&
    (window.AudioContext || window.webkitAudioContext));
  const row = el('div', 'rec-row');
  const button = el('button', 'rec-btn', '🎙 Record');
  row.append(button);
  const meter = el('div', 'meter');
  const meterFill = el('div', 'meter-fill');
  meter.append(meterFill);
  meter.hidden = true;
  const status = el('div', 'rec-status');
  const result = el('div', 'result');
  const wrap = el('div');
  wrap.append(row, meter, status, result);

  if (!canRecord) {
    button.disabled = true;
    status.textContent = "This browser can't record audio for the pronunciation check.";
    return { wrap, start: () => {} };
  }

  const start = async () => {
    // A second click while recording stops early and grades what we have.
    if (mic && mic.button === button) { mic.finish('stopped'); return; }
    if (button.disabled) return;

    stopPronounce();
    const seq = pronounceSeq;
    result.replaceChildren();
    button.disabled = true;
    status.textContent = 'Preparing…';

    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err) {
      if (seq !== pronounceSeq) return;
      status.textContent = err && err.name === 'NotAllowedError'
        ? 'Microphone blocked. Allow mic access for this page, then retry.'
        : err && err.name === 'NotFoundError'
          ? 'No microphone was found.'
          : 'Could not open the microphone.';
      button.disabled = false;
      return;
    }
    if (seq !== pronounceSeq) { for (const t of stream.getTracks()) t.stop(); return; }

    const Ctx = window.AudioContext || window.webkitAudioContext;
    const ctx = new Ctx();
    ctx.resume().catch(() => {}); // a context created off a click may start suspended
    const source = ctx.createMediaStreamSource(stream);
    const processor = ctx.createScriptProcessor(4096, 1, 1);
    const zero = ctx.createGain();
    zero.gain.value = 0; // keep the processor pulling audio without echoing it
    source.connect(processor);
    processor.connect(zero);
    zero.connect(ctx.destination);

    const chunks = [];
    const startedAt = performance.now();
    let lastVoiceAt = 0;
    let sawVoice = false;
    let level = 0;

    const capture = { button, stream, ctx, source, processor, zero, raf: 0,
      finished: false };
    mic = capture;

    const finish = (reason) => {
      if (capture.finished) return;
      capture.finished = true;
      if (capture.raf) cancelAnimationFrame(capture.raf);
      try { processor.disconnect(); } catch { /* noop */ }
      try { source.disconnect(); } catch { /* noop */ }
      try { zero.disconnect(); } catch { /* noop */ }
      for (const t of stream.getTracks()) t.stop();
      const sr = ctx.sampleRate;
      ctx.close().catch(() => {});
      if (mic === capture) mic = null;
      if (seq !== pronounceSeq) return; // card changed mid-take
      button.classList.remove('live');
      meter.hidden = true;
      button.disabled = false;
      button.textContent = '🎙 Record again';
      gradeTake({ chunks, sampleRate: sr, refText: word.simp, hanziSpans,
        resultEl: result, statusEl: status, seq });
    };
    capture.finish = finish;

    processor.onaudioprocess = (e) => {
      const input = e.inputBuffer.getChannelData(0);
      chunks.push(new Float32Array(input));
      let sum = 0;
      for (let i = 0; i < input.length; i++) sum += input[i] * input[i];
      level = Math.sqrt(sum / input.length);
      if (level >= VOICE_LEVEL) { sawVoice = true; lastVoiceAt = performance.now(); }
    };

    meter.hidden = false;
    button.disabled = false; // allow click-to-stop
    button.classList.add('live');
    button.textContent = '■ Stop';
    status.textContent = 'Listening… say it aloud, then press stop';

    const tick = () => {
      if (capture.finished) return;
      meterFill.style.width = `${Math.min(100, Math.round(level * 320))}%`;
      meterFill.classList.toggle('hot', level >= VOICE_LEVEL);
      const now = performance.now();
      if (now - startedAt >= MAX_RECORD_MS) { finish('max'); return; }
      if (sawVoice && now - lastVoiceAt >= TRAIL_SILENCE_MS) { finish('silence'); return; }
      capture.raf = requestAnimationFrame(tick);
    };
    capture.raf = requestAnimationFrame(tick);
  };

  button.addEventListener('click', start);
  return { wrap, start };
}

// Assemble the take, ship it to the Worker for scoring, and render the result.
async function gradeTake({ chunks, sampleRate, refText, hanziSpans, resultEl, statusEl, seq }) {
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const raw = new Float32Array(total);
  let off = 0;
  for (const c of chunks) { raw.set(c, off); off += c.length; }

  const TARGET_SR = 16000;
  const samples = resample(raw, sampleRate, TARGET_SR);
  if (samples.length < TARGET_SR * 0.25) {
    statusEl.textContent = 'That was too short — hold the button and say the whole card.';
    return;
  }

  const meta = await getSyncMeta();
  if (seq !== pronounceSeq) return;
  if (!meta || !meta.token || !meta.serverUrl) {
    statusEl.textContent = '';
    resultEl.replaceChildren(pairPrompt());
    return;
  }

  statusEl.textContent = 'Scoring your pronunciation…';
  const wav = encodeWav(samples, TARGET_SR);
  const base = meta.serverUrl.replace(/\/+$/, '');
  let res;
  let data;
  try {
    res = await fetch(`${base}/api/pronounce?text=${encodeURIComponent(refText)}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${meta.token}`, 'content-type': 'audio/wav' },
      body: wav,
    });
    data = await res.json().catch(() => ({}));
  } catch {
    if (seq !== pronounceSeq) return;
    statusEl.textContent = "Couldn't reach the scoring server — check your connection.";
    return;
  }
  if (seq !== pronounceSeq) return;

  if (!res.ok) {
    statusEl.textContent = res.status === 503
      ? "Pronunciation scoring isn't set up on your server yet — see Options."
      : (data && data.error) || `Scoring failed (${res.status}).`;
    return;
  }
  if (!data.recognized) {
    statusEl.textContent = "Didn't catch that — speak clearly and a bit louder, then try again.";
    return;
  }
  statusEl.textContent = '';
  renderScore(data, hanziSpans, resultEl);
}

// Color the card's hanzi from Azure's per-word scores and show the numbers.
function renderScore(data, hanziSpans, resultEl) {
  const perChar = [];
  for (const w of data.words) {
    for (const ch of Array.from(w.word || '')) {
      perChar.push({ ch, status: w.status || 'miss', accuracy: w.accuracy });
    }
  }
  let p = 0;
  hanziSpans.forEach((span) => {
    if (!span) return;
    span.classList.remove('tone1', 'tone2', 'tone3', 'tone4', 'tone5');
    const info = perChar[p++];
    const s = (info && info.status) || 'miss';
    span.className = `pron-char pron-${s}`;
    span.title = info && info.accuracy != null
      ? `${STATUS_LABEL[s]} — ${info.accuracy}/100` : STATUS_LABEL[s];
  });

  const ov = data.overall || {};
  const pron = ov.pron != null ? Math.round(ov.pron) : null;
  session.attempts += 1;
  if (pron != null) { session.scored += 1; session.sumPron += pron; }

  const summary = el('div', 'result-summary');
  if (pron != null) summary.append('Overall ', el('b', '', String(pron)), ' / 100');
  else summary.textContent = 'Scored';

  const chips = el('div', 'word-scores');
  for (const w of data.words) {
    const chip = el('span', `word-chip pron-${w.status || 'miss'}`);
    chip.append(el('span', 'word-chip-han', w.word));
    if (w.accuracy != null) chip.append(el('span', 'word-chip-score', String(w.accuracy)));
    chips.append(chip);
  }

  const bits = [];
  if (ov.accuracy != null) bits.push(`accuracy ${Math.round(ov.accuracy)}`);
  if (ov.fluency != null) bits.push(`fluency ${Math.round(ov.fluency)}`);
  if (ov.completeness != null) bits.push(`completeness ${Math.round(ov.completeness)}`);
  if (data.display) bits.push(`heard “${data.display}”`);

  resultEl.replaceChildren(summary, chips, el('div', 'result-heard', bits.join(' · ')));
  const line = document.getElementById('sessionLine');
  if (line) line.replaceWith(withId(sessionLine(), 'sessionLine'));
}

function pairPrompt() {
  const box = el('div', 'pair-prompt');
  box.append(el('div', '', 'Pronunciation scoring runs through your own private sync server.'));
  const link = el('a', '', 'Set up sync in Options →');
  link.href = 'options.html';
  box.append(link);
  return box;
}

function withId(node, id) {
  node.id = id;
  return node;
}

function render() {
  stopPronounce();
  lookup.hide(); // the card it was anchored to is about to be replaced
  selectionBar.hide();
  appEl.replaceChildren();
  keyhintEl.hidden = !deck.length;

  appEl.append(renderControls());

  if (!allWords.length) {
    appEl.append(el('p', 'empty',
      'No saved cards yet. Save words or example sentences while reading, then come back to drill your pronunciation.'));
    return;
  }
  if (!deck.length) {
    appEl.append(el('p', 'empty', 'No cards match this filter.'));
    return;
  }

  appEl.append(withId(sessionLine(), 'sessionLine'));

  const word = deck[pos];
  const card = el('div', 'card');
  if ((word.cardType || 'word') === 'sentence') card.append(el('div', 'card-type', 'Sentence'));

  const { wrap: hanzi, spans } = buildHanzi(word);
  card.append(hanzi);

  if (showPinyin) {
    const line = el('div', 'answer-line');
    line.append(pinyinEl(word), speakButton(word.simp));
    card.append(line);
  } else {
    const line = el('div', 'answer-line');
    line.append(speakButton(word.simp));
    card.append(line);
  }
  if (word.defs) card.append(el('div', 'defs', word.defs));

  const recorder = recordSection(word, spans);
  card.append(recorder.wrap);
  card._startRecording = recorder.start;

  const legend = el('div', 'legend');
  legend.append(
    withText(el('i', 'pron-good'), 'good'),
    withText(el('i', 'pron-warn'), 'needs work'),
    withText(el('i', 'pron-miss'), 'poor / missed'),
  );
  card.append(legend);
  card.append(el('div', 'privacy',
    'Scored by Azure speech assessment through your own sync server.'));

  appEl.append(card);

  const footer = el('div', 'footer');
  const prev = el('button', '', '← Previous');
  prev.addEventListener('click', () => go(-1));
  const next = el('button', '', 'Next →');
  next.addEventListener('click', () => go(1));
  footer.append(prev, next);
  appEl.append(footer);
}

function withText(node, text) {
  node.textContent = text;
  return node;
}

// ---------------------------------------------------------------------------
// Keyboard + init
// ---------------------------------------------------------------------------

document.addEventListener('keydown', (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  if (!deck.length) return;
  const key = e.key.toLowerCase();
  if (e.key === ' ' || e.key === 'Enter') {
    e.preventDefault();
    const card = appEl.querySelector('.card');
    if (card && card._startRecording) card._startRecording();
  } else if (e.key === 'ArrowRight') {
    e.preventDefault();
    go(1);
  } else if (e.key === 'ArrowLeft') {
    e.preventDefault();
    go(-1);
  } else if (key === 'l') {
    e.preventDefault();
    chrome.runtime.sendMessage({ type: 'speak', text: deck[pos].simp, slow: e.shiftKey });
  }
});

async function init() {
  allWords = await loadWords();
  buildDeck(false);
  render();
}

init();
