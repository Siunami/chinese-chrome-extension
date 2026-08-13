// The tutor panel — one chat, on every page, sliding out of the right edge.
//
// Literally one chat: it is not per page and not per card. The conversation is
// stored, so it is the same one whether you opened the drawer on a review card
// or in the news digest, and the ones before it are in a list you can navigate
// (the clock button). What you were looking at when you asked travels with the
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

import { getSyncMeta, hasDefaultServer, pairWith } from './sync.js';
import { postAi } from './aistatus.js';
import { packChats } from './chatlog.js';
import { icon } from './icons.js';
import { buildProfile } from './profile.js';
import { RESULTS_KEY } from './placement.js';
import { announceTutor, getAskOpen, onAskOpen, setAskOpen } from './tutorstate.js';

const HIGHLIGHT_NAME = 'tutor-quote';
const QUOTE_LIMIT = 1200;   // matches the Worker's selection cap
const MAX_HISTORY = 12;     // turns of the current chat sent to the model
// How long a conversation stays the one you are in. Within a sitting the chat
// follows you between pages and survives a reload; come back after a break and
// the drawer opens on a fresh one, with the old one still under the clock.
const SITTING_MS = 45 * 60 * 1000;
const LEGACY_STORE_KEY = 'tutorChats'; // see the cleanup below

