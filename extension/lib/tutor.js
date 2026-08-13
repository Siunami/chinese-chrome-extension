// The tutor panel — one chat, on every page, sliding out of the right edge.
//
// Literally one chat: it is not per page and not per card. The conversation is
// stored, so it is the same one whether you opened the drawer on a review card
// or in the news digest, and the ones before it are in a list you can navigate
// (the 🕘 button). What you were looking at when you asked travels with the
// question rather than deciding which conversation you are in — which is what
// it used to do, silently swapping threads as you moved between cards.
//
// The panel owns its own markup, styling, storage, and the call to the
// Worker's /api/ask, so a page only has to say WHAT the learner is looking at.
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
const MAX_HISTORY = 12;     // turns of the current chat sent to the model
const LEGACY_STORE_KEY = 'tutorChats'; // see the cleanup below

const TUTOR_CSS = `
  .tutor {
    display: flex; flex-direction: column; min-height: 0;
    background: #faf8f2; color: #222; text-align: left;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    font-size: 15px;
  }
  .tutor[hidden] { display: none !important; }
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
  .tutor-close, .tutor-icon {
    flex: none; padding: 2px 7px; border: 1px solid #ddd5c4; border-radius: 7px;
    background: #fff; color: #777; font: inherit; font-size: 13px; cursor: pointer;
  }
  .tutor-close:hover, .tutor-icon:hover { background: #f3efe4; color: #b5232b; }

  /* Previous chats. The list takes over the log rather than opening a second
     panel — in 370px, a chat and an index of chats are never both worth
     reading at once. */
  .tutor-histbar { margin-bottom: 10px; }
  .tutor-back {
    padding: 4px 9px; border: 1px solid #e3dbc9; border-radius: 8px;
    background: #fff; color: #666; font: inherit; font-size: 12px; cursor: pointer;
  }
  .tutor-back:hover { border-color: #d0bf98; background: #fffdf3; }
  .tutor-histlist { display: flex; flex-direction: column; gap: 5px; }
  .tutor-histrow {
    display: flex; align-items: stretch; gap: 4px; border: 1px solid #e8e1d5;
    border-radius: 9px; background: #fff;
  }
  .tutor-histrow:hover { border-color: #d0bf98; }
  .tutor-histrow.current { border-color: #c9b08a; background: #fffdf3; }
  .tutor-histopen {
    flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px;
    padding: 8px 10px; border: 0; border-radius: 9px; background: none;
    font: inherit; text-align: left; cursor: pointer;
  }
  .tutor-histopen .title {
    color: #333; font-size: 12.5px; line-height: 1.4;
    display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;
    overflow: hidden;
  }
  .tutor-histopen .when { color: #a9a396; font-size: 10.5px; }
  .tutor-histdel {
    flex: none; padding: 0 9px; border: 0; border-radius: 0 9px 9px 0;
    background: none; color: #bbb; font: inherit; font-size: 12px; cursor: pointer;
  }
  .tutor-histdel:hover { background: #fbe4e4; color: #a33; }
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
  .tutor-composer[hidden] { display: none !important; }
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

// ---------------------------------------------------------------------------
// Conversations
//
// One chat, not one per card. The tutor used to open a different thread for
// every card, guide level and digest, keyed by subject and swapped out from
// under you as you moved — so a question you asked two cards ago was somewhere
// you could not get back to. There is one conversation now, it follows you
// between pages (the store is shared), and the ones before it are in a list
// you can open. Which card you were on when you asked travels with the
// question instead of deciding which chat you are in.
// ---------------------------------------------------------------------------

const STORE_KEY = 'tutorChatLog';
const MAX_CHATS = 40;        // conversations kept before the oldest is dropped
const MAX_STORED_TURNS = 60; // messages retained per conversation

// Everything in one record so pruning is possible: per-chat keys would grow
// without bound. Newest first, which is also the order the list renders in.
async function loadChats() {
  const { [STORE_KEY]: chats } = await chrome.storage.local.get(STORE_KEY);
  return Array.isArray(chats) ? chats : [];
}

async function writeChat(chat) {
  const chats = await loadChats();
  const rest = chats.filter((c) => c.id !== chat.id);
  rest.unshift({ ...chat, messages: chat.messages.slice(-MAX_STORED_TURNS) });
  await chrome.storage.local.set({ [STORE_KEY]: rest.slice(0, MAX_CHATS) });
}

async function deleteChat(id) {
  const chats = await loadChats();
  await chrome.storage.local.set({ [STORE_KEY]: chats.filter((c) => c.id !== id) });
}

// A chat is named after the question that started it — the only label anyone
// would recognise it by later.
function chatTitle(messages) {
  const first = messages.find((m) => m.role === 'user');
  const text = (first?.content || '').replace(/\s+/g, ' ').trim();
  return text.length > 60 ? `${text.slice(0, 57)}…` : (text || 'New chat');
}

function newChat() {
  return { id: `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`,
    at: Date.now(), messages: [] };
}

function fmtWhen(ts) {
  const mins = Math.round((Date.now() - ts) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return days < 7 ? `${days}d ago` : new Date(ts).toLocaleDateString();
}

// Threads written by older builds under a different shape, which nothing reads.
chrome.storage.local.remove(LEGACY_STORE_KEY).catch(() => {});

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
export function createTutor(options) {
  const {
    lookup = null,
    // One chat means one name for it. The page says what you are looking at
    // in the subtitle; the title should not claim the conversation is about
    // this card when it followed you here from the library.
    title = 'Tutor', subtitle = '',
    launcher = '💬 Ask', selectionBar = null, sectionFor = null,
    context = () => ({}), starters = () => [], intro = () => '',
    startAvailable = true,
  } = options;

  injectCss();

  const root = el('aside', 'tutor tutor-drawer');
  const head = el('div', 'tutor-head');
  const headText = el('div', 'tutor-head-text');
  const titleEl = el('b', null, title);
  const subtitleEl = el('span', null, subtitle);
  headText.append(titleEl, subtitleEl);

  // Two controls, always in the same place: start a fresh chat, or go back
  // through the ones before it.
  const newEl = el('button', 'tutor-icon', '＋');
  newEl.type = 'button';
  newEl.title = 'Start a new chat';
  newEl.setAttribute('aria-label', 'Start a new chat');
  const historyEl = el('button', 'tutor-icon', '🕘');
  historyEl.type = 'button';
  historyEl.title = 'Previous chats';
  historyEl.setAttribute('aria-label', 'Previous chats');
  historyEl.id = 'tutorHistory';
  head.append(headText, newEl, historyEl);

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

  const closeEl = el('button', 'tutor-close', '✕');
  closeEl.type = 'button';
  closeEl.title = 'Close';
  closeEl.setAttribute('aria-label', 'Close the tutor');
  closeEl.addEventListener('click', () => close());
  head.append(closeEl);
  root.hidden = true;
  const launcherEl = el('button', 'tutor-launcher', launcher);
  launcherEl.id = 'tutorLauncher';
  launcherEl.type = 'button';
  launcherEl.hidden = !startAvailable;
  launcherEl.addEventListener('click', () => open());
  document.body.append(launcherEl, root);

  let chat = newChat();  // the conversation on screen
  let history = chat.messages;
  let quote = null;      // { text, section, context }
  let busy = false;
  let viewingHistory = false; // the list of past chats is up instead of the log
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

  // -------------------------------------------------------------------------
  // Navigating previous chats
  // -------------------------------------------------------------------------

  // The list replaces the log rather than opening a second panel: the drawer is
  // 370px, and a chat and an index of chats are never both worth reading.
  async function renderHistory() {
    viewingHistory = true;
    composerEl.hidden = true;
    logEl.replaceChildren();

    const bar = el('div', 'tutor-histbar');
    const back = el('button', 'tutor-back', '← Back to this chat');
    back.type = 'button';
    back.addEventListener('click', () => { viewingHistory = false; renderChat(); });
    bar.append(back);
    logEl.append(bar);

    const chats = (await loadChats()).filter((c) => c.messages?.length);
    if (!chats.length) {
      logEl.append(el('div', 'tutor-empty',
        'No previous chats yet. Questions you ask are kept here so you can come '
        + 'back to an explanation instead of asking for it twice.'));
      return;
    }

    const list = el('div', 'tutor-histlist');
    for (const past of chats) {
      const row = el('div', `tutor-histrow${past.id === chat.id ? ' current' : ''}`);
      const openBtn = el('button', 'tutor-histopen');
      openBtn.type = 'button';
      openBtn.append(
        el('span', 'title', chatTitle(past.messages)),
        el('span', 'when', `${fmtWhen(past.at)} · ${past.messages.length} messages`),
      );
      openBtn.addEventListener('click', () => openChat(past));
      const del = el('button', 'tutor-histdel', '✕');
      del.type = 'button';
      del.title = 'Delete this chat';
      del.setAttribute('aria-label', `Delete chat: ${chatTitle(past.messages)}`);
      del.addEventListener('click', async () => {
        await deleteChat(past.id);
        // Deleting the chat you are in leaves you in a fresh one rather than
        // still typing into something that no longer exists.
        if (past.id === chat.id) { chat = newChat(); history = chat.messages; }
        renderHistory();
      });
      row.append(openBtn, del);
      list.append(row);
    }
    logEl.append(list);
  }

  function openChat(past) {
    chat = { ...past, messages: [...past.messages] };
    history = chat.messages;
    viewingHistory = false;
    clearQuote();
    renderChat();
    questionEl.focus();
  }

  function startNewChat() {
    // An empty chat was never written, so there is nothing to leave behind.
    chat = newChat();
    history = chat.messages;
    viewingHistory = false;
    clearQuote();
    renderChat();
    questionEl.focus();
  }

  newEl.addEventListener('click', startNewChat);
  historyEl.addEventListener('click', () => {
    if (viewingHistory) { viewingHistory = false; renderChat(); } else renderHistory();
  });

  function renderChat() {
    viewingHistory = false;
    composerEl.hidden = false;
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

    // The learner may open a past chat, or start a new one, while the model is
    // thinking. The answer belongs to the conversation it was asked in.
    const asking = chat;
    asking.messages.push(asked);
    asking.at = Date.now();
    if (chat === asking && !viewingHistory) renderChat();
    const pending = chat === asking && !viewingHistory ? showThinking() : null;
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
    pending?.remove();
    asking.messages.push(answer);
    // A failed question is still worth keeping — it is the one you will want to
    // retry — but it should not be what the chat is named after.
    await writeChat(asking);
    if (chat === asking && !viewingHistory) renderChat();
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
    if (e.key === 'Escape') close();
  });

  // -------------------------------------------------------------------------
  // Panel lifecycle
  // -------------------------------------------------------------------------

  // Whether the learner wants the drawer up. Kept across subjects so that
  // reviewing card after card does not mean reopening it every time; only an
  // explicit close puts it away.
  let wantOpen = false;

  function open() {
    wantOpen = true;
    if (!available) return;
    root.hidden = false;
    document.documentElement.classList.add('tutor-drawer-open');
    launcherEl.hidden = true;
  }

  function close() {
    wantOpen = false;
    root.hidden = true;
    document.documentElement.classList.remove('tutor-drawer-open');
    launcherEl.hidden = !available;
  }

  // The page has moved to a new card, level or digest. The conversation does
  // not change — it follows you, and each question records where it was asked
  // — but a quote pointing into the page that just went away is stale.
  function setThread() {
    clearQuote();
  }

  // Whether the tutor makes sense right now (a review card hides it until the
  // answer is showing, so asking cannot become a way to peek).
  function setAvailable(next) {
    available = !!next;
    if (!available) {
      selectionBar?.hide();
      clearQuote();
      root.hidden = true;
      document.documentElement.classList.remove('tutor-drawer-open');
      launcherEl.hidden = true;
      return;
    }
    // Restore whatever the learner last chose, rather than making them reopen
    // the drawer on every card.
    if (wantOpen) {
      root.hidden = false;
      document.documentElement.classList.add('tutor-drawer-open');
      launcherEl.hidden = true;
    } else {
      launcherEl.hidden = false;
    }
  }

  // Pick up the conversation you were last in, on whichever page you open
  // next: one chat that follows you is the whole point of unifying it.
  (async () => {
    const [recent] = await loadChats();
    if (recent?.messages?.length) {
      chat = { ...recent, messages: [...recent.messages] };
      history = chat.messages;
    }
    const meta = await getSyncMeta();
    if (viewingHistory) return;
    if (!meta || !meta.token || !meta.serverUrl) showSetup();
    else renderChat();
  })();

  return {
    root,
    open,
    close,
    setThread,
    setAvailable,
    newChat: startNewChat,
    showHistory: renderHistory,
    refresh: renderChat,
    isOpen: () => !root.hidden,
    // True while the selection bar is up. Hover lookups are suppressed then,
    // or the popup would open on top of it.
    isPointing: () => !!selectionBar?.isOpen() || !!logBar?.isOpen(),
  };
}
