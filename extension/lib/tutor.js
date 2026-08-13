// The tutor panel — one chat, mounted wherever a question makes sense.
//
// Same component on every surface: the HSK guides dock it as a sidebar, the
// review card and the news digest open it as a drawer. It owns its own markup,
// styling, conversation storage, and the call to the Worker's /api/ask, so a
// page only has to say WHAT the learner is looking at.
//
// Highlight-to-ask comes along with it: highlight text and "Ask about this"
// appears among the actions on the shared selection bar (lib/savecard.js),
// beside ☆ Save. One highlight raises one bar; the tutor contributes to it
// rather than floating a second bubble of its own over the first. The chosen
// passage is then tracked with the CSS Custom Highlight API so it never
// disturbs the hoverable spans underneath.

import { DEFAULT_SERVER_URL, aiHeaders, getSyncMeta, newToken } from './sync.js';

const HIGHLIGHT_NAME = 'tutor-quote';
const QUOTE_LIMIT = 1200;   // matches the Worker's selection cap
const MAX_HISTORY = 12;     // turns kept per thread, on disk and on the wire
const MAX_THREADS = 30;     // conversations retained before the oldest is dropped
const STORE_KEY = 'tutorChats';

const TUTOR_CSS = `
  .tutor {
    display: flex; flex-direction: column; min-height: 0;
    background: #faf8f2; color: #222; text-align: left;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    font-size: 15px;
  }
  .tutor[hidden] { display: none !important; }
  .tutor-docked { height: 100%; border-left: 1px solid #e6e0d2; }
  .tutor-drawer {
    position: fixed; top: 0; right: 0; bottom: 0; width: min(370px, 100vw);
    z-index: 2147483646; border-left: 1px solid #ddd5c4;
    box-shadow: -6px 0 26px rgba(60, 48, 24, 0.16);
  }
  .tutor-head {
    flex: none; display: flex; align-items: flex-start; gap: 8px;
    padding: 13px 16px 10px; border-bottom: 1px solid #eae4d6;
  }
  .tutor-head-text { flex: 1; min-width: 0; }
  .tutor-head b { display: block; font-size: 14px; }
  .tutor-head span { color: #999; font-size: 11.5px; }
  .tutor-close {
    flex: none; padding: 2px 7px; border: 1px solid #ddd5c4; border-radius: 7px;
    background: #fff; color: #777; font: inherit; font-size: 13px; cursor: pointer;
  }
  .tutor-close:hover { background: #f3efe4; color: #b5232b; }
  .tutor-log { flex: 1; min-height: 0; overflow-y: auto; padding: 14px 16px; }
  .tutor .msg { margin-bottom: 12px; font-size: 13.5px; line-height: 1.55; }
  .tutor .msg.user { text-align: right; }
  .tutor .msg.user .bubble {
    display: inline-block; max-width: 90%; padding: 7px 11px;
    border-radius: 12px 12px 3px 12px; background: #ece4d0; text-align: left;
  }
  .tutor .msg.bot .bubble {
    padding: 9px 12px; border: 1px solid #e8e1d5; border-radius: 12px 12px 12px 3px;
    background: #fff;
  }
  .tutor .msg.bot .bubble p { margin: 0 0 7px; }
  .tutor .msg.bot .bubble p:last-child { margin-bottom: 0; }
  .tutor .msg .quoted {
    margin-bottom: 5px; padding: 4px 8px; border-left: 2px solid #c9a55c;
    border-radius: 0 5px 5px 0; background: rgba(201, 165, 92, 0.13);
    color: #6d5c34; font-size: 12px; line-height: 1.45;
  }
  .tutor .msg.err .bubble { border-color: #e2b8b8; background: #fdf4f4; color: #8f1c23; }
  .tutor .thinking { color: #999; font-size: 13px; font-style: italic; }
  .tutor .starters { display: flex; flex-direction: column; gap: 6px; margin-top: 10px; }
  .tutor .starter {
    padding: 7px 10px; border: 1px solid #e3dbc9; border-radius: 9px;
    background: #fff; color: #555; font: inherit; font-size: 12.5px; text-align: left;
    line-height: 1.4; cursor: pointer;
  }
  .tutor .starter:hover { border-color: #d0bf98; background: #fffdf3; }
  .tutor .tutor-empty { color: #8d8878; font-size: 13px; line-height: 1.55; }
  .tutor-composer { flex: none; padding: 10px 12px 12px; border-top: 1px solid #eae4d6; }
  .tutor .quote-chip {
    display: flex; align-items: flex-start; gap: 6px; margin-bottom: 7px;
    padding: 6px 8px; border-left: 2px solid #c9a55c; border-radius: 0 6px 6px 0;
    background: rgba(201, 165, 92, 0.15);
  }
  .tutor .quote-chip[hidden] { display: none !important; }
  .tutor .quote-chip .text {
    flex: 1; min-width: 0; max-height: 54px; overflow: hidden;
    color: #6d5c34; font-size: 12px; line-height: 1.45;
  }
  .tutor .quote-chip .drop {
    flex: none; padding: 0 5px; border: 0; background: transparent;
    color: #8a7a58; font: inherit; font-size: 14px; line-height: 1.2; cursor: pointer;
  }
  .tutor textarea {
    width: 100%; height: 62px; padding: 8px 10px; border: 1px solid #ddd5c4;
    border-radius: 9px; background: #fff; color: #222; font: inherit;
    font-size: 13.5px; resize: none;
  }
  .tutor textarea:focus { outline: 2px solid #e6d9b2; outline-offset: -1px; }
  .tutor-row { display: flex; align-items: center; gap: 8px; margin-top: 7px; }
  .tutor-row .hint { flex: 1; color: #aaa; font-size: 11px; }
  .tutor .send {
    padding: 6px 13px; border: 1px solid #c9b08a; border-radius: 8px;
    background: #fdf6c7; color: #7f1920; font: inherit; font-size: 13px;
    font-weight: 650; cursor: pointer;
  }
  .tutor .send:disabled { opacity: 0.55; cursor: default; }

  .tutor-launcher {
    position: fixed; right: 18px; bottom: 18px; z-index: 2147483645;
    padding: 9px 16px; border: 1px solid #c9b08a; border-radius: 999px;
    background: #fdf6c7; color: #7f1920;
    box-shadow: 0 3px 14px rgba(60, 48, 24, 0.2);
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    font-size: 13px; font-weight: 650; cursor: pointer;
  }
  .tutor-launcher:hover { background: #fdf0a8; }
  .tutor-launcher[hidden] { display: none !important; }
  /* Narrow the document rather than letting the drawer sit on top of it —
     otherwise it covers the grade buttons on a small window. The drawer is
     fixed to the viewport, so it stays put. */
  html.tutor-drawer-open { width: calc(100% - min(370px, 100vw)); }
  ::highlight(tutor-quote) {
    background-color: rgba(201, 165, 92, 0.35);
    text-decoration: underline 2px rgba(160, 122, 40, 0.7);
    text-underline-offset: 3px;
  }
`;