const TUTOR_CSS = `
  .tutor {
    display: flex; flex-direction: column; min-height: 0;
    background: #faf8f2; color: #222; text-align: left;
    /* The app's own face where there is one — the drawer is part of the app,
       not a widget dropped onto it — and the same stack by hand where the
       tokens are absent. */
    font-family: var(--zx-font, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif);
    font-size: 15px;
  }
  .tutor[hidden] { display: none !important; }
  /* A column of the app, not a sheet over it: the shell (lib/shell.js) puts the
     drawer next to the page's own scrolling column, so the page keeps its
     scrollbar on its own side of the border and nothing is hidden underneath
     the chat. The fixed form is the fallback for a host with no shell. */
  .tutor-drawer {
    position: fixed; top: 0; right: 0; bottom: 0;
    width: clamp(260px, 34vw, 370px);
    z-index: 2147483646; border-left: 1px solid #ddd5c4;
    box-shadow: -6px 0 26px rgba(60, 48, 24, 0.16);
  }
  .zx-main > .tutor-drawer {
    position: static; flex: none; width: clamp(260px, 34vw, 370px);
    box-shadow: none;
  }
  /* The slide belongs to the act of opening it, and to nothing else. Every page
     builds its own drawer, so animating whenever one appears means replaying
     the whole thing on every tab you visit with the tutor already open — the
     drawer is not opening then, it was never shut. The tutor-anim class is put
     on for the length of one press and taken straight off again, and the page
     beside it widens in the same motion because the two share the row. */
  html.tutor-anim .zx-main > .tutor-drawer { transition: margin-right 0.2s cubic-bezier(0.3, 0.7, 0.3, 1); }
  @media (prefers-reduced-motion: reduce) {
    html.tutor-anim .zx-main > .tutor-drawer { transition: none; }
  }

  /* Header. Two rows rather than one: the title and its controls share the
     first, and the subtitle gets the full width underneath instead of being
     squeezed into a 200px column beside three buttons and wrapping. */
  .tutor-head {
    flex: none; display: grid; grid-template-columns: 1fr auto; align-items: center;
    gap: 1px 8px; padding: 11px 12px 10px; border-bottom: 1px solid #eae4d6;
  }
  .tutor-head b { min-width: 0; font-size: 13.5px; letter-spacing: -0.01em; }
  .tutor-head-sub {
    grid-column: 1 / -1; color: #9a9384; font-size: 11.5px; line-height: 1.4;
  }
  .tutor-head-sub:empty { display: none; }
  .tutor-actions { display: flex; align-items: center; gap: 2px; }

  /* One control shape for all three. They used to be three bordered pills of
     three different widths, holding a full-width ＋, a colour emoji clock and a
     text ✕ — three type systems in 90px. These are bare 15px strokes: no box
     around them, because the icon is the button; hovering lifts a soft square
     under it so there is something to aim at.
   *
     Every button in here is written ".tutor button.x" rather than ".x". The
     drawer is injected into pages that style their own controls, and
     ".zx-app button" in shell.css outranks a lone class — which is exactly how
     these came to be drawn as bordered white buttons. */
  .tutor button.tutor-icon {
    flex: none; width: 28px; height: 28px; display: grid; place-items: center;
    padding: 0; border: 0; border-radius: 8px;
    background: none; color: #8a8272; font: inherit; cursor: pointer;
    transition: background 0.12s ease, box-shadow 0.12s ease, color 0.12s ease;
  }
  .tutor button.tutor-icon:hover {
    background: #f2ede0; color: #3f3a2f; box-shadow: 0 1px 3px rgba(60, 48, 24, 0.14);
  }
  .tutor button.tutor-icon[aria-pressed="true"] { background: #ece4d0; color: #7f1920; }
  .tutor button.tutor-close:hover { background: #fae6e4; color: #b5232b; }
  .tutor-icon svg {
    display: block; fill: none; stroke: currentColor; stroke-width: 1.5;
    stroke-linecap: round; stroke-linejoin: round;
  }
  .tutor button:focus-visible { outline: 2px solid #b5232b; outline-offset: 1px; }

  /* Previous chats. The list takes over the log rather than opening a second
     panel — in 370px, a chat and an index of chats are never both worth
     reading at once. */
  .tutor-histbar {
    display: flex; align-items: center; gap: 8px; margin-bottom: 12px;
  }
  .tutor-histbar h3 {
    flex: 1; margin: 0; color: #a49c8b; font-size: 10.5px; font-weight: 700;
    letter-spacing: 0.07em; text-transform: uppercase;
  }
  .tutor button.tutor-back {
    display: inline-flex; align-items: center; gap: 5px;
    padding: 4px 10px 4px 7px; border: 1px solid #e3dbc9; border-radius: 999px;
    background: #fff; color: #6b6555; font: inherit; font-size: 11.5px;
    font-weight: 600; cursor: pointer;
  }
  .tutor button.tutor-back:hover {
    border-color: #d0bf98; background: #fffdf3; color: #3f3a2f;
  }
  .tutor-back svg {
    fill: none; stroke: currentColor; stroke-width: 1.6; stroke-linecap: round;
    stroke-linejoin: round;
  }
  .tutor-histlist { display: flex; flex-direction: column; gap: 5px; }
  .tutor-histrow {
    display: flex; align-items: stretch; border: 1px solid #e8e1d5;
    border-radius: 10px; background: #fff; overflow: hidden;
  }
  .tutor-histrow:hover { border-color: #d0bf98; }
  .tutor-histrow.current { border-color: #c9b08a; background: #fffdf3; }
  .tutor button.tutor-histopen {
    flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 3px;
    padding: 8px 10px; border: 0; border-radius: 0; background: none;
    font: inherit; text-align: left; cursor: pointer;
  }
  .tutor button.tutor-histopen:hover { background: none; }
  .tutor-histopen .title {
    color: #33302a; font-size: 12.5px; line-height: 1.4;
    display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;
    overflow: hidden;
  }
  .tutor-histopen .when { color: #a9a396; font-size: 10.5px; }
  .tutor button.tutor-histdel {
    flex: none; width: 30px; display: grid; place-items: center;
    padding: 0; border: 0; border-radius: 0; background: none; color: #c9c3b4;
    cursor: pointer;
  }
  .tutor-histdel svg {
    display: block; fill: none; stroke: currentColor; stroke-width: 1.5;
    stroke-linecap: round;
  }
  .tutor button.tutor-histdel:hover { background: #fbe4e4; color: #a33; }
  .tutor-log { flex: 1; min-height: 0; overflow-y: auto; padding: 14px 14px 18px; }
  .tutor .msg { margin-bottom: 12px; font-size: 13.5px; line-height: 1.55; }
  .tutor .msg:last-child { margin-bottom: 0; }
  .tutor .msg.user { text-align: right; }
  .tutor .msg.user .bubble {
    display: inline-block; max-width: 90%; padding: 7px 11px;
    border-radius: 13px 13px 4px 13px; background: #ece4d0; text-align: left;
  }
  .tutor .msg.bot .bubble {
    padding: 9px 12px; border: 1px solid #e8e1d5; border-radius: 13px 13px 13px 4px;
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

  /* The empty state. The suggestions are the only thing to act on, so they get
     a label of their own rather than trailing a paragraph of grey prose. */
  .tutor .tutor-empty { color: #75705f; font-size: 12.5px; line-height: 1.6; }
  .tutor .starters { display: flex; flex-direction: column; gap: 6px; }
  .tutor .starters-label {
    margin: 16px 0 7px; color: #a49c8b; font-size: 10.5px; font-weight: 700;
    letter-spacing: 0.07em; text-transform: uppercase;
  }
  .tutor button.starter {
    padding: 8px 11px; border: 1px solid #e6dfcf; border-radius: 10px;
    background: #fff; color: #4d4839; font: inherit; font-size: 12.5px;
    font-weight: 400; text-align: left; line-height: 1.45; cursor: pointer;
    transition: border-color 0.12s ease, background 0.12s ease;
  }
  .tutor button.starter:hover { border-color: #c9b08a; background: #fffdf3; }

  /* Attached images, after the message-bar pattern in the design library.
     Every tile is the same height and they bottom-align, so the pile dips into
     the top of the field by exactly its first third and the rest stands clear
     above it — attached to the message you are writing, not sent. The field
     grows its own top padding by that third, which is the part that stops a
     picture from landing on top of the words. Alternating tilt so a second one
     reads as tossed onto the pile rather than filed beside it; hovering one
     straightens it and reveals its ✕. */
  .tutor-tray {
    position: absolute; left: 8px; right: 8px; bottom: calc(100% - var(--overlap));
    display: flex; align-items: flex-end; gap: 10px; pointer-events: none;
  }
  .tutor-tray:empty { display: none; }
  .tutor-chip {
    position: relative; flex: none; height: var(--tile-h); pointer-events: auto;
    opacity: 0; transform: translateY(10px) rotate(var(--tilt, 0deg));
    transition: opacity 0.18s ease, transform 0.18s cubic-bezier(0.3, 0.7, 0.3, 1);
  }
  .tutor-chip.in { opacity: 1; transform: translateY(0) rotate(var(--tilt, 0deg)); }
  .tutor-chip.in:hover { transform: translateY(-2px) rotate(0deg) scale(1.03); z-index: 2; }
  .tutor-chip.out { opacity: 0; transform: translateY(8px) scale(0.92); }
  .tutor-chip img {
    display: block; height: 100%; width: 78px; object-fit: cover;
    border: 2px solid #fff; border-radius: 10px;
    box-shadow: 0 3px 10px rgba(60, 48, 24, 0.22);
  }
  .tutor .tutor-chip button.drop-shot {
    position: absolute; top: -6px; right: -6px; width: 18px; height: 18px;
    display: grid; place-items: center; padding: 0; border: 1.5px solid #fff;
    border-radius: 999px; background: #b5232b; color: #fff; cursor: pointer;
    opacity: 0; transform: scale(0.8); transition: opacity 0.12s ease, transform 0.12s ease;
  }
  .tutor .tutor-chip button.drop-shot svg { display: block; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; }
  .tutor-chip:hover button.drop-shot, .tutor .tutor-chip button.drop-shot:focus-visible {
    opacity: 1; transform: scale(1);
  }
  /* What was sent, kept with the question in the log — above the bubble and
     outside it, the way it sat above the composer. A picture and the sentence
     asking about it are two things, and putting them in one tinted box makes
     the picture look like part of the sentence. */
  .tutor .msg .shots {
    display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 5px;
    margin-bottom: 5px;
  }
  .tutor .msg .shots img {
    display: block; width: 84px; height: 62px; object-fit: cover;
    border: 2px solid #fff; border-radius: 10px;
    box-shadow: 0 2px 8px rgba(60, 48, 24, 0.18);
  }

  /* Composer. One field holding the quoted passage, the question and the send
     row, so the drawer ends in a single object with a single focus ring rather
     than three stacked boxes. */
  .tutor-composer {
    position: relative; z-index: 1; flex: none; padding: 10px 12px 12px;
    border-top: 1px solid #eae4d6;
  }
  .tutor-composer[hidden] { display: none !important; }
  .tutor-field {
    --tile-h: 54px;
    --overlap: calc(var(--tile-h) / 3); /* the first third dips into the field */
    position: relative;
    padding: 6px; border: 1px solid #ddd5c4; border-radius: 14px;
    background: #fff;
    transition: border-color 0.12s ease, box-shadow 0.12s ease, padding-top 0.15s ease;
  }
  /* Make room for the third of each tile that dips in, so a picture never lands
     on the words. */
  .tutor-field.has-shots { padding-top: calc(var(--overlap) + 8px); }
  .tutor-field:focus-within {
    border-color: #c9b08a; box-shadow: 0 0 0 3px rgba(201, 165, 92, 0.16);
  }
  /* Dragging a picture anywhere over the drawer aims at the composer. */
  .tutor-field.dropping {
    border-color: #c9a55c; border-style: dashed;
    box-shadow: 0 0 0 3px rgba(201, 165, 92, 0.2);
  }
  .tutor .quote-chip {
    display: flex; align-items: flex-start; gap: 6px; margin-bottom: 6px;
    padding: 5px 7px; border-left: 2px solid #c9a55c; border-radius: 0 6px 6px 0;
    background: rgba(201, 165, 92, 0.15);
  }
  .tutor .quote-chip[hidden] { display: none !important; }
  .tutor .quote-chip .text {
    flex: 1; min-width: 0; max-height: 54px; overflow: hidden;
    color: #6d5c34; font-size: 12px; line-height: 1.45;
  }
  .tutor .quote-chip button.drop {
    flex: none; width: 18px; height: 18px; display: grid; place-items: center;
    padding: 0; border: 0; border-radius: 5px; background: none; color: #8a7a58;
    cursor: pointer;
  }
  .tutor .quote-chip button.drop:hover { background: rgba(201, 165, 92, 0.28); }
  .tutor .quote-chip .drop svg {
    display: block; fill: none; stroke: currentColor; stroke-width: 1.6;
    stroke-linecap: round;
  }
  /* One row: attach, write, send. The box used to be three stacked strips with
     a line of instructions along the bottom — "Enter to send · paste an image"
     — which is the interface explaining itself instead of being obvious. The
     picture button says you can attach a picture; the box says what to ask. */
  .tutor-row { display: flex; align-items: flex-end; gap: 2px; }
  .tutor textarea {
    flex: 1; min-width: 0; display: block; height: 30px; max-height: 124px;
    padding: 6px 4px; border: 0; background: none; color: #222; font: inherit;
    font-size: 13.5px; line-height: 18px; resize: none;
    /* It grows as you type and scrolls at the ceiling; a scrollbar inside a
       28px-tall box is all bar and no thumb. */
    scrollbar-width: none;
  }
  .tutor textarea::-webkit-scrollbar { width: 0; height: 0; }
  .tutor textarea:focus { outline: none; }
  .tutor textarea::placeholder { color: #b0a996; }
  .tutor button.send {
    flex: none; padding: 6px 13px; border: 1px solid #c9b08a; border-radius: 999px;
    background: #fdf6c7; color: #7f1920; font: inherit; font-size: 12.5px;
    font-weight: 650; cursor: pointer; transition: background 0.12s ease, opacity 0.12s ease;
  }
  .tutor button.send:hover:not(:disabled) { background: #fdf0a8; }
  .tutor button.send:disabled { opacity: 0.4; cursor: default; }

  /* Without a shell to sit in there is nothing to push, so the fixed drawer
     narrows the document instead — the fallback path, and the only way to keep
     it off the top of the content. */
  html.tutor-drawer-open body:not(.zx-shell) {
    padding-right: clamp(260px, 34vw, 370px);
  }
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

// A header/quote-chip button: an icon, a name for it, and nothing to read.
function iconButton(className, name, label, size) {
  const btn = el('button', className);
  btn.type = 'button';
  btn.title = label;
  btn.setAttribute('aria-label', label);
  btn.append(icon(name, size));
  return btn;
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

// Everything in one record so pruning is possible: per-chat keys would grow
// without bound. Newest first, which is also the order the list renders in.
async function loadChats() {
  const { [STORE_KEY]: chats } = await chrome.storage.local.get(STORE_KEY);
  return Array.isArray(chats) ? chats : [];
}

// How many conversations, how many turns of each, and how many pictures across
// the whole log are lib/chatlog.js — attached images are the most expensive
// thing this extension stores, so that policy is written down and tested in one
// place rather than spelled out here.
async function writeChat(chat) {
  const chats = await loadChats();
  const rest = chats.filter((c) => c.id !== chat.id);
  await chrome.storage.local.set({ [STORE_KEY]: packChats([chat, ...rest]) });
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

// ---------------------------------------------------------------------------
// Attached images
//
// A photo of a menu, a sign, a page of a textbook, or a screenshot of a
// sentence from somewhere the extension does not run — the questions a learner
// most wants to ask are often about Chinese that is not on the page. Paste one,
// drop one, or pick one.
//
// Nothing is uploaded anywhere: the picture is shrunk in the page and travels
// inside the same /api/ask request as the question, on the learner's own key.
// Shrinking is not an optimisation — a pasted screenshot is several megabytes
// of retina PNG, which is slower to send than it is to read and is charged for
// by the pixel.
// ---------------------------------------------------------------------------

const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];
const MAX_SHOTS = 3;      // per question; the Worker enforces the same cap
const SEND_EDGE = 1120;   // longest side of what the model is shown
const THUMB_EDGE = 150;   // longest side of what is kept in the conversation

// Which encoding is smaller is not something you can tell by looking at the
// picture, so both are made and the smaller one kept. WebP is dramatically
// better on the flat backgrounds and crisp text of a screenshot — a 1120px one
// measured 27 KB against JPEG's 70 KB — and can come out slightly *larger* than
// JPEG on a noisy photograph. Quality is unchanged either way: the saving is in
// the format, not in throwing away detail the tutor has to read Chinese out of.
const ENCODINGS = ['image/webp', 'image/jpeg'];

// A canvas asked for a type it cannot make answers with a PNG instead of an
// error, and a PNG of a photograph is many times larger than either of these —
// so an answer is only used when it is the type that was asked for.
function encode(canvas, type, quality) {
  const url = canvas.toDataURL(type, quality);
  return url.startsWith(`data:${type};`) ? { mime: type, url } : null;
}

async function drawScaled(blob, edge, quality) {
  const bitmap = await createImageBitmap(blob);
  const scale = Math.min(1, edge / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close?.();
  const made = ENCODINGS.map((type) => encode(canvas, type, quality)).filter(Boolean);
  if (!made.length) return { mime: 'image/png', url: canvas.toDataURL() };
  return made.reduce((best, one) => (one.url.length < best.url.length ? one : best));
}

// -> { mime, data, thumb } | null. `data` is base64 without the data: prefix,
// which is the shape /api/ask takes; `thumb` is a small data URL kept with the
// question in the log, because a question about a picture makes no sense
// afterwards without the picture. The two are encoded independently: a picture
// can easily come out as WebP at one size and JPEG at the other.
async function prepareShot(blob) {
  if (!blob || !IMAGE_TYPES.includes(blob.type)) return null;
  try {
    const full = await drawScaled(blob, SEND_EDGE, 0.82);
    const thumb = await drawScaled(blob, THUMB_EDGE, 0.6);
    return {
      mime: full.mime,
      data: full.url.slice(full.url.indexOf(',') + 1),
      thumb: thumb.url,
    };
  } catch {
    return null; // an image the canvas cannot decode is not worth a dialog
  }
}

function postAsk(meta, payload) {
  return postAi(meta, '/api/ask', payload);
}

// ---------------------------------------------------------------------------
// Who is asking
//
// A tutor that does not know what you are studying can only answer in general,
// and a general answer to "how is this actually used?" is a dictionary with a
// friendlier voice. Every question carries the same deck snapshot the news
// digest is built from — what is in the review queue this week, what is solid,
// what keeps slipping — plus the level the app has the learner at and whatever
// the placement interview measured. The Worker turns that into a few lines at
// the top of the prompt (see learnerBlock there) so an answer can be pitched at
// the right level and built out of words they already hold.
//
// Read fresh for each question rather than cached: a word saved a minute ago
// should be able to turn up in the next answer, and one storage read costs
// nothing beside a model call.
// ---------------------------------------------------------------------------

async function learnerProfile() {
  const { wordlist = [], hskLevel = null, [RESULTS_KEY]: results = [] } = await chrome.storage.local
    .get(['wordlist', 'hskLevel', RESULTS_KEY]).catch(() => ({}));
  const profile = buildProfile(Array.isArray(wordlist) ? wordlist : []);
  if (Number.isInteger(hskLevel)) profile.hskLevel = hskLevel;
  // The interview is a measurement rather than the app's working guess, so it
  // travels separately — with its summary, which says what came apart.
  const [placed] = Array.isArray(results) ? results : [];
  if (placed && Number.isInteger(placed.level)) {
    profile.placement = {
      level: placed.level,
      at: placed.at || null,
      summary: placed.report?.summary || '',
    };
  }
  return profile;
}

// Mount a tutor panel.
//
// The control that opens it is not here: it is the Ask switch in the navbar
// (lib/shell.js), because the tutor is part of the app rather than something
// hovering over the page it happens to be on. This mounts the panel, says
// whether the page can be asked about right now, and follows the shared open
// bit in lib/tutorstate.js.
//
//   lookup        a createLookup() instance, so Chinese in answers is hoverable
//   title/subtitle  panel header
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
    selectionBar = null, sectionFor = null,
    context = () => ({}), starters = () => [], intro = () => '',
    startAvailable = true,
  } = options;

  injectCss();

  const root = el('aside', 'tutor tutor-drawer');
  const head = el('div', 'tutor-head');
  const titleEl = el('b', null, title);
  const subtitleEl = el('span', 'tutor-head-sub', subtitle);

  // Three controls, always in the same place and always the same shape: start a
  // fresh chat, go back through the ones before it, put the drawer away.
  const newEl = iconButton('tutor-icon', 'plus', 'Start a new chat');
  const historyEl = iconButton('tutor-icon', 'clock', 'Previous chats');
  historyEl.id = 'tutorHistory';
  historyEl.setAttribute('aria-pressed', 'false');
  const closeEl = iconButton('tutor-icon tutor-close', 'close', 'Close the tutor', 14);
  closeEl.addEventListener('click', () => close());
  const actions = el('div', 'tutor-actions');
  actions.append(newEl, historyEl, closeEl);
  head.append(titleEl, actions, subtitleEl);

  const logEl = el('div', 'tutor-log');
  logEl.id = 'chatLog';

  const composerEl = el('form', 'tutor-composer');
  composerEl.id = 'composer';
  const quoteChipEl = el('div', 'quote-chip');
  quoteChipEl.id = 'quoteChip';
  quoteChipEl.hidden = true;
  const quoteTextEl = el('div', 'text');
  quoteTextEl.id = 'quoteText';
  const quoteDropEl = iconButton('drop', 'close', 'Stop pointing at this', 11);
  quoteDropEl.id = 'quoteDrop';
  quoteChipEl.append(quoteTextEl, quoteDropEl);

  const questionEl = el('textarea');
  questionEl.id = 'question';
  questionEl.rows = 1;
  // Short enough to sit on one line in a 260px drawer. The picture button
  // beside it is what says a picture can go in here; the instruction line that
  // used to spell that out was the interface explaining itself.
  questionEl.placeholder = 'Ask anything…';
  const row = el('div', 'tutor-row');
  const attachEl = iconButton('tutor-icon', 'image', 'Attach an image', 15);
  attachEl.id = 'tutorAttach';
  const fileEl = el('input');
  fileEl.type = 'file';
  fileEl.id = 'tutorFile';
  fileEl.accept = IMAGE_TYPES.join(',');
  fileEl.multiple = true;
  fileEl.hidden = true;
  const sendEl = el('button', 'send', 'Ask');
  sendEl.id = 'send';
  sendEl.type = 'submit';
  row.append(attachEl, questionEl, sendEl, fileEl);
  // The quoted passage, the question and the send row are one field: they are
  // one thing you are composing, and drawing them as three stacked boxes in a
  // 370px drawer was most of what made the bottom of the panel look busy.
  // Attached images lean on the top edge of that field, above the tray line.
  const trayEl = el('div', 'tutor-tray');
  trayEl.id = 'tutorTray';
  const fieldEl = el('div', 'tutor-field');
  // The question box belongs to the row, between the two buttons — appending it
  // to the field as well would quietly move it back out of the row.
  fieldEl.append(trayEl, quoteChipEl, row);
  composerEl.append(fieldEl);

  root.append(head, logEl, composerEl);

  root.hidden = true;
  // Beside the page's own column if this page wears the app shell, which is
  // what makes the drawer part of the layout rather than something laid over
  // it. lib/shell.js mounts first on every page that has both.
  (document.querySelector('.zx-main') || document.body).append(root);

  let chat = newChat();  // the conversation on screen
  let history = chat.messages;
  let quote = null;      // { text, section, context }
  let shots = [];        // images attached to the question being written
  // The last set actually sent, at full size, kept for the rest of the sitting
  // so follow-up questions are still about the same picture. Not stored: only
  // the small thumbnails go to disk (see lib/chatlog.js).
  let sentShots = [];
  let busy = false;
  let viewingHistory = false; // the list of past chats is up instead of the log
  let available = startAvailable; // the host page can hide the whole thing

  // -------------------------------------------------------------------------
  // Attaching images
  // -------------------------------------------------------------------------

  let shotSeq = 0;

  // The field reserves room for the third of the tiles that dips into it.
  function paintTray() {
    fieldEl.classList.toggle('has-shots', !!trayEl.childElementCount);
    syncSend();
  }

  function dropShot(id) {
    const chip = trayEl.querySelector(`[data-shot="${id}"]`);
    shots = shots.filter((s) => s.id !== id);
    if (!chip) return;
    chip.classList.remove('in');
    chip.classList.add('out');
    const gone = () => { chip.remove(); paintTray(); };
    chip.addEventListener('transitionend', gone, { once: true });
    setTimeout(gone, 400); // in case nothing transitions
    syncSend();
  }

  function clearShots() {
    shots = [];
    trayEl.replaceChildren();
    paintTray();
  }

  async function attachShots(blobs) {
    for (const blob of blobs) {
      if (shots.length >= MAX_SHOTS) break;
      const shot = await prepareShot(blob);
      if (!shot) continue;
      const id = `s${++shotSeq}`;
      shots.push({ ...shot, id });

      const chip = el('div', 'tutor-chip');
      chip.dataset.shot = id;
      // Alternating lean, so a second picture reads as tossed on top of the
      // first rather than filed beside it.
      chip.style.setProperty('--tilt', `${shots.length % 2 ? -4 : 4}deg`);
      const img = el('img');
      img.src = shot.thumb;
      img.alt = 'Attached image';
      const remove = iconButton('drop-shot', 'close', 'Remove this image', 9);
      remove.addEventListener('click', () => dropShot(id));
      chip.append(img, remove);
      trayEl.append(chip);
      requestAnimationFrame(() => chip.classList.add('in'));
      paintTray();
    }
    if (shots.length) open();
  }

  const imagesIn = (transfer) => [...(transfer?.files || [])]
    .filter((f) => IMAGE_TYPES.includes(f.type));

  // Paste is the point of the whole thing: a screenshot is already on the
  // clipboard by the time anyone thinks to ask about it. Only when the picture
  // is the payload — pasting a screenshot alongside copied text should still
  // paste the text.
  questionEl.addEventListener('paste', (e) => {
    const files = imagesIn(e.clipboardData);
    if (!files.length || e.clipboardData.getData('text/plain').trim()) return;
    e.preventDefault();
    attachShots(files);
  });

  attachEl.addEventListener('click', () => fileEl.click());
  fileEl.addEventListener('change', () => {
    attachShots([...fileEl.files].filter((f) => IMAGE_TYPES.includes(f.type)));
    fileEl.value = ''; // so the same file can be picked again
  });

  // Dropping anywhere on the drawer aims at the composer; the browser's own
  // "open this file" would otherwise replace the whole page with the picture.
  root.addEventListener('dragover', (e) => {
    if (![...(e.dataTransfer?.types || [])].includes('Files')) return;
    e.preventDefault();
    fieldEl.classList.add('dropping');
  });
  root.addEventListener('dragleave', (e) => {
    if (e.relatedTarget && root.contains(e.relatedTarget)) return;
    fieldEl.classList.remove('dropping');
  });
  root.addEventListener('drop', (e) => {
    const files = imagesIn(e.dataTransfer);
    fieldEl.classList.remove('dropping');
    if (!files.length) return;
    e.preventDefault();
    attachShots(files);
  });

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

  // One word for one thing: the switch in the navbar, the button under the
  // question box and this all say Ask, because they all end in the same drawer.
  const askAction = {
    key: 'ask',
    label: 'Ask about this',
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
  logBar?.addAction({ ...askAction, label: 'Ask a follow-up' });

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
      // What was attached stays with the question — "what does this say?" is
      // unreadable a day later without the picture — but above the bubble
      // rather than inside it, the way it sat above the box you typed in. A
      // picture and the sentence asking about it are two things.
      if (msg.images?.length) {
        const shelf = el('div', 'shots');
        for (const src of msg.images) {
          const img = el('img');
          img.src = src;
          img.alt = 'Image attached to this question';
          shelf.append(img);
        }
        wrap.append(shelf);
      }
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

    historyEl.setAttribute('aria-pressed', 'true');

    const bar = el('div', 'tutor-histbar');
    bar.append(el('h3', null, 'Previous chats'));
    const back = el('button', 'tutor-back');
    back.type = 'button';
    back.append(icon('back', 13), el('span', null, 'Back'));
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
      const del = iconButton('tutor-histdel', 'close', 'Delete this chat', 12);
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
    // The picture belonged to the conversation you just left.
    sentShots = [];
    clearShots();
    renderChat();
    questionEl.focus();
  }

  function startNewChat() {
    // An empty chat was never written, so there is nothing to leave behind.
    chat = newChat();
    history = chat.messages;
    viewingHistory = false;
    clearQuote();
    sentShots = [];
    clearShots();
    renderChat();
    questionEl.focus();
  }

  newEl.addEventListener('click', startNewChat);
  historyEl.addEventListener('click', () => {
    if (viewingHistory) { viewingHistory = false; renderChat(); } else renderHistory();
  });

  function renderChat() {
    viewingHistory = false;
    historyEl.setAttribute('aria-pressed', 'false');
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
          growQuestion();
          composerEl.requestSubmit();
        });
        list.append(btn);
      }
      if (list.childElementCount) {
        box.append(el('div', 'starters-label', 'Try asking'), list);
      }
      logEl.append(box);
      return;
    }
    for (const msg of history) logEl.append(messageEl(msg));
    logEl.scrollTop = logEl.scrollHeight;
  }

  // The tutor rides on the same capability token as sync and the news digest,
  // against a Worker the learner deploys themselves.
  function showSetup() {
    logEl.replaceChildren();
    const box = el('div', 'tutor-empty');
    box.append(el('div', null,
      'The tutor runs through a small Cloudflare Worker you deploy to your own '
      + 'account, and answers on your own AI API key — so your questions are '
      + 'never anyone else\'s bill and never cross anyone else\'s server. Set the '
      + 'Worker up in Options (about two minutes), paste a key there too, and '
      + 'everything else on this page keeps working without either.'));
    const wrap = el('div', 'starters');
    if (hasDefaultServer()) {
      const btn = el('button', 'starter', 'Enable the tutor');
      btn.type = 'button';
      btn.addEventListener('click', async () => { await pairWith(); renderChat(); });
      wrap.append(btn);
    }
    const options = el('button', 'starter',
      hasDefaultServer() ? 'Open Options' : 'Set it up in Options');
    options.type = 'button';
    options.addEventListener('click', () => chrome.runtime.openOptionsPage());
    wrap.append(options);
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

    // A picture stays in the conversation, not just in the turn it arrived in.
    // "Do you know what I just pasted?" is a normal second question, and
    // sending only this turn's attachments meant the model truthfully answered
    // that it could not see anything — the picture had been dropped on the
    // floor after one exchange. The last set travels with every question until
    // a new one replaces it.
    const carried = !shots.length && sentShots.length;
    const attached = shots.length ? shots : sentShots;
    const asked = { role: 'user', content: question };
    if (quote) asked.quote = quote.text;
    if (shots.length) asked.images = shots.map((s) => s.thumb);

    const where = context() || {};
    const payload = {
      question,
      profile: await learnerProfile(),
      selection: quote?.text || '',
      images: attached.map((s) => ({ mime: s.mime, data: s.data })),
      // So the model can say "the picture you sent earlier" rather than
      // describing it as though it had just arrived.
      imagesFromEarlier: !!carried,
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
    growQuestion();
    clearQuote();
    if (shots.length) sentShots = shots;
    clearShots();

    let answer;
    let stale = null;
    try {
      const data = await postAsk(meta, payload);
      answer = { role: 'assistant', content: data.answer || '(no answer)' };
      // A Worker deployed before pictures existed accepts the request and
      // ignores them, and the model then says, correctly and uselessly, that it
      // cannot see any image. Say which end is at fault instead: the answer
      // count comes back from a Worker that took them.
      if (attached.length && data.sawImages === undefined) {
        stale = {
          role: 'error',
          content: 'That answer did not include your picture: the Worker this '
            + 'extension is paired with is an older build that drops images. '
            + 'Redeploy it (wrangler deploy) and ask again.',
        };
      }
    } catch (err) {
      answer = { role: 'error', content: `Could not answer that: ${err.message}` };
    }
    busy = false;
    syncSend();
    pending?.remove();
    asking.messages.push(answer);
    if (stale) asking.messages.push(stale);
    // A failed question is still worth keeping — it is the one you will want to
    // retry — but it should not be what the chat is named after.
    await writeChat(asking);
    if (chat === asking && !viewingHistory) renderChat();
  }

  composerEl.addEventListener('submit', (e) => {
    e.preventDefault();
    // A picture on its own is already a question: someone who pastes a photo of
    // a sign and presses Enter is asking what it says. Sending nothing, or
    // making them type it out, would be the pedantic reading.
    const question = questionEl.value.trim()
      || (shots.length ? 'What does this say? Read the Chinese in the image and explain it.' : '');
    if (question) ask(question);
  });

  // Ask is lit only when there is something to ask. The button is the one thing
  // in the composer that should tell you whether pressing it does anything.
  function syncSend() {
    sendEl.disabled = busy || !(questionEl.value.trim() || shots.length);
  }

  // The box is one line until there is more than one line to show, then grows
  // to a ceiling and scrolls — so a long question is written in a box the size
  // of the question rather than in a three-line well that is mostly empty.
  const QUESTION_MAX = 124;
  function growQuestion() {
    questionEl.style.height = 'auto';
    const wanted = questionEl.scrollHeight;
    // A drawer that has never been opened has no layout, and scrollHeight is 0
    // — measuring it there would pin the box to nothing and leave the
    // placeholder hanging out of the bottom of the field. Leave the stylesheet
    // to size it until there is something to measure.
    if (!wanted) { questionEl.style.height = ''; return; }
    questionEl.style.height = `${Math.min(wanted, QUESTION_MAX)}px`;
    questionEl.style.overflowY = wanted > QUESTION_MAX ? 'auto' : 'hidden';
  }

  questionEl.addEventListener('input', () => { growQuestion(); syncSend(); });
  growQuestion();
  syncSend();

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

  // Whether the learner wants the drawer up. It is the shared bit from
  // lib/tutorstate.js, so it is kept across cards, across pages and across the
  // dashboard's views: reviewing card after card does not mean reopening it
  // every time, and only pressing Ask again (or Escape, or ✕) puts it away.
  let wantOpen = false;

  // How much room the drawer takes, and where the navbar ends. Measured rather
  // than assumed: the bar is 64px on a wide window, shorter on a narrow one,
  // and absent altogether inside the dashboard's frames.
  // The slide is the answer to "you pressed the switch". It is not the answer to
  // "this page has finished loading and the drawer was already open", which is
  // what every tab change would otherwise look like — so motion is switched on
  // for the length of one press and taken off again.
  let motionTimer = 0;
  function withMotion() {
    document.documentElement.classList.add('tutor-anim');
    clearTimeout(motionTimer);
    motionTimer = setTimeout(
      () => document.documentElement.classList.remove('tutor-anim'), 350);
  }

  // In the row, the drawer opens by giving up a negative right margin: it
  // starts one drawer-width off the edge and slides into the space the page
  // yields as it goes, which is one movement rather than a panel arriving over
  // a page that jumped. No paint happens between un-hiding it and setting the
  // margin, so there is nothing to flash.
  function slideIn() {
    if (!root.parentElement?.classList.contains('zx-main')) return;
    const width = root.getBoundingClientRect().width;
    if (!width) return;
    root.style.marginRight = `${-width}px`;
    requestAnimationFrame(() => { root.style.marginRight = '0px'; });
  }

  function apply(animate = false) {
    const showing = wantOpen && available;
    const changed = showing !== !root.hidden;
    if (animate && changed) withMotion();
    root.hidden = !showing;
    root.style.marginRight = '0px';
    document.documentElement.classList.toggle('tutor-drawer-open', showing);
    // The question box can only be measured once it is on screen.
    if (showing && changed) growQuestion();
    if (animate && changed && showing) slideIn();
  }

  function open() {
    wantOpen = true;
    apply(true);
    setAskOpen(true);
  }

  function close() {
    wantOpen = false;
    apply(true);
    setAskOpen(false);
  }

  // Pressed somewhere else: the navbar switch, another page, another view of
  // the dashboard.
  onAskOpen((next) => {
    wantOpen = next;
    apply(true);
  });

  // The page has moved to a new card, level or digest. The conversation does
  // not change — it follows you, and each question records where it was asked
  // — but a quote pointing into the page that just went away is stale.
  function setThread() {
    clearQuote();
  }

  // Whether the tutor makes sense right now (a review card hides it until the
  // answer is showing, so asking cannot become a way to peek). The navbar's Ask
  // switch says the same thing by going flat, rather than by being pressable
  // and doing nothing.
  function setAvailable(next) {
    available = !!next;
    if (!available) {
      selectionBar?.hide();
      clearQuote();
    }
    apply();
    announceTutor(available);
  }

  // The dashboard asking the frame it just switched to for its answer again.
  window.addEventListener('message', (e) => {
    if (e.data?.type === 'zx-tutor-ping') announceTutor(available);
  });

  // Pick up the conversation you were last in — on whichever page you open
  // next, and only if you are still in the same sitting. Coming back tomorrow
  // to yesterday's half-finished question, already typed into the box, is not
  // continuity; it is a stale conversation you have to clear before you can use
  // the thing. The chat is not lost either way: it is one press of the clock
  // button away.
  (async () => {
    const [recent] = await loadChats();
    if (recent?.messages?.length && Date.now() - (recent.at || 0) < SITTING_MS) {
      chat = { ...recent, messages: [...recent.messages] };
      history = chat.messages;
    }
    announceTutor(available);
    wantOpen = await getAskOpen();
    apply();
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