let cssInjected = false;
function injectCss() {
  if (cssInjected) return;
  cssInjected = true;
  const style = document.createElement('style');
  style.textContent = TUTOR_CSS;
  document.head.append(style);
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

// Conversations live in one record so pruning is possible; per-thread keys
// would grow without bound as you review card after card.
async function loadThread(key) {
  const { [STORE_KEY]: store = {} } = await chrome.storage.local.get(STORE_KEY);
  const thread = store[key];
  return Array.isArray(thread?.messages) ? thread.messages : [];
}

async function saveThread(key, messages) {
  const { [STORE_KEY]: store = {} } = await chrome.storage.local.get(STORE_KEY);
  store[key] = { at: Date.now(), messages: messages.slice(-MAX_HISTORY) };
  const keys = Object.keys(store);
  if (keys.length > MAX_THREADS) {
    keys.sort((a, b) => (store[b].at || 0) - (store[a].at || 0));
    for (const stale of keys.slice(MAX_THREADS)) delete store[stale];
  }
  await chrome.storage.local.set({ [STORE_KEY]: store });
}

async function postAsk(meta, payload) {
  const res = await fetch(`${meta.serverUrl.replace(/\/+$/, '')}/api/ask`, {
    method: 'POST',
    headers: await aiHeaders(meta),
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok || !data || data.error) {
    throw new Error(data?.detail || data?.error || `server error (http ${res.status})`);
  }
  return data;
}

// Mount a tutor panel.
//
//   mode          'docked' (fills `container`) or 'drawer' (slides over the
//                 right edge, with a launcher button)
//   container     required for docked mode
//   lookup        a createLookup() instance, so Chinese in answers is hoverable
//   title/subtitle  panel header
//   launcher      drawer button label
//   selectionBar  a createSelectionBar() instance to hang "Ask about this" on;
//                 omit for no highlight-to-ask. The tutor raises a second bar
//                 over its own replies, so an answer can be asked about in
//                 turn without the page arranging anything.
//   startAvailable  false for surfaces that have to earn it (a review card
//                 offers the tutor only once the answer is showing). Default
//                 true, so a page that never gates the tutor gets a working
//                 one without having to remember to switch it on.
//   sectionFor    (node) -> { section, text } describing where a selection sits
//   context       () -> { level?, where?, section?, text? } for the question
//   starters      () -> [string] suggested opening questions
//   intro         () -> string shown above the starters
//   threadKey     () -> string identifying the conversation
export function createTutor(options) {
  const {
    mode = 'drawer', container = null, lookup = null,
    title = 'Ask a question', subtitle = '',
    launcher = '💬 Ask', selectionBar = null, sectionFor = null,
    context = () => ({}), starters = () => [], intro = () => '',
    threadKey = () => 'default', startAvailable = true,
  } = options;

  injectCss();

  const root = el('aside', `tutor tutor-${mode}`);
  const head = el('div', 'tutor-head');
  const headText = el('div', 'tutor-head-text');
  const titleEl = el('b', null, title);
  const subtitleEl = el('span', null, subtitle);
  headText.append(titleEl, subtitleEl);
  head.append(headText);

  const logEl = el('div', 'tutor-log');
  logEl.id = 'chatLog';

  const composerEl = el('form', 'tutor-composer');
  composerEl.id = 'composer';
  const quoteChipEl = el('div', 'quote-chip');
  quoteChipEl.id = 'quoteChip';
  quoteChipEl.hidden = true;
  const quoteTextEl = el('div', 'text');
  quoteTextEl.id = 'quoteText';
  const quoteDropEl = el('button', 'drop', '✕');
  quoteDropEl.id = 'quoteDrop';
  quoteDropEl.type = 'button';
  quoteDropEl.title = 'Stop pointing at this';
  quoteDropEl.setAttribute('aria-label', 'Remove the highlighted passage');
  quoteChipEl.append(quoteTextEl, quoteDropEl);

  const questionEl = el('textarea');
  questionEl.id = 'question';
  questionEl.rows = 3;
  questionEl.placeholder = 'Ask about a word, a grammar point, or usage…';
  const row = el('div', 'tutor-row');
  const sendEl = el('button', 'send', 'Ask');
  sendEl.id = 'send';
  sendEl.type = 'submit';
  row.append(el('span', 'hint', 'Enter to send'), sendEl);
  composerEl.append(quoteChipEl, questionEl, row);

  root.append(head, logEl, composerEl);

  let launcherEl = null;
  if (mode === 'drawer') {
    const closeEl = el('button', 'tutor-close', '✕');
    closeEl.type = 'button';
    closeEl.title = 'Close';
    closeEl.setAttribute('aria-label', 'Close the tutor');
    closeEl.addEventListener('click', () => close());
    head.append(closeEl);
    root.hidden = true;
    launcherEl = el('button', 'tutor-launcher', launcher);
    launcherEl.id = 'tutorLauncher';
    launcherEl.type = 'button';
    launcherEl.hidden = !startAvailable;
    launcherEl.addEventListener('click', () => open());
    document.body.append(launcherEl);
    document.body.append(root);
  } else {
    (container || document.body).append(root);
  }

  let history = [];
  let quote = null;      // { text, section, context }
  let busy = false;
  let currentKey = null;
  let available = startAvailable; // the host page can hide the whole thing

  // -------------------------------------------------------------------------
  // Pointing at text
  // -------------------------------------------------------------------------

  function paintQuote(range) {
    if (!('highlights' in CSS)) return;
    try {
      CSS.highlights.set(HIGHLIGHT_NAME, new Highlight(range.cloneRange()));
    } catch {
      /* stale range; the chip still shows the text */
    }
  }

  function clearPaint() {
    if ('highlights' in CSS) CSS.highlights.delete(HIGHLIGHT_NAME);
  }

  function clearQuote() {
    quote = null;
    quoteChipEl.hidden = true;
    quoteTextEl.textContent = '';
    clearPaint();
  }

  // Where a highlight came from. Text inside the log is part of the
  // conversation, so a follow-up carries the reply it came out of rather than
  // whatever the page happens to be showing.
  function describeSelection(node) {
    const start = node.nodeType === Node.TEXT_NODE ? node.parentElement : node;
    if (start && logEl.contains(start)) {
      const message = start.closest('.msg');
      return {
        section: 'your own previous answer',
        text: message ? message.textContent.replace(/\s+/g, ' ').trim().slice(0, 4000) : '',
      };
    }
    return sectionFor ? sectionFor(node) : { section: '', text: '' };
  }

  function attachQuote(picked) {
    const around = describeSelection(picked.range.startContainer);
    const text = picked.text.slice(0, QUOTE_LIMIT);
    quote = { text, section: around.section || '', context: around.text || '' };
    quoteTextEl.textContent = text;
    quoteChipEl.hidden = false;
    paintQuote(picked.range);
    // The mark is an independent range, so drop the live selection: it has done
    // its job, and keeping it would leave the page in "selecting" mode with
    // hover lookups suppressed. Dropping it also closes the bar.
    window.getSelection()?.removeAllRanges();
    selectionBar?.hide();
    logBar?.hide();
    open();
    questionEl.focus();
  }

  const askAction = {
    key: 'ask',
    label: 'Ask about this ↗',
    title: 'Ask the tutor about the highlighted text',
    prepare: async () => (available ? {} : { hidden: true }),
    run: (picked) => attachQuote(picked),
  };

  // Highlight-to-ask is one action on the page's shared selection bar. It hides
  // itself while the tutor is unavailable (an unrevealed review card), where
  // asking about the highlighted text would be a way to peek at the answer.
  selectionBar?.addAction(askAction);

  // An answer is text like any other: the reply that half-lands is exactly the
  // thing you want to point at and ask about again. The log gets its own bar
  // (the page's is scoped to the page's own content), which also means a word
  // the tutor introduces can be saved straight from the reply.
  const logBar = globalThis.ZhongwenSaveCard?.createSelectionBar({
    root: () => logEl,
    lookup,
  });
  logBar?.addAction({ ...askAction, label: 'Ask a follow-up ↗' });

  quoteDropEl.addEventListener('click', clearQuote);

  // -------------------------------------------------------------------------
  // Conversation
  // -------------------------------------------------------------------------

  // Answers arrive as plain text; Chinese inside them is hoverable like
  // everything else on the page.
  function botBubble(text) {
    const bubble = el('div', 'bubble');
    for (const para of String(text).split(/\n+/).map((p) => p.trim()).filter(Boolean)) {
      bubble.append(lookup ? lookup.hoverable('p', null, para) : el('p', null, para));
    }
    if (!bubble.childElementCount) bubble.append(el('p', null, String(text)));
    return bubble;
  }

  function messageEl(msg) {
    const kind = msg.role === 'user' ? 'user' : msg.role === 'error' ? 'bot err' : 'bot';
    const wrap = el('div', `msg ${kind}`);
    if (msg.role === 'user') {
      const bubble = el('div', 'bubble');
      if (msg.quote) bubble.append(el('div', 'quoted', msg.quote));
      bubble.append(el('div', null, msg.content));
      wrap.append(bubble);
    } else if (msg.role === 'error') {
      wrap.append(el('div', 'bubble', msg.content));
    } else {
      wrap.append(botBubble(msg.content));
    }
    return wrap;
  }

  function renderChat() {
    logEl.replaceChildren();
    if (!history.length) {
      const box = el('div', 'tutor-empty');
      const note = intro();
      if (note) box.append(el('div', null, note));
      const list = el('div', 'starters');
      for (const text of starters()) {
        const btn = el('button', 'starter', text);
        btn.type = 'button';
        btn.addEventListener('click', () => {
          questionEl.value = text;
          composerEl.requestSubmit();
        });
        list.append(btn);
      }
      if (list.childElementCount) box.append(list);
      logEl.append(box);
      return;
    }
    for (const msg of history) logEl.append(messageEl(msg));
    logEl.scrollTop = logEl.scrollHeight;
  }

  // The tutor rides on the same capability token as sync and the news digest.
  function showSetup() {
    logEl.replaceChildren();
    const box = el('div', 'tutor-empty');
    box.append(el('div', null,
      'The tutor answers on your own AI API key, so your questions are never '
      + 'anyone else\'s bill. Create a private token here, then paste a key into '
      + 'the extension\'s Options page — everything else on this page works '
      + 'without either.'));
    const btn = el('button', 'starter', 'Enable the tutor');
    btn.type = 'button';
    btn.addEventListener('click', async () => {
      await chrome.storage.local.set({
        syncMeta: { token: newToken(), serverUrl: DEFAULT_SERVER_URL, cursor: 0, lastPushAt: 0 },
      });
      chrome.runtime.sendMessage({ type: 'syncNow' }).catch(() => {});
      renderChat();
    });
    const options = el('button', 'starter', 'Open Options');
    options.type = 'button';
    options.addEventListener('click', () => chrome.runtime.openOptionsPage());
    const wrap = el('div', 'starters');
    wrap.append(btn, options);
    box.append(wrap);
    logEl.append(box);
  }

  function showThinking() {
    const wrap = el('div', 'msg bot');
    wrap.append(el('div', 'thinking', 'Thinking…'));
    logEl.append(wrap);
    logEl.scrollTop = logEl.scrollHeight;
    return wrap;
  }

  async function ask(question) {
    if (busy) return;
    const meta = await getSyncMeta();
    if (!meta || !meta.token || !meta.serverUrl) { showSetup(); return; }

    const asked = { role: 'user', content: question };
    if (quote) asked.quote = quote.text;

    const where = context() || {};
    const payload = {
      question,
      selection: quote?.text || '',
      context: {
        ...where,
        // A highlighted passage overrides the page's own description of what
        // is on screen: the learner pointed at something specific.
        section: quote?.section || where.section || '',
        text: quote?.context || where.text || '',
      },
      history: history
        .filter((m) => m.role === 'user' || m.role === 'assistant')
        .slice(-MAX_HISTORY)
        .map((m) => ({ role: m.role, content: m.content })),
    };

    const key = currentKey;
    history.push(asked);
    renderChat();
    const pending = showThinking();
    busy = true;
    sendEl.disabled = true;
    questionEl.value = '';
    clearQuote();

    let answer;
    try {
      const data = await postAsk(meta, payload);
      answer = { role: 'assistant', content: data.answer || '(no answer)' };
    } catch (err) {
      answer = { role: 'error', content: `Could not answer that: ${err.message}` };
    }
    busy = false;
    sendEl.disabled = false;
    pending.remove();
    // The card (or level) may have changed while the model was thinking; the
    // answer belongs to the thread it was asked in, not to whatever is on
    // screen now.
    if (key !== currentKey) {
      await saveThread(key, [...history, answer]);
      return;
    }
    history.push(answer);
    history = history.slice(-MAX_HISTORY);
    renderChat();
    await saveThread(key, history);
  }

  composerEl.addEventListener('submit', (e) => {
    e.preventDefault();
    const question = questionEl.value.trim();
    if (question) ask(question);
  });

  questionEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      composerEl.requestSubmit();
    }
    if (e.key === 'Escape' && mode === 'drawer') close();
  });

  // -------------------------------------------------------------------------
  // Panel lifecycle
  // -------------------------------------------------------------------------

  // Whether the learner wants the drawer up. Kept across subjects so that
  // reviewing card after card does not mean reopening it every time; only an
  // explicit close puts it away.
  let wantOpen = false;

  function open() {
    if (mode !== 'drawer') return;
    wantOpen = true;
    if (!available) return;
    root.hidden = false;
    document.documentElement.classList.add('tutor-drawer-open');
    if (launcherEl) launcherEl.hidden = true;
  }

  function close() {
    if (mode !== 'drawer') return;
    wantOpen = false;
    root.hidden = true;
    document.documentElement.classList.remove('tutor-drawer-open');
    if (launcherEl) launcherEl.hidden = !available;
  }

  // Point the panel at a new subject: loads that conversation, drops any quote
  // left over from the previous one.
  async function setThread() {
    const key = threadKey();
    if (key === currentKey) return;
    currentKey = key;
    clearQuote();
    history = await loadThread(key);
    if (key !== currentKey) return; // switched again while loading
    const meta = await getSyncMeta();
    if (key !== currentKey) return;
    if (!meta || !meta.token || !meta.serverUrl) showSetup();
    else renderChat();
  }

  // Whether the tutor makes sense right now (a review card hides it until the
  // answer is showing, so asking cannot become a way to peek).
  function setAvailable(next) {
    available = !!next;
    if (!available) {
      selectionBar?.hide();
      clearQuote();
      root.hidden = true;
      if (mode === 'drawer') {
        document.documentElement.classList.remove('tutor-drawer-open');
        if (launcherEl) launcherEl.hidden = true;
      }
      return;
    }
    if (mode !== 'drawer') {
      root.hidden = false;
      return;
    }
    // Restore whatever the learner last chose, rather than making them reopen
    // the drawer on every card.
    if (wantOpen) {
      root.hidden = false;
      document.documentElement.classList.add('tutor-drawer-open');
      if (launcherEl) launcherEl.hidden = true;
    } else if (launcherEl) {
      launcherEl.hidden = false;
    }
  }

  // Populate the log without the page having to ask. A tutor that never
  // switches subject — the library's — would otherwise sit empty forever,
  // showing neither its starter questions nor the "enable the tutor" prompt.
  setThread();

  return {
    root,
    open,
    close,
    setThread,
    setAvailable,
    refresh: renderChat,
    isOpen: () => !root.hidden,
    // True while the selection bar is up. Hover lookups are suppressed then,
    // or the popup would open on top of it.
    isPointing: () => !!selectionBar?.isOpen() || !!logBar?.isOpen(),
  };
}
