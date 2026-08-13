// Integration smoke test for the extension's own pages, driven in headless
// Chrome. Chrome no longer honours --load-extension, so instead of installing
// the extension this serves extension/ over http and injects a small `chrome`
// shim before any page script runs. Only the transport is faked: the shim
// forwards runtime.sendMessage to Node, where the REAL background handlers run
// against the REAL bundled dictionary. Everything under test — module load
// order, the shared popup, the guides, hover-to-define — is the shipped code.
//
// Usage: node scripts/extension-smoke.mjs
//   CHROME=/path/to/chrome    override the browser.
//   ZX_SHOTS=/some/dir        also write a PNG of each page. Off by default;
//                             every assertion here can pass on a page that
//                             looks wrong, and twice now one did.

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  parseDictTSV, buildIndex, buildRelatedIndex, findRelated, lookupAt,
  charBreakdown, rankEntryIndices, parsePinyin, findExamples, sentencePinyin,
} from '../extension/lib/cedict.js';
import { resolveCard } from '../extension/lib/cards.js';
import { cardKey } from '../extension/lib/merge.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const extDir = join(root, 'extension');
const chromePath = process.env.CHROME ||
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

// --- the real lookup engine, as the service worker would run it ------------

const entries = parseDictTSV(readFileSync(join(extDir, 'data/dict.tsv'), 'utf8'));
const index = buildIndex(entries);
const relatedIndex = buildRelatedIndex(entries);
const sentences = [];
for (const line of readFileSync(join(extDir, 'data/sentences.tsv'), 'utf8').split('\n')) {
  if (!line) continue;
  const [zh, py, en] = line.split('\t');
  if (zh && en) sentences.push({ zh, py: py || '', en });
}

const forDisplay = (e) => ({
  trad: e.trad, simp: e.simp, pinyin: parsePinyin(e.pinyin), defs: e.defs,
});

function handleLookup(msg) {
  const { groups, highlight } = lookupAt(index, entries, msg.text || '', msg.cursorIndex || 0);
  if (groups.length === 0) return { matches: [] };
  const ranked = groups.map((g) => ({
    ...g,
    entries: rankEntryIndices(g.entries.map((_, i) => i), g.entries).map((i) => g.entries[i]),
  }));
  const top = ranked[0].entries[0];
  return {
    matches: ranked.slice(0, 8).map((g) => ({ word: g.word, entries: g.entries.map(forDisplay) })),
    highlight,
    chars: charBreakdown(index, groups[0].word).map((c) => ({
      char: c.char,
      entryCount: c.idxs.length,
      entries: rankEntryIndices(c.idxs, entries).slice(0, 3).map((i) => forDisplay(entries[i])),
    })),
    related: msg.includeRelated === false ? []
      : findRelated(entries, index, relatedIndex, groups[0].word, 3)
        .map((r) => ({ ...forDisplay(entries[r.idx]), reason: r.reason })),
    examples: findExamples(sentences, top.simp, top.trad, msg.exampleCount ?? 8, index, entries)
      .map((s) => ({ zh: s.zh, py: s.py, en: s.en })),
    exampleWord: { simp: top.simp, trad: top.trad },
  };
}

const handlers = {
  lookup: handleLookup,
  pinyinBatch: (msg) => ({
    pinyin: (msg.texts || []).map((t) => (t ? sentencePinyin(index, entries, t) : '')),
  }),
  examples: (msg) => ({
    examples: findExamples(sentences, msg.simp, msg.trad || msg.simp, msg.count ?? 2, index, entries)
      .map((s) => ({ zh: s.zh, py: s.py, en: s.en })),
  }),
  speak: () => ({ ok: true }),
  // Shaping a card needs the dictionary, so it happens here, exactly as the
  // service worker does it. Whether the card is already saved is filled in by
  // the shim, which is where the word list lives.
  resolveCards: (msg) => ({
    cards: (msg.items || []).map((item) => {
      const out = resolveCard({
        map: index,
        entries,
        text: String(item?.text || ''),
        en: String(item?.en || ''),
        sourceWord: String(item?.sourceWord || ''),
        unit: !!item?.unit,
      });
      return out.issue ? { issue: out.issue } : { card: out.card, key: cardKey(out.card) };
    }),
  }),
  // saveWord/unsaveWord/savedStates are answered in the page instead: they
  // operate on the word list, which lives in the shim's fake storage.
  pinyinChars: () => ({ chars: [] }),
  listVoices: () => ({ voices: [] }),
  getEnabled: () => ({ enabled: true }),
  syncNow: () => ({ ok: true }),
};

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json',
  '.tsv': 'text/plain; charset=utf-8', '.png': 'image/png',
};

// A stand-in for an arbitrary web page, loading the content script exactly the
// way the manifest does — read from the manifest rather than copied, so adding
// a script there cannot leave this page loading a half-wired extension.
const contentScripts = JSON.parse(readFileSync(join(extDir, 'manifest.json'), 'utf8'))
  .content_scripts[0].js;
const TEST_PAGE = `<!DOCTYPE html><meta charset="utf-8">
<body style="margin:0;padding:60px;font-size:34px;line-height:2">
<p id="t">我很喜欢学习中文。</p>
${contentScripts.map((f) => `<script src="/${f}"></script>`).join('\n')}
</body>`;

// Stands in for the sync Worker's tutor endpoint, and records what the page
// actually sent so a test can assert the context travelled with the question.
let lastAsk = null;

const server = createServer(async (req, res) => {
  if (req.url === '/api/ask') {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    lastAsk = JSON.parse(Buffer.concat(chunks).toString());
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({
      answer: '这个词很常用。It is used for studying in general.',
      generatedAt: 1,
    }));
    return;
  }
  if (req.url === '/__lastask') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(lastAsk));
    return;
  }
  if (req.url === '/__page') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(TEST_PAGE);
    return;
  }
  if (req.url === '/__msg') {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    let out;
    try {
      const msg = JSON.parse(Buffer.concat(chunks).toString());
      out = handlers[msg.type] ? handlers[msg.type](msg) : { error: `no handler: ${msg.type}` };
    } catch (e) {
      out = { error: String(e.message) };
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(out));
    return;
  }
  const path = normalize(decodeURIComponent(req.url.split('?')[0])).replace(/^(\.\.[/\\])+/, '');
  const file = join(extDir, path);
  if (!file.startsWith(extDir) || !existsSync(file)) {
    res.writeHead(404).end('not found');
    return;
  }
  const ext = file.slice(file.lastIndexOf('.'));
  res.writeHead(200, { 'content-type': MIME[ext] || 'application/octet-stream' });
  res.end(readFileSync(file));
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;

// The pages only ever touch these corners of the extension API.
const CHROME_SHIM = `
  (() => {
    // Persisted so it behaves like real extension storage across a reload —
    // this script re-runs on every document.
    const KEY = '__zw_smoke_storage__';
    let store = { local: {}, sync: {} };
    try {
      const saved = JSON.parse(localStorage.getItem(KEY));
      if (saved && saved.local && saved.sync) store = saved;
    } catch { /* first load */ }
    const persist = () => {
      try { localStorage.setItem(KEY, JSON.stringify(store)); } catch { /* quota */ }
    };
    // Change events are how the app keeps itself in step with itself — live
    // due counts, the library repainting on a save, the script toggle. A shim
    // that silently never fires them leaves all of that untested.
    const listeners = [];
    const notify = (name, changes) => {
      if (!Object.keys(changes).length) return;
      for (const fn of listeners.slice()) {
        try { fn(changes, name); } catch { /* a listener must not break a write */ }
      }
    };
    const area = (name) => ({
      get(keys) {
        const bag = store[name];
        if (keys == null) return Promise.resolve({ ...bag });
        if (typeof keys === 'string') return Promise.resolve({ [keys]: bag[keys] });
        if (Array.isArray(keys)) {
          const out = {};
          for (const k of keys) out[k] = bag[k];
          return Promise.resolve(out);
        }
        const out = { ...keys };
        for (const k of Object.keys(keys)) if (k in bag) out[k] = bag[k];
        return Promise.resolve(out);
      },
      set(values) {
        const changes = {};
        for (const [k, v] of Object.entries(values)) {
          const oldValue = store[name][k];
          if (JSON.stringify(oldValue) === JSON.stringify(v)) continue;
          changes[k] = oldValue === undefined ? { newValue: v } : { oldValue, newValue: v };
        }
        Object.assign(store[name], values);
        persist();
        notify(name, changes);
        return Promise.resolve();
      },
      remove(keys) {
        const changes = {};
        for (const k of [].concat(keys)) {
          if (k in store[name]) changes[k] = { oldValue: store[name][k] };
          delete store[name][k];
        }
        persist();
        notify(name, changes);
        return Promise.resolve();
      },
    });

    // The card handlers read and write the word list, which lives in this
    // fake storage rather than in Node — so unlike lookups they are answered
    // here. Same identity rule as cardKey() in lib/merge.js.
    const cardKey = (c) => [c.cardType || 'word', c.simp || '',
      c.trad || c.simp || '', c.pinyin || ''].join('\\u0001');
    const cardHandlers = {
      saveWord: (msg) => {
        const e = msg.entry || {};
        if (!e.simp) return { ok: false };
        const list = (store.local.wordlist || []).filter((w) => cardKey(w) !== cardKey(e));
        list.unshift({ ...e, cardType: e.cardType || 'word', savedAt: Date.now(),
          lastSavedAt: Date.now(), touches: 1, srs: null });
        store.local.wordlist = list;
        persist();
        return { ok: true, count: list.length };
      },
      unsaveWord: (msg) => {
        const e = msg.entry || {};
        if (!e.simp) return { ok: false };
        store.local.wordlist =
          (store.local.wordlist || []).filter((w) => cardKey(w) !== cardKey(e));
        persist();
        return { ok: true, removed: true, count: store.local.wordlist.length };
      },
      savedStates: (msg) => {
        const have = new Set((store.local.wordlist || []).map(cardKey));
        return { saved: (msg.keys || []).map((k) => have.has(k)) };
      },
      // Half here, half in Node: the dictionary shapes the card, this side
      // knows what is already in the deck.
      resolveCards: async (msg) => {
        const r = await fetch('/__msg', {
          method: 'POST', body: JSON.stringify(msg),
        }).then((res) => res.json());
        const have = new Set((store.local.wordlist || []).map(cardKey));
        return {
          cards: (r.cards || []).map((c) => (c && c.key ? { ...c, saved: have.has(c.key) } : c)),
        };
      },
    };

    globalThis.chrome = {
      runtime: {
        id: 'smoke',
        getURL: (p) => '/' + String(p).replace(/^\\//, ''),
        sendMessage: (msg) => (cardHandlers[msg && msg.type]
          ? Promise.resolve(cardHandlers[msg.type](msg))
          : fetch('/__msg', {
            method: 'POST', body: JSON.stringify(msg),
          }).then((r) => r.json())),
        openOptionsPage: () => {},
      },
      storage: {
        local: area('local'),
        sync: area('sync'),
        onChanged: {
          addListener: (fn) => listeners.push(fn),
          removeListener: (fn) => {
            const i = listeners.indexOf(fn);
            if (i >= 0) listeners.splice(i, 1);
          },
        },
      },
      tts: { speak: () => Promise.resolve(), stop() {}, getVoices: () => Promise.resolve([]) },
    };
  })();
`;

// --- CDP plumbing ----------------------------------------------------------

const profile = mkdtempSync(join(tmpdir(), 'zw-smoke-'));
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  `--user-data-dir=${profile}`, '--remote-debugging-port=0', 'about:blank',
], { stdio: 'ignore' });

let failed = false;
function shutdown() {
  try { chrome.kill(); } catch { /* already gone */ }
  try { server.close(); } catch { /* already closed */ }
}
process.on('exit', shutdown);

async function devtoolsPort() {
  const portFile = join(profile, 'DevToolsActivePort');
  for (let i = 0; i < 600; i++) {
    try {
      return Number(readFileSync(portFile, 'utf8').split('\n')[0]);
    } catch {
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  throw new Error('Chrome did not expose a DevTools port');
}
const port = await devtoolsPort();

async function openPage(page) {
  const target = await (await fetch(
    `http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' },
  )).json();
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });

  let msgId = 0;
  const pending = new Map();
  const errors = [];
  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg);
      pending.delete(msg.id);
      return;
    }
    if (msg.method === 'Runtime.exceptionThrown') {
      const d = msg.params.exceptionDetails;
      errors.push((d.exception?.description || d.text || 'error').split('\n')[0]);
    }
  };
  const cdp = (method, params = {}) => {
    const id = ++msgId;
    ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => {
      pending.set(id, (m) =>
        (m.error ? reject(new Error(`${method}: ${m.error.message}`)) : resolve(m.result)));
    });
  };

  await cdp('Runtime.enable');
  await cdp('Page.enable');
  await cdp('DOM.enable');
  // Must be installed before the document exists: the page modules read
  // globalThis.chrome at evaluation time.
  await cdp('Page.addScriptToEvaluateOnNewDocument', { source: CHROME_SHIM });
  await cdp('Page.navigate', { url: `${base}/${page}` });

  async function evalJs(expression) {
    const { result, exceptionDetails } = await cdp('Runtime.evaluate', {
      expression, returnByValue: true, awaitPromise: true,
    });
    if (exceptionDetails) throw new Error(exceptionDetails.exception?.description || 'JS error');
    return result.value;
  }

  async function waitFor(expression, label, timeoutMs = 25000) {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const value = await evalJs(expression).catch(() => null);
      if (value) return value;
      if (Date.now() > deadline) throw new Error(`${page}: timed out waiting for ${label}`);
      await new Promise((r) => setTimeout(r, 200));
    }
  }

  // Everything the popup renders lives in a closed shadow root, so read it the
  // way a user sees it — through CDP's piercing traversal, not a test hook.
  // Where the popup actually is on screen. Reading its HTML proves the code
  // ran; it does not prove the learner can see it — a panel that is display:
  // none, zero-sized, or parked off-viewport serialises exactly the same.
  async function popupBox() {
    const { root: doc } = await cdp('DOM.getDocument', { depth: -1, pierce: true });
    let found = null;
    const walk = (node) => {
      if (found) return;
      const attrs = node.attributes || [];
      for (let i = 0; i < attrs.length; i += 2) {
        if (attrs[i] === 'class' && /(^| )popup( |$)/.test(attrs[i + 1])) {
          found = node.nodeId;
          return;
        }
      }
      for (const shadow of node.shadowRoots || []) walk(shadow);
      for (const child of node.children || []) walk(child);
      if (node.contentDocument) walk(node.contentDocument);
    };
    walk(doc);
    if (!found) return null;
    const box = await cdp('DOM.getBoxModel', { nodeId: found }).catch(() => null);
    if (!box) return null; // no box at all == not rendered
    const [x1, y1, , , x2, y2] = box.model.border;
    return { x: x1, y: y1, width: box.model.width, height: box.model.height, right: x2, bottom: y2 };
  }

  async function popupHtml() {
    const { root: doc } = await cdp('DOM.getDocument', { depth: -1, pierce: true });
    const roots = [];
    const walk = (node) => {
      for (const shadow of node.shadowRoots || []) {
        roots.push(shadow.nodeId);
        walk(shadow);
      }
      for (const child of node.children || []) walk(child);
    };
    walk(doc);
    let html = '';
    for (const nodeId of roots) {
      const r = await cdp('DOM.getOuterHTML', { nodeId }).catch(() => null);
      if (r) html += r.outerHTML;
    }
    return html;
  }

  // The selection bar is in a closed shadow root too, so a test reaches its
  // buttons the way it reaches the popup's markup: through CDP's piercing
  // traversal, by the data-action each button carries. Returns the point to
  // click, or null while the action is not on screen.
  async function actionPoint(action) {
    const { root } = await cdp('DOM.getDocument', { depth: -1, pierce: true });
    let found = null;
    const walk = (node) => {
      if (found) return;
      const attrs = node.attributes || [];
      for (let i = 0; i < attrs.length; i += 2) {
        if (attrs[i] === 'data-action' && attrs[i + 1] === action) { found = node.nodeId; return; }
      }
      for (const shadow of node.shadowRoots || []) walk(shadow);
      for (const child of node.children || []) walk(child);
    };
    walk(root);
    if (!found) return null;
    const box = await cdp('DOM.getBoxModel', { nodeId: found }).catch(() => null);
    if (!box) return null;
    const [x1, y1, , , x3, y3] = box.model.content;
    return { x: Math.round((x1 + x3) / 2), y: Math.round((y1 + y3) / 2) };
  }

  async function waitForAction(action, timeoutMs = 15000) {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const point = await actionPoint(action);
      if (point) return point;
      if (Date.now() > deadline) throw new Error(`${page}: timed out waiting for "${action}"`);
      await new Promise((r) => setTimeout(r, 150));
    }
  }

  // Popup state that arrives after a round trip to the worker (the saved
  // markers) cannot be waited on from page JS — the shadow root is closed.
  async function waitForPopup(pattern, label, timeoutMs = 15000) {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const html = await popupHtml();
      if (pattern.test(html)) return html;
      if (Date.now() > deadline) throw new Error(`${page}: timed out waiting for ${label}`);
      await new Promise((r) => setTimeout(r, 150));
    }
  }

  // A trusted key press: the popup's shortcuts ignore synthetic events.
  async function pressKey(key) {
    await cdp('Input.dispatchKeyEvent', { type: 'keyDown', key, text: key });
    await cdp('Input.dispatchKeyEvent', { type: 'keyUp', key });
  }

  // A trusted pointer move, so the content script's isTrusted guard is
  // exercised the same way a real hover would exercise it.
  async function moveMouseTo(x, y) {
    await cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, buttons: 0 });
  }

  // Scrolling is what most of these checks do just before measuring an
  // element, and the popup hides on scroll — so a trailing scroll event can
  // close the panel a hover is about to open, or reflow can move the target
  // out from under coordinates already taken. Wait for a frame plus a beat.
  async function settle(ms = 200) {
    await evalJs('new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)))');
    await new Promise((r) => setTimeout(r, ms));
  }

  // A real press-drag-release, which is the only way to find out whether text
  // on the page can actually be selected with a mouse.
  async function dragSelect(from, to) {
    await cdp('Input.dispatchMouseEvent', {
      type: 'mousePressed', x: from.x, y: from.y, button: 'left', buttons: 1, clickCount: 1,
    });
    const steps = 8;
    for (let i = 1; i <= steps; i++) {
      await cdp('Input.dispatchMouseEvent', {
        type: 'mouseMoved', button: 'left', buttons: 1,
        x: Math.round(from.x + ((to.x - from.x) * i) / steps),
        y: Math.round(from.y + ((to.y - from.y) * i) / steps),
      });
    }
    await cdp('Input.dispatchMouseEvent', {
      type: 'mouseReleased', x: to.x, y: to.y, button: 'left', buttons: 0, clickCount: 1,
    });
  }

  async function clickAt(x, y) {
    await cdp('Input.dispatchMouseEvent', {
      type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1,
    });
    await cdp('Input.dispatchMouseEvent', {
      type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1,
    });
  }

  // Debug affordance, off unless ZX_SHOTS names a directory: the assertions
  // can all pass on a page that looks broken.
  // Screenshots are taken at whatever size Chrome defaults to, which is not
  // the size a library of 97 cards is actually read at.
  async function setViewport(width, height) {
    await cdp('Emulation.setDeviceMetricsOverride', {
      width, height, deviceScaleFactor: 1, mobile: false,
    });
  }

  async function shot(name) {
    if (!process.env.ZX_SHOTS) return;
    const { data } = await cdp('Page.captureScreenshot', { format: 'png' });
    writeFileSync(join(process.env.ZX_SHOTS, `${name}.png`), Buffer.from(data, 'base64'));
  }

  return {
    page, evalJs, waitFor, popupHtml, popupBox, waitForPopup, pressKey, moveMouseTo,
    dragSelect, clickAt, actionPoint, waitForAction, settle, shot, setViewport, errors,
    close: () => ws.close(),
  };
}

const results = [];
async function check(name, fn) {
  try {
    await fn();
    results.push(`  ok    ${name}`);
  } catch (e) {
    failed = true;
    results.push(`  FAIL  ${name}\n          ${String(e.message).split('\n')[0]}`);
  }
}

const hover = (selector) => `(() => {
  const t = document.querySelector(${JSON.stringify(selector)});
  if (!t) return false;
  t.dispatchEvent(new MouseEvent('mouseenter', { bubbles: false }));
  return true;
})()`;

// --- HSK study guides ------------------------------------------------------

const hsk = await openPage('hsk.html');
await check('hsk.html lists all nine levels', async () => {
  assert.equal(await hsk.waitFor('document.querySelectorAll(".lvl").length', 'level rail'), 9);
});
await check('hsk.html renders the full guide body', async () => {
  await hsk.waitFor('document.querySelectorAll("section[data-section]").length >= 7', 'sections');
  const heads = await hsk.evalJs(
    '[...document.querySelectorAll("section[data-section]")].map(s => s.dataset.section)');
  for (const want of ['Grammar', 'Core vocabulary', 'Reading practice', 'Common mistakes']) {
    assert.ok(heads.includes(want), `missing "${want}"; got ${heads.join(', ')}`);
  }
});
await check('readings are generated, not stored', async () => {
  const reading = await hsk.waitFor(
    'document.querySelector(".word .py")?.textContent || ""', 'vocabulary pinyin');
  assert.match(reading, /[a-zāáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜ]/i, `got "${reading}"`);
});
await check('hovering a passage character opens the universal popup', async () => {
  // A real pointer over a character the reader can actually see. A synthetic
  // mouseenter on an off-screen node exercises the lookup but says nothing
  // about whether the panel lands anywhere visible.
  const at = await hsk.evalJs(`(() => {
    const c = document.querySelector('.passage p .lookup-char');
    if (!c) return null;
    c.scrollIntoView({ block: 'center' });
    const r = c.getBoundingClientRect();
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
  })()`);
  assert.ok(at, 'no hoverable character');
  await hsk.settle();
  await hsk.moveMouseTo(at.x, at.y);
  await hsk.waitFor('document.querySelectorAll(".lookup-hit").length > 0', 'phrase highlight');
  const html = await hsk.popupHtml();
  assert.match(html, /class="popup theme-/, 'the shared popup panel did not render');
  assert.match(html, /☆ save/, 'no save control — this is not the full popup');
  assert.match(html, /Characters|Example sentences|Related words/,
    'the popup rendered without its sections');
  assert.match(html, /navbtn/, 'no back/forward history controls');
  // ...and that it is actually on screen, which reading its HTML cannot tell us.
  const box = await hsk.popupBox();
  assert.ok(box, 'the popup rendered but has no box — it is not being displayed');
  assert.ok(box.width > 100 && box.height > 40, `popup is ${box.width}x${box.height}`);
  const view = await hsk.evalJs('[innerWidth, innerHeight]');
  assert.ok(box.x < view[0] && box.right > 0 && box.y < view[1] && box.bottom > 0,
    `popup is off-screen at ${JSON.stringify(box)} in a ${view.join('x')} viewport`);
});
await check('hovering low on the page still gives a usable popup', async () => {
  // Clear whatever the previous check left open, or this measures that panel
  // at its old position and passes without testing anything.
  await hsk.moveMouseTo(2, 2);
  await hsk.waitFor('document.querySelectorAll(".lookup-hit").length === 0', 'the popup to clear');
  // Pick the lowest character actually visible in the guide — the last line a
  // reader can see is as legitimate a hover target as the first.
  const at = await hsk.evalJs(`(() => {
    const guide = document.getElementById('guide');
    const box = guide.getBoundingClientRect();
    let best = null;
    for (const c of guide.querySelectorAll('.lookup-char')) {
      const r = c.getBoundingClientRect();
      if (r.top < box.top || r.bottom > box.bottom || r.width === 0) continue;
      if (!best || r.top > best.top) best = r;
    }
    return best && { x: Math.round(best.left + best.width / 2),
                     y: Math.round(best.top + best.height / 2),
                     charBottom: Math.round(best.bottom) };
  })()`);
  assert.ok(at, 'no visible character in the guide');
  await hsk.settle();
  await hsk.moveMouseTo(at.x, at.y);
  await hsk.waitFor('document.querySelectorAll(".lookup-hit").length > 0', 'phrase highlight');
  const box = await hsk.popupBox();
  const view = await hsk.evalJs('[innerWidth, innerHeight]');
  assert.ok(box, 'no popup at all');
  assert.ok(box.bottom <= view[1] + 1 && box.y >= -1,
    `popup spills outside the ${view.join('x')} viewport: ${JSON.stringify(box)}`);
  assert.ok(box.height >= 120,
    `popup squeezed to ${box.height}px hovering ${view[1] - at.charBottom}px from the bottom`);
});
await check('a word at the bottom edge flips the popup above the line', async () => {
  await hsk.moveMouseTo(2, 2);
  await hsk.waitFor('document.querySelectorAll(".lookup-hit").length === 0', 'the popup to clear');
  // Park a character hard against the bottom of the guide, which is where
  // "always below the line" used to leave an unreadable sliver hanging off
  // the viewport.
  const at = await hsk.evalJs(`(() => {
    const c = [...document.querySelectorAll('.passage p .lookup-char')].pop();
    c.scrollIntoView({ block: 'end' });
    const r = c.getBoundingClientRect();
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2),
             top: Math.round(r.top), bottom: Math.round(r.bottom) };
  })()`);
  const view = await hsk.evalJs('[innerWidth, innerHeight]');
  assert.ok(view[1] - at.bottom < 160,
    `character is ${view[1] - at.bottom}px from the bottom; not the case under test`);
  await hsk.settle();
  await hsk.moveMouseTo(at.x, at.y);
  await hsk.waitFor('document.querySelectorAll(".lookup-hit").length > 0', 'phrase highlight');
  const box = await hsk.popupBox();
  assert.ok(box, 'no popup');
  assert.ok(box.bottom <= view[1] + 1 && box.y >= -1,
    `popup spills outside the viewport: ${JSON.stringify(box)}`);
  assert.ok(box.height >= 120, `popup squeezed to ${box.height}px`);
  assert.ok(box.bottom <= at.top + 1,
    `popup should sit above the hovered line (char top ${at.top}), got ${JSON.stringify(box)}`);
});
await check('switching level reloads the guide', async () => {
  await hsk.evalJs('document.querySelectorAll(".lvl")[5].click()');
  await hsk.waitFor('document.querySelector(".guide-head h2")?.textContent === "HSK 6"', 'HSK 6');
});
await check('nothing sits above the question box until something is highlighted', async () => {
  const shown = await hsk.evalJs(
    'getComputedStyle(document.getElementById("quoteChip")).display !== "none"');
  assert.equal(shown, false, 'the quote chip is visible with nothing highlighted');
});
// The text of an element without the controls hung off it (a speaker, a star).
const textOf = (selector) => `[...document.querySelector('${selector}').childNodes]
  .filter((n) => n.nodeName !== 'BUTTON').map((n) => n.textContent).join('').trim()`;

// Everything the guide already knows to be a card gets its own star. Saving
// from one has to produce the same card the popup would have saved.
await check('a vocabulary item can be saved from its own star', async () => {
  await hsk.evalJs('chrome.storage.local.set({ wordlist: [] })');
  const word = await hsk.waitFor(
    `document.querySelector(".word .zwe-save:not([disabled])") && ${textOf('.word .zh')}`,
    'a vocabulary star');
  await hsk.evalJs('document.querySelector(".word .zwe-save").click()');
  await hsk.waitFor('document.querySelector(".word .zwe-save").classList.contains("zwe-on")',
    'the star to light up');
  const saved = await hsk.evalJs(
    'chrome.storage.local.get("wordlist").then(r => r.wordlist[0])');
  assert.equal(saved.cardType, 'word', 'a vocabulary item should save as a word card');
  assert.ok(saved.simp.startsWith(word) || word.startsWith(saved.simp),
    `saved "${saved.simp}" for the star beside "${word}"`);
  assert.ok(saved.pinyin, 'the card has no reading');
  assert.ok(saved.defs, 'the card has no definition');
});
await check('a reading passage is savable one sentence at a time', async () => {
  const sentences = await hsk.evalJs('document.querySelectorAll(".passage .sent").length');
  assert.ok(sentences >= 3, `the passage offers ${sentences} savable sentences`);
  const text = await hsk.evalJs(textOf('.passage .sent'));
  await hsk.evalJs('document.querySelector(".passage .sent .zwe-save").click()');
  await hsk.waitFor(
    'document.querySelector(".passage .sent .zwe-save").classList.contains("zwe-on")',
    'the sentence star to light up');
  const saved = await hsk.evalJs(
    'chrome.storage.local.get("wordlist").then(r => r.wordlist[0])');
  assert.equal(saved.cardType, 'sentence');
  assert.equal(saved.simp, text, `saved "${saved.simp}" for the star beside "${text}"`);
  assert.ok(saved.pinyin, 'the sentence card has no reading');
  assert.ok(saved.defs, 'the sentence card has nothing on its back');
});
await check('a real mouse drag selects passage text and offers to save or ask about it', async () => {
  // Drag across the first sentence of the passage the way a reader would.
  const span = await hsk.evalJs(`(() => {
    const p = document.querySelector('.passage .sent');
    p.scrollIntoView({ block: 'center' });
    const chars = p.querySelectorAll('.lookup-char');
    const a = chars[0].getBoundingClientRect();
    const b = chars[7].getBoundingClientRect();
    return {
      from: { x: Math.round(a.left + 1), y: Math.round(a.top + a.height / 2) },
      to: { x: Math.round(b.right - 1), y: Math.round(b.top + b.height / 2) },
    };
  })()`);
  await hsk.dragSelect(span.from, span.to);
  const selected = await hsk.evalJs('getSelection().toString().trim()');
  assert.ok(selected.length >= 5, `the drag selected "${selected}"`);
  const ask = await hsk.waitForAction('ask');
  assert.ok(await hsk.actionPoint('save'), 'the bar offered no way to save the highlight');

  // Travelling to the bar crosses the passage. The hover popup must not open
  // there and cover the very thing being reached for.
  await hsk.moveMouseTo(span.to.x, span.to.y + 4);
  await new Promise((r) => setTimeout(r, 600));
  assert.ok(await hsk.actionPoint('ask'), 'the bar vanished on the way to it');
  assert.doesNotMatch(await hsk.popupHtml(), /class="popup theme-[a-z]+" style="display: block/,
    'the hover popup opened over the selection bar');

  await hsk.clickAt(ask.x, ask.y);
  await hsk.waitFor('!document.getElementById("quoteChip").hidden', 'the quote chip');
  const quoted = await hsk.evalJs('document.getElementById("quoteText").textContent');
  assert.ok(quoted.length >= 5, `the chip quoted "${quoted}"`);
  assert.equal(quoted, selected, 'the chip quoted something other than the selection');
  assert.equal(await hsk.evalJs('CSS.highlights.has("tutor-quote")'), true,
    'the highlighted passage is not marked in the guide');
});
await check('hover lookups resume once the quote is attached', async () => {
  assert.equal(await hsk.evalJs('getSelection().isCollapsed'), true,
    'the live selection outlived the quote and would keep hover suppressed');
  // Attaching the quote opens the drawer, which narrows the document and
  // reflows the guide *under the real pointer* — parked over the passage since
  // the walk to the selection bar. The resulting mouseleave lands after the
  // synthetic mouseenter below and wipes the highlight it asked for. Park the
  // pointer somewhere with nothing hoverable under it first, so the only hover
  // in play is the one this check is testing.
  await hsk.moveMouseTo(3, 3);
  await hsk.settle();
  assert.equal(await hsk.evalJs(hover('.passage p .lookup-char')), true);
  await hsk.waitFor('document.querySelectorAll(".lookup-hit").length > 0', 'phrase highlight');
});
await check('dropping the quote clears the chip and the mark', async () => {
  await hsk.evalJs('document.getElementById("quoteDrop").click()');
  await hsk.waitFor('document.getElementById("quoteChip").hidden', 'the chip to clear');
  assert.equal(await hsk.evalJs('CSS.highlights.has("tutor-quote")'), false);
});
// The guides used to dock the tutor as a third column; it is the same
// right-edge drawer as everywhere else now.
await check('the guides open the tutor as a drawer, not a docked column', async () => {
  assert.equal(await hsk.evalJs('!!document.querySelector(".chat-slot")'), false,
    'the docked column is still in the markup');
  assert.equal(await hsk.evalJs('!!document.querySelector(".tutor.tutor-drawer")'), true,
    'no drawer on the guides');
  // Earlier checks on this page left it open; closing must fall back to the
  // launcher rather than removing the tutor from the page.
  await hsk.evalJs(`(() => {
    const close = document.querySelector('.tutor-close');
    if (!document.querySelector('.tutor').hidden) close.click();
  })()`);
  await hsk.waitFor('document.querySelector(".tutor").hidden', 'the closed drawer');
  assert.equal(await hsk.evalJs('document.getElementById("tutorLauncher").hidden'), false,
    'closing the drawer left no way back into it');
  await hsk.evalJs('document.getElementById("tutorLauncher").click()');
  await hsk.waitFor('!document.querySelector(".tutor").hidden', 'the drawer');
  // Right edge, full height — the same panel the other pages slide out.
  const box = await hsk.evalJs(`(() => {
    const r = document.querySelector('.tutor').getBoundingClientRect();
    return { right: Math.round(innerWidth - r.right), top: Math.round(r.top),
      width: Math.round(r.width) };
  })()`);
  assert.equal(box.right, 0, `drawer is ${box.right}px off the right edge`);
  assert.equal(box.top, 0, 'drawer does not run full height');
  assert.ok(box.width > 200, `drawer is only ${box.width}px wide`);
  await hsk.shot('tutor-drawer-guides');
  await hsk.evalJs('document.querySelector(".tutor-close").click()');
});
await check('hsk.html raised no page errors', () => assert.deepEqual(hsk.errors, []));
hsk.close();

// --- the other surfaces ----------------------------------------------------

// Every standalone page wears the same navbar from lib/shell.js. Asserting the
// tab set here is what stops the drift this replaced: five hand-written navs
// that had grown different link lists, and one still advertising a page that
// no longer existed.
const NAV_TABS = ['Review', 'Library', 'Guides', 'News'];

for (const [page, ready, active] of [
  ['review.html', '!!document.getElementById("app")', 'review'],
  ['wordlist.html', '!!document.getElementById("list")', 'library'],
  ['news.html', '!!document.getElementById("app")', 'news'],
  ['hsk.html', '!!document.getElementById("rail")', 'guides'],
  ['options.html', '!!document.getElementById("saved")', 'options'],
]) {
  const tab = await openPage(page);
  await check(`${page} boots with the shared popup available`, async () => {
    await tab.waitFor(ready, 'the page to render');
    if (page !== 'options.html') {
      assert.equal(await tab.evalJs('!!globalThis.ZhongwenPopup'), true,
        'lib/popup.js did not load');
    }
    assert.deepEqual(tab.errors, []);
  });
  await tab.shot(page.replace('.html', ''));
  await check(`${page} shows the shared navbar with ${active} current`, async () => {
    await tab.waitFor('!!document.querySelector(".zx-header .tab")', 'the navbar');
    assert.deepEqual(
      await tab.evalJs(
        '[...document.querySelectorAll(".zx-header .tab-label")].map(t => t.textContent.trim())'),
      NAV_TABS);
    // Links, not buttons: a standalone page navigates rather than swapping frames.
    assert.equal(await tab.evalJs(
      '[...document.querySelectorAll(".zx-header .tab")].every(t => t.tagName === "A")'), true,
    'standalone tabs should be links');
    const current = await tab.evalJs(
      '(document.querySelector(".zx-header [aria-current=page]") || {}).dataset?.view'
      + ' ?? (document.querySelector(".zx-settings.active") ? "options" : null)');
    assert.equal(current, active);
  });
  tab.close();
}

// The AI key field is the one setup step every new user has to complete, and
// it is the only control on the options page that is written on its own rather
// than through save() — so drive it end to end rather than trusting the boot.
const opts = await openPage('options.html');
await check('the options page saves an AI key and rejects a non-key', async () => {
  // The field is static markup; the status line is written by options.js once
  // it has read storage, so it is what says the handlers are attached.
  await opts.waitFor('!!document.getElementById("aiKeyStatus").textContent', 'the AI key field');
  const type = async (value) => opts.evalJs(`(() => {
    const el = document.getElementById('aiKey');
    el.value = ${JSON.stringify(value)};
    el.dispatchEvent(new Event('change', { bubbles: true }));
  })()`);

  await type('not-a-key');
  await opts.waitFor('/does not look like/.test(document.getElementById("aiKeyStatus").textContent)',
    'the rejection message');
  const stored = () =>
    opts.evalJs('(async () => (await chrome.storage.local.get("aiKey")).aiKey || "")()');
  assert.equal(await stored(), '', 'a malformed key was stored anyway');

  const key = `sk-${'x'.repeat(40)}`;
  await type(key);
  await opts.waitFor('/^Saved /.test(document.getElementById("aiKeyStatus").textContent)',
    'the saved confirmation');
  assert.equal(await stored(), key);
  assert.deepEqual(opts.errors, []);
});
opts.close();

// --- the dashboard: every view is a tab, so the chrome never disappears ----

const dash = await openPage('newtab.html');
await check('the dashboard shows every view as a tab', async () => {
  // The tabs are static markup; wait for newtab.js to have wired them, or a
  // click lands before there is a handler to receive it.
  await dash.waitFor('!!document.querySelector(".tab[aria-selected]")', 'the dashboard script');
  await dash.waitFor('document.querySelectorAll(".tab").length === 4', 'four tabs');
  assert.deepEqual(
    await dash.evalJs('[...document.querySelectorAll(".tab")].map(t => t.dataset.view)'),
    ['review', 'library', 'guides', 'news']);
});
await dash.shot('newtab');
await check('opening a lazy tab keeps the top bar instead of navigating away', async () => {
  await dash.evalJs(
    '[...document.querySelectorAll(".tab")].find(t => t.dataset.view === "guides").click()');
  await dash.waitFor('document.getElementById("guidesFrame").classList.contains("active")',
    'the guides frame');
  assert.equal(await dash.evalJs('document.querySelector(".tab.active").dataset.view'), 'guides');
  assert.equal(await dash.evalJs('!!document.querySelector(".zx-header .zx-brand")'), true,
    'the top bar is gone');
  assert.equal(await dash.evalJs('location.pathname.endsWith("newtab.html")'), true,
    'the dashboard navigated away instead of switching tabs');
});
// Every embedded view must suppress its own standalone title and nav, or the
// dashboard shows two headers stacked on top of each other.
for (const [view, frame] of [
  ['review', 'reviewFrame'], ['library', 'libraryFrame'], ['guides', 'guidesFrame'],
  ['news', 'newsFrame'],
]) {
  await check(`the ${view} tab draws no second header`, async () => {
    await dash.evalJs(
      `[...document.querySelectorAll(".tab")].find(t => t.dataset.view === "${view}").click()`);
    await dash.waitFor(`(() => {
      const d = document.getElementById('${frame}').contentDocument;
      return !!(d && d.body && d.body.classList.contains('embedded') && d.querySelector('h1'));
    })()`, `the ${view} page in embedded mode`);
    // Ancestor display:none does not show up in the element's own computed
    // style, so ask whether it actually occupies space.
    const visible = await dash.evalJs(`(() => {
      const d = document.getElementById('${frame}').contentDocument;
      return ['h1', '.nav'].filter((sel) => {
        const el = d.querySelector(sel);
        return el && el.getClientRects().length > 0;
      });
    })()`);
    assert.deepEqual(visible, [], `${view} still shows: ${visible.join(', ')}`);
  });
}
// The dashboard is how the guides are actually read, and an iframe is a
// different world for a fixed-position panel than a top-level document.
await check('hovering works inside the embedded guides tab', async () => {
  await dash.evalJs(
    '[...document.querySelectorAll(".tab")].find(t => t.dataset.view === "guides").click()');
  await dash.waitFor(`(() => {
    const d = document.getElementById('guidesFrame').contentDocument;
    return !!(d && d.querySelector('.passage p .lookup-char'));
  })()`, 'the guide inside the dashboard');
  // Top-level viewport coordinates for a character inside the frame.
  const at = await dash.evalJs(`(() => {
    const f = document.getElementById('guidesFrame');
    const fr = f.getBoundingClientRect();
    const c = f.contentDocument.querySelector('.passage p .lookup-char');
    c.scrollIntoView({ block: 'center' });
    const r = c.getBoundingClientRect();
    return {
      x: Math.round(fr.left + r.left + r.width / 2),
      y: Math.round(fr.top + r.top + r.height / 2),
    };
  })()`);
  await dash.settle();
  await dash.moveMouseTo(at.x, at.y);
  await dash.waitFor(`(() => {
    const d = document.getElementById('guidesFrame').contentDocument;
    return d.querySelectorAll('.lookup-hit').length > 0;
  })()`, 'the hovered phrase to highlight');
  const box = await dash.popupBox();
  assert.ok(box, 'the popup never rendered inside the dashboard');
  assert.ok(box.width > 100 && box.height > 40, `popup is ${box.width}x${box.height}`);
  const view = await dash.evalJs('[innerWidth, innerHeight]');
  assert.ok(box.x < view[0] && box.right > 0 && box.y < view[1] && box.bottom > 0,
    `popup is off-screen at ${JSON.stringify(box)} in a ${view.join('x')} viewport`);
});
await check('newtab.html raised no page errors', () => assert.deepEqual(dash.errors, []));
dash.close();

// Same bug class as the quote chip: a `display` rule beating the hidden
// attribute left this control permanently on screen.
const newsTab = await openPage('news.html');
await check('news keeps its difficulty control hidden until there is a digest', async () => {
  await newsTab.waitFor('!!document.getElementById("app")', 'the digest container');
  assert.equal(await newsTab.evalJs(
    'getComputedStyle(document.getElementById("difficultyLabel")).display'), 'none');
});
newsTab.close();

// The library is the surface that had no hover at all before.
const library = await openPage('wordlist.html');
await check('a saved word in the library is hoverable', async () => {
  await library.waitFor('!!document.getElementById("list")', 'the list');
  await library.evalJs(`chrome.storage.local.set({ wordlist: [{
    cardType: 'word', simp: '喜欢', trad: '喜歡', pinyin: 'xǐ huan', tones: '3,0',
    defs: 'to like', savedAt: 1, lastSavedAt: 1, touches: 1, srs: null }] })`);
  // The page repaints from storage.onChanged, which the shim does not emit;
  // re-render the way a fresh open would. Stamp the outgoing document so the
  // wait below cannot be satisfied by the rows that are still on screen while
  // the reload is in flight.
  await library.evalJs('window.__stale = true');
  await library.evalJs('location.reload()');
  await library.waitFor(
    '!window.__stale && document.querySelectorAll("td.hanzi .lookup-char").length > 0',
    'the reloaded list');
  assert.equal(await library.evalJs(hover('td.hanzi .lookup-char')), true);
  await library.waitFor('document.querySelectorAll(".lookup-hit").length > 0', 'phrase highlight');
  const html = await library.popupHtml();
  assert.match(html, /class="popup theme-/, 'the library did not get the shared popup');
});
// The library never gates the tutor, so it must be reachable on arrival — it
// was previously constructed with its launcher hidden and nothing to show it.
await check('the library offers the tutor without being asked', async () => {
  assert.equal(await library.evalJs('document.getElementById("tutorLauncher").hidden'), false,
    'the tutor launcher is hidden on a page that never gates it');
  await library.evalJs('document.getElementById("tutorLauncher").click()');
  await library.waitFor('!document.querySelector(".tutor").hidden', 'the tutor drawer');
  await library.waitFor('document.querySelectorAll(".tutor .starter").length > 0',
    'the tutor to populate itself');
});
await check('highlighting a row asks about that word', async () => {
  await library.evalJs(`chrome.storage.local.set({ syncMeta: {
    token: 'smoketokensmoketokensmoketoken', serverUrl: location.origin, cursor: 0, lastPushAt: 0 } })`);
  // Stay inside the first cell: the row also carries a traditional column, and
  // dragging across both would select 喜欢喜歡. Scroll it in first, or the
  // coordinates land on whatever is at the top of the viewport.
  // Scroll first, let layout settle, and only then take coordinates: the tutor
  // drawer narrows the document when it opens, which reflows the table.
  await library.evalJs("document.querySelector('td.hanzi').scrollIntoView({ block: 'center' })");
  await library.settle();
  const span = await library.evalJs(`(() => {
    const chars = document.querySelector('td.hanzi').querySelectorAll('.lookup-char');
    const a = chars[0].getBoundingClientRect();
    const b = chars[chars.length - 1].getBoundingClientRect();
    return {
      from: { x: Math.round(a.left + 1), y: Math.round(a.top + a.height / 2) },
      to: { x: Math.round(b.right - 1), y: Math.round(b.top + b.height / 2) },
    };
  })()`);
  await library.dragSelect(span.from, span.to);
  assert.equal(await library.evalJs('getSelection().toString().trim()'), '喜欢',
    'the drag did not land on the word');
  const ask = await library.waitForAction('ask');
  await library.clickAt(ask.x, ask.y);
  await library.waitFor('!document.getElementById("quoteChip").hidden', 'the quote chip');
  const quoted = await library.evalJs('document.getElementById("quoteText").textContent');
  assert.equal(quoted, '喜欢', `the chip quoted "${quoted}" instead of the highlighted word`);
});
// An answer is text like any other: the reply that half-lands is the thing you
// most want to point at and ask about again.
await check('a reply can itself be highlighted for a follow-up', async () => {
  await library.evalJs(`(() => {
    const box = document.getElementById('question');
    box.value = 'What does this word mean?';
    document.getElementById('composer').requestSubmit();
  })()`);
  await library.waitFor('document.querySelectorAll(".tutor .msg.bot .bubble").length > 0',
    'an answer');
  const span = await library.evalJs(`(() => {
    const p = document.querySelector('.tutor .msg.bot .bubble p');
    const r = p.getBoundingClientRect();
    return {
      from: { x: Math.round(r.left + 2), y: Math.round(r.top + 6) },
      to: { x: Math.round(r.left + 70), y: Math.round(r.top + 6) },
    };
  })()`);
  await library.dragSelect(span.from, span.to);
  const selected = await library.evalJs('getSelection().toString().trim()');
  assert.ok(selected.length > 0, 'the reply could not be selected');
  const ask = await library.waitForAction('ask');
  await library.clickAt(ask.x, ask.y);
  await library.waitFor('!document.getElementById("quoteChip").hidden', 'the follow-up quote');
  await library.evalJs(`(() => {
    const box = document.getElementById('question');
    box.value = 'Say more about that.';
    document.getElementById('composer').requestSubmit();
  })()`);
  await library.waitFor('document.querySelectorAll(".tutor .msg.bot .bubble").length > 1',
    'the follow-up answer');
  const asked = await (await fetch(`${base}/__lastask`)).json();
  assert.equal(asked.selection, selected, 'the follow-up did not carry the highlighted reply');
  assert.match(asked.context.section, /previous answer/,
    'the follow-up was framed as being about the page, not the conversation');
});
// A library of two cards fits anything. This bug only showed up at real size:
// every column but Definition was nowrap, so the table sized itself past the
// page and spilled Next and the delete button onto the background. Seed a
// realistic deck and assert the table stays inside its container.
const BULK = [];
for (let i = 0; i < 97; i++) {
  const sentence = i % 5 === 2;
  BULK.push({
    cardType: sentence ? 'sentence' : 'word',
    simp: sentence ? `看了一场电影${i}` : `不一样${i}`,
    trad: sentence ? '' : '不一樣',
    pinyin: sentence ? 'kàn le yī chǎng diànyǐng' : 'bù yī yàng',
    defs: sentence ? 'Watched a movie. (literally: Saw a movie.)' : 'different; distinctive; unlike',
    savedAt: 1, lastSavedAt: 1 + i, touches: i % 4 === 0 ? 3 : 1,
    srs: i % 3 === 0 ? null
      : { reps: 1, lapses: 0, ease: 2.5, intervalDays: 1, due: Date.now() + 86400000 },
  });
}

// Importing a Pleco deck. Driven through the real flow — parse, resolve every
// headword against the bundled dictionary, preview, drop a row, confirm —
// because the part that matters is that an imported card comes out
// indistinguishable from one saved off a web page.
await check('a Pleco export previews before it imports, and rows can be dropped', async () => {
  await library.setViewport(1365, 900);
  await library.evalJs('chrome.storage.local.set({ wordlist: [] })');
  await library.evalJs('location.reload()');
  await library.waitFor('!!document.getElementById("import")', 'the import button');

  // The file input is driven directly: CDP cannot open a native file picker.
  await library.evalJs(`(() => {
    const text = [
      '电脑[電腦]\\tdian4nao3\\tnoun computer',
      '学习[學習]\\txue2xi2\\tverb to study',
      '蹦极[蹦極]\\tbeng4ji2\\tbungee jumping',
      'Headword\\tPinyin\\tDefinition',
    ].join('\\n');
    const file = new File([text], 'flash.txt', { type: 'text/plain' });
    const dt = new DataTransfer();
    dt.items.add(file);
    const input = document.getElementById('importFile');
    input.files = dt.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  })()`);

  await library.waitFor('!document.getElementById("importPreview").hidden', 'the preview');
  // Nothing may be in the library yet — the preview is a question, not a result.
  assert.equal(await library.evalJs(
    '(async () => ((await chrome.storage.local.get("wordlist")).wordlist || []).length)()'), 0,
  'the import wrote cards before being confirmed');

  const rows = () => library.evalJs(
    '[...document.querySelectorAll(".imp-row .imp-hanzi")].map(e => e.textContent)');
  assert.deepEqual(await rows(), ['电脑', '学习', '蹦极'],
    'the English header row should not have become a card');

  // The dictionary supplies the real definition; Pleco's is only a fallback.
  const first = await library.evalJs(
    'document.querySelector(".imp-row .imp-defs").textContent');
  assert.match(first, /computer/i);
  assert.equal(await library.evalJs(
    'document.querySelectorAll(".imp-row .imp-alt")[0].textContent'), '電腦',
  'the traditional form did not come through');

  // Drop one, and the count on the confirm button follows.
  await library.evalJs(`(() => {
    const row = [...document.querySelectorAll('.imp-row')]
      .find(r => r.textContent.includes('蹦极'));
    row.querySelector('.imp-drop').click();
  })()`);
  await library.waitFor('document.querySelectorAll(".imp-row").length === 2', 'the drop');
  assert.deepEqual(await rows(), ['电脑', '学习']);
  assert.match(await library.evalJs('document.getElementById("importConfirm").textContent'),
    /^Add 2 cards$/);
  await library.shot('pleco-preview');

  await library.evalJs('document.getElementById("importConfirm").click()');
  await library.waitFor('document.getElementById("importPreview").hidden', 'the preview to close');
  await library.waitFor('document.querySelectorAll("#list tbody tr").length === 2', 'the rows');

  const saved = await library.evalJs(
    '(async () => (await chrome.storage.local.get("wordlist")).wordlist)()');
  assert.equal(saved.length, 2, 'the dropped card was imported anyway');
  const computer = saved.find((w) => w.simp === '电脑');
  assert.ok(computer, 'the imported card is missing');
  assert.equal(computer.trad, '電腦');
  assert.equal(computer.cardType, 'word');
  assert.equal(computer.srs, null, 'an imported card should start unstudied');
  // Resolved through lib/cards.js, so it carries what a saved card carries.
  assert.match(computer.pinyin, /diàn\s*nǎo/, `pinyin was ${computer.pinyin}`);
  assert.ok(computer.tones, 'no tone data, so the card cannot be tone-coloured');
  assert.match(computer.defs, /computer/i);
});

await check('importing the same deck twice adds nothing the second time', async () => {
  await library.evalJs(`(() => {
    const file = new File(['电脑[電腦]\\tdian4nao3\\tnoun computer'], 'flash.txt');
    const dt = new DataTransfer();
    dt.items.add(file);
    const input = document.getElementById('importFile');
    input.files = dt.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  })()`);
  await library.waitFor('!document.getElementById("importPreview").hidden', 'the preview');
  assert.equal(await library.evalJs('document.querySelectorAll(".imp-row").length'), 0);
  assert.match(await library.evalJs('document.querySelector(".imp-head").textContent'),
    /0 cards to add.*1 already in your library/);
  assert.equal(await library.evalJs('document.getElementById("importConfirm").disabled'), true);
  await library.evalJs('document.getElementById("importCancel").click()');
  await library.waitFor('document.getElementById("importPreview").hidden', 'the preview to close');
});

// The script toggle. It existed only as a dropdown in Options, and only the
// hover popup read it — the library and the review card always led with
// simplified, so a traditional reader studied the wrong form of their own
// cards.
await check('the script toggle flips the library between simplified and traditional', async () => {
  await library.setViewport(1365, 900);
  await library.evalJs(`chrome.storage.local.set({ wordlist: [{
    cardType: 'word', simp: '电脑', trad: '電腦', pinyin: 'diàn nǎo',
    defs: 'computer', savedAt: 1, lastSavedAt: 1, touches: 1, srs: null }] })`);
  await library.evalJs('chrome.storage.sync.set({ hanziPref: "simp-first" })');
  await library.evalJs('location.reload()');
  await library.waitFor('!!document.querySelector("#list tbody td.hanzi")', 'the row');

  const row = () => library.evalJs(`(() => {
    const tds = [...document.querySelectorAll('#list tbody tr:first-child td')];
    return {
      primary: tds[0].textContent.replace(/[^\u4e00-\u9fff]/g, ''),
      secondary: tds[1].textContent.replace(/[^\u4e00-\u9fff]/g, ''),
      heading: document.querySelectorAll('#list thead th')[1].textContent,
      pressed: document.querySelector('.zx-script-btn[aria-pressed="true"]').dataset.pref,
    };
  })()`);

  const simp = await row();
  assert.deepEqual([simp.primary, simp.secondary], ['电脑', '電腦']);
  assert.equal(simp.heading, 'Trad.');
  assert.equal(simp.pressed, 'simp-first');

  // Flipping repaints in place — no reload, and the second column's heading
  // follows, because it names whichever script you are *not* reading in.
  await library.evalJs('document.querySelector(\'.zx-script-btn[data-pref="trad-first"]\').click()');
  await library.waitFor(
    'document.querySelector("#list tbody td.hanzi").textContent.includes("電")', 'the flip');
  const trad = await row();
  assert.deepEqual([trad.primary, trad.secondary], ['電腦', '电脑']);
  assert.equal(trad.heading, 'Simp.');
  assert.equal(trad.pressed, 'trad-first');
  await library.shot('script-traditional');

  // It is one setting, so it survives a reload and would be there on any page.
  await library.evalJs('location.reload()');
  await library.waitFor('!!document.querySelector("#list tbody td.hanzi")', 'the row');
  assert.equal((await row()).primary, '電腦', 'the choice did not stick');

  await library.evalJs('chrome.storage.sync.set({ hanziPref: "simp-first" })');
  await library.evalJs('location.reload()');
  await library.waitFor('!!document.querySelector("#list tbody td.hanzi")', 'the row');
});

await check('a full library fits its column without overflowing', async () => {
  await library.setViewport(1365, 900);
  await library.evalJs(`chrome.storage.local.set({ wordlist: ${JSON.stringify(BULK)} })`);
  await library.evalJs('location.reload()');
  await library.waitFor('document.querySelectorAll("#list tbody tr").length > 20', 'the rows');

  const m = await library.evalJs(`(() => {
    const list = document.getElementById('list');
    const table = list.querySelector('table');
    const content = document.querySelector('.zx-content');
    const defs = [...document.querySelectorAll('#list tbody tr:first-child td')][3];
    return {
      overflow: table.scrollWidth - list.clientWidth,
      pastContent: Math.round(table.getBoundingClientRect().right
        - content.getBoundingClientRect().right),
      defWidth: Math.round(defs.getBoundingClientRect().width),
      headerCells: document.querySelectorAll('#list thead th').length,
    };
  })()`);
  assert.ok(m.overflow <= 1, `the table overflows its container by ${m.overflow}px`);
  assert.ok(m.pastContent <= 0, `the table spills ${m.pastContent}px past the page column`);
  // The column that carries the meaning must not be the one that gets crushed.
  assert.ok(m.defWidth >= 150, `the definition column collapsed to ${m.defWidth}px`);
  assert.equal(m.headerCells, 8, 'unexpected column count');
  assert.deepEqual(library.errors, []);
});

// Narrower than the table's floor it must scroll inside #list rather than
// squeezing a column to nothing — which is what stacked the header one letter
// per line at 680px.
await check('a narrow window scrolls the table instead of crushing it', async () => {
  await library.setViewport(680, 900);
  await library.evalJs('location.reload()');
  await library.waitFor('document.querySelectorAll("#list tbody tr").length > 20', 'the rows');
  const m = await library.evalJs(`(() => {
    const list = document.getElementById('list');
    const defs = [...document.querySelectorAll('#list tbody tr:first-child td')][3];
    return {
      scrolls: list.scrollWidth > list.clientWidth,
      pageOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      defWidth: Math.round(defs.getBoundingClientRect().width),
    };
  })()`);
  assert.equal(m.scrolls, true, 'the table should scroll inside #list');
  assert.ok(m.pageOverflow <= 1, `the page itself scrolls sideways by ${m.pageOverflow}px`);
  assert.ok(m.defWidth >= 110, `the definition column collapsed to ${m.defWidth}px`);
});

await library.setViewport(1365, 900);
await library.shot('library-wide');
await library.setViewport(880, 900);
await library.shot('library-narrow');
await library.setViewport(680, 900);
await library.shot('library-tiny');
await library.setViewport(1365, 900);

await check('wordlist.html raised no page errors', () => assert.deepEqual(library.errors, []));
library.close();

// --- the review card: silent on the question, full popup on the answer -----

const review = await openPage('review.html');
await check('review defines on the answer but not on the question', async () => {
  await review.waitFor('!!document.getElementById("app")', 'the card container');
  await review.evalJs(`chrome.storage.local.set({ wordlist: [{
    cardType: 'word', simp: '学习', trad: '學習', pinyin: 'xué xí', tones: '2,2',
    defs: 'to learn; to study', savedAt: 1, lastSavedAt: 1, touches: 1, srs: null }] })`);
  await review.evalJs('location.reload()');
  await review.waitFor('!!document.querySelector(".card .hanzi .lookup-char")', 'a card');

  // Question side: hovering the word under test must NOT give away the answer.
  assert.equal(await review.evalJs(hover('.card .hanzi .lookup-char')), true);
  await new Promise((r) => setTimeout(r, 1200));
  assert.equal(await review.evalJs('document.querySelectorAll(".lookup-hit").length'), 0,
    'the question side defined the very word being tested');
  assert.doesNotMatch(await review.popupHtml(), /class="popup theme-[a-z]+" style="display: block/,
    'the popup opened on the question side');

  // Answer side: the full popup, not a reduced one.
  await review.evalJs('document.getElementById("reveal").click()');
  await review.waitFor('!!document.querySelector(".defs")', 'the revealed answer');
  assert.equal(await review.evalJs(hover('.card .hanzi .lookup-char')), true);
  await review.waitFor('document.querySelectorAll(".lookup-hit").length > 0', 'phrase highlight');
  // 学习 is the card under review and so is already in the library: its save
  // control reads as a check, not as an invitation to save it again.
  const html = await review.waitForPopup(/✓ saved/, 'the already-saved marker');
  assert.match(html, /navbtn/, 'no back/forward history controls');
  assert.match(html, /Characters|Example sentences|Related words/, 'no popup sections');
});
// The same control both ways: a check means "in your vocab list", and using it
// again takes the word back out.
await check('the save control removes a word that is already saved', async () => {
  await review.pressKey('s');
  await review.waitForPopup(/☆ save/, 'the control returning to unsaved');
  assert.equal(await review.evalJs(
    'chrome.storage.local.get("wordlist").then(r => (r.wordlist || []).length)'), 0,
  'pressing s on a saved word left it in the library');

  await review.pressKey('s');
  await review.waitForPopup(/✓ saved/, 'the control returning to saved');
  assert.equal(await review.evalJs(
    'chrome.storage.local.get("wordlist").then(r => (r.wordlist || [])[0]?.simp)'), '学习',
  'pressing s again did not put the word back');
});
// Finishing the day used to print "Done!" while the tab still advertised
// unstudied words — indistinguishable from a bug. The panel has to say which
// limit stopped it, and offer a way past.
await check('the end of a session explains itself and can be extended', async () => {
  await review.evalJs('chrome.storage.sync.set({ newPerDay: 2, maxPerDay: 60 })');
  await review.evalJs(`chrome.storage.local.set({ wordlist:
    [['苹果', 'píng guǒ'], ['电脑', 'diàn nǎo'], ['朋友', 'péng yǒu'], ['老师', 'lǎo shī']]
      .map(([simp, pinyin], i) => ({ cardType: 'word', simp, trad: simp, pinyin,
        defs: 'x', savedAt: i + 1, lastSavedAt: i + 1, touches: 1, srs: null })) })`);
  await review.evalJs('location.reload()');
  for (let i = 0; i < 2; i++) {
    await review.waitFor('!!document.getElementById("reveal")', `card ${i + 1}`);
    await review.evalJs('document.getElementById("reveal").click()');
    await review.waitFor('!!document.querySelector(".grade.g-good")', 'grade buttons');
    await review.evalJs('document.querySelector(".grade.g-good").click()');
  }
  await review.waitFor('!!document.querySelector(".summary")', 'the end-of-session panel');
  const text = await review.evalJs('document.querySelector(".summary").textContent');
  assert.match(text, /Done for today/, 'no headline');
  assert.match(text, /2 new words still unstudied/, 'did not say what was held back');
  assert.match(text, /limit of 2/, 'did not name the limit that stopped the session');
  assert.match(text, /Coming up/, 'no forecast');
  assert.match(text, /Where your cards are/, 'no stage breakdown');
  // ...and the escape hatch really hands over more cards.
  await review.evalJs('document.querySelector(".more-btn").click()');
  await review.waitFor('!!document.getElementById("reveal")', 'the pulled-forward cards');
});
await check('the tutor is offered on the answer, never on the question', async () => {
  // Earlier checks work through the session, so seed a card of our own rather
  // than depending on whatever is left in the queue.
  await review.evalJs(`chrome.storage.local.set({ wordlist: [{
    cardType: 'word', simp: '努力', trad: '努力', pinyin: 'nǔ lì', tones: '3,4',
    defs: 'to make an effort; hard-working', savedAt: 1, lastSavedAt: 1,
    touches: 1, srs: null }] })`);
  await review.evalJs('location.reload()');
  await review.waitFor('!!document.querySelector(".card .hanzi .lookup-char")', 'a card');
  assert.equal(await review.evalJs('document.getElementById("tutorLauncher").hidden'), true,
    'the tutor was offered before the answer was shown');

  await review.evalJs('document.getElementById("reveal").click()');
  await review.waitFor('!document.getElementById("tutorLauncher").hidden', 'the tutor launcher');
  await review.evalJs('document.getElementById("tutorLauncher").click()');
  await review.waitFor('!document.querySelector(".tutor").hidden', 'the tutor drawer');
  assert.equal(await review.evalJs('!!document.getElementById("question")'), true,
    'the drawer has no question box');
});
await check('typing a question does not grade the card', async () => {
  const before = await review.evalJs('document.querySelector(".card .hanzi")?.textContent');
  await review.evalJs(`(() => {
    const box = document.getElementById('question');
    box.focus();
    box.value = '1';
    box.dispatchEvent(new KeyboardEvent('keydown', { key: '1', bubbles: true }));
  })()`);
  await new Promise((r) => setTimeout(r, 400));
  assert.equal(await review.evalJs('document.querySelector(".card .hanzi")?.textContent'), before,
    'pressing "1" in the question box graded the card as Again');
});
await check('the tutor asks the Worker with the card as context', async () => {
  await review.evalJs(`chrome.storage.local.set({ syncMeta: {
    token: 'smoketokensmoketokensmoketoken', serverUrl: location.origin, cursor: 0, lastPushAt: 0 } })`);
  await review.evalJs(`(() => {
    const box = document.getElementById('question');
    box.value = 'How is this word actually used?';
    document.getElementById('composer').requestSubmit();
  })()`);
  await review.waitFor('document.querySelectorAll(".tutor .msg.bot .bubble").length > 0',
    'an answer');
  const asked = await (await fetch(`${base}/__lastask`)).json();
  assert.ok(asked, 'the Worker never saw the question');
  assert.equal(asked.question, 'How is this word actually used?');
  assert.match(asked.context.where, /flashcard/);
  assert.match(asked.context.text, /Word card:|Sentence card:/);
});
// One chat, kept and navigable. It used to be a different thread per card,
// silently swapped as you moved, so a question asked two cards ago was
// somewhere you could not get back to.
await check('a chat survives a reload and is the one you come back to', async () => {
  const shown = await review.evalJs(
    '[...document.querySelectorAll(".tutor .msg .bubble")].map(b => b.textContent).join("|")');
  assert.ok(shown.includes('How is this word actually used?'),
    'no conversation on screen to keep');

  await review.evalJs('window.__stale = true');
  await review.evalJs('location.reload()');
  await review.waitFor('!window.__stale && !!document.getElementById("reveal")',
    'the reloaded card');
  await review.evalJs('document.getElementById("reveal").click()');
  await review.waitFor('!document.getElementById("tutorLauncher").hidden', 'the launcher');
  await review.evalJs('document.getElementById("tutorLauncher").click()');
  await review.waitFor('!document.querySelector(".tutor").hidden', 'the drawer');
  await review.waitFor(
    'document.querySelectorAll(".tutor .msg .bubble").length > 0', 'the restored chat');
  const after = await review.evalJs(
    '[...document.querySelectorAll(".tutor .msg .bubble")].map(b => b.textContent).join("|")');
  assert.ok(after.includes('How is this word actually used?'),
    'the conversation did not survive the reload');
});

// The headline of unifying it: the chat opened on the library page is the one
// still on screen on the review card, so a question asked earlier is context
// for the next one rather than stranded on the page it was asked from.
await check('one chat follows you between pages', async () => {
  const shown = await review.evalJs(
    '[...document.querySelectorAll(".tutor .msg .bubble")].map(b => b.textContent).join("|")');
  assert.ok(shown.includes('What does this word mean?'),
    'the library conversation did not carry over to the review card');
  assert.ok(shown.includes('How is this word actually used?'),
    'the review question is not in the same conversation');
});

await check('previous chats are listed and can be reopened', async () => {
  const opener = 'What does this word mean?'; // the chat currently on screen
  await review.evalJs('document.querySelector(".tutor-head .tutor-icon").click()');
  await review.waitFor('document.querySelectorAll(".tutor .msg .bubble").length === 0',
    'an empty new chat');
  await review.evalJs(`(() => {
    const box = document.getElementById('question');
    box.value = 'A second, different question';
    document.getElementById('composer').requestSubmit();
  })()`);
  await review.waitFor('document.querySelectorAll(".tutor .msg.bot .bubble").length > 0',
    'the second answer');

  // The list replaces the log, and names each chat after the question that
  // started it.
  await review.evalJs('document.getElementById("tutorHistory").click()');
  await review.waitFor('!!document.querySelector(".tutor-histlist")', 'the history list');
  const titles = await review.evalJs(
    '[...document.querySelectorAll(".tutor-histopen .title")].map(t => t.textContent)');
  assert.deepEqual(titles.slice(0, 2), ['A second, different question', opener],
    `newest first, named by their opening question; got ${JSON.stringify(titles)}`);
  assert.equal(await review.evalJs('document.querySelector(".tutor-composer").hidden'), true,
    'the composer should step aside for the list');
  await review.shot('tutor-history');

  // Reopening the older one brings its messages back, and does not run the two
  // conversations together.
  await review.evalJs(`(() => {
    const rows = [...document.querySelectorAll('.tutor-histopen')];
    rows.find(r => r.textContent.includes(${JSON.stringify(opener)})).click();
  })()`);
  await review.waitFor('!document.querySelector(".tutor-composer").hidden', 'the composer');
  const reopened = await review.evalJs(
    '[...document.querySelectorAll(".tutor .msg .bubble")].map(b => b.textContent).join("|")');
  assert.ok(reopened.includes('How is this word actually used?'), 'the old chat did not reopen');
  assert.ok(!reopened.includes('A second, different question'),
    'the two conversations ran together');

  // And back out to the newest, so the next check starts where it expects to.
  await review.evalJs('document.getElementById("tutorHistory").click()');
  await review.waitFor('!!document.querySelector(".tutor-histlist")', 'the history list');
  await review.evalJs(`(() => {
    document.querySelectorAll('.tutor-histopen')[0].click();
  })()`);
  await review.waitFor('!document.querySelector(".tutor-composer").hidden', 'the composer');
});

await check('the drawer stays open across cards until it is closed', async () => {
  assert.equal(await review.evalJs('document.querySelector(".tutor").hidden'), false);
  await review.evalJs('[...document.querySelectorAll(".grade")][2].click()');
  await review.waitFor('!!document.querySelector("#reveal") || !!document.querySelector(".summary")',
    'the next card or the summary');
  const next = await review.evalJs('!!document.querySelector("#reveal")');
  if (!next) return; // deck exhausted; nothing more to assert
  assert.equal(await review.evalJs('document.querySelector(".tutor").hidden'), true,
    'the tutor stayed up on the question side');
  await review.evalJs('document.getElementById("reveal").click()');
  await review.waitFor('!document.querySelector(".tutor").hidden',
    'the drawer to come back on the answer');
});
await check('review.html raised no page errors', () => assert.deepEqual(review.errors, []));
review.close();

// --- the content script on an ordinary web page ----------------------------

const web = await openPage('__page');
await check('the content script defines the phrase under the cursor on a web page', async () => {
  await web.waitFor('!!document.getElementById("t")', 'the test page');
  // 我很喜欢学习中文。 — point at the SECOND character of 喜欢 (index 3). The
  // popup must resolve the containing word, not the single character.
  const at = await web.evalJs(`(() => {
    const node = document.getElementById('t').firstChild;
    const r = document.createRange();
    r.setStart(node, 3); r.setEnd(node, 4);
    const b = r.getBoundingClientRect();
    return { x: Math.round(b.left + b.width / 2), y: Math.round(b.top + b.height / 2) };
  })()`);
  await web.moveMouseTo(at.x, at.y);
  await web.waitFor('CSS.highlights.has("zwe-word")', 'the page highlight');
  const html = await web.popupHtml();
  assert.match(html, /class="popup theme-/, 'the popup did not open on a web page');
  assert.match(html, /喜欢|喜歡/, 'the popup did not resolve the containing word 喜欢');
  assert.match(html, /☆ save/, 'no save control');
});
// Hovering saves the word the popup looked up. Highlighting saves whatever the
// reader points at — which is the only way a phrase nobody wrote for a learner
// becomes a card.
await check('highlighting a phrase on a web page offers to save it', async () => {
  await web.evalJs('chrome.storage.local.set({ wordlist: [] })');
  const span = await web.evalJs(`(() => {
    const node = document.getElementById('t').firstChild;
    const r = document.createRange();
    r.setStart(node, 2); r.setEnd(node, 6);            // 喜欢学习
    const a = r.getClientRects()[0];
    return {
      from: { x: Math.round(a.left + 2), y: Math.round(a.top + a.height / 2) },
      to: { x: Math.round(a.right - 2), y: Math.round(a.top + a.height / 2) },
    };
  })()`);
  await web.dragSelect(span.from, span.to);
  const selected = await web.evalJs('getSelection().toString().trim()');
  assert.equal(selected, '喜欢学习', `the drag selected "${selected}"`);
  const save = await web.waitForAction('save');
  await web.clickAt(save.x, save.y);
  const saved = await web.waitFor(
    'chrome.storage.local.get("wordlist").then(r => r.wordlist[0] || null)', 'the saved card');
  assert.equal(saved.simp, '喜欢学习');
  assert.equal(saved.cardType, 'sentence', 'a phrase with no headword saves as a sentence card');
  assert.match(saved.pinyin, /xǐ.?huan/, `no reading: "${saved.pinyin}"`);
  assert.match(saved.defs, /喜欢|学习/, `no gloss on the back: "${saved.defs}"`);
});
await check('a paragraph is refused, with a reason instead of a card', async () => {
  await web.evalJs(`(() => {
    const p = document.createElement('p');
    p.id = 'para';
    p.textContent = '今天天气很好。我想去公园。你要一起来吗？';
    document.body.append(p);
  })()`);
  const span = await web.evalJs(`(() => {
    const r = document.createRange();
    r.selectNodeContents(document.getElementById('para').firstChild);
    const rects = r.getClientRects();
    const a = rects[0];
    const b = rects[rects.length - 1];
    return {
      from: { x: Math.round(a.left + 2), y: Math.round(a.top + a.height / 2) },
      to: { x: Math.round(b.right - 2), y: Math.round(b.top + b.height / 2) },
    };
  })()`);
  await web.dragSelect(span.from, span.to);
  await web.waitForAction('save');
  await new Promise((r) => setTimeout(r, 400));
  const html = await web.popupHtml();
  assert.match(html, /more than one sentence/,
    'the bar offered no explanation for refusing a paragraph');
  assert.match(html, /data-action="save"[^>]*disabled/,
    'the save action was still clickable for a paragraph');
});
// Most text selected on the web is not Chinese. Nothing should float under it.
await check('selecting English text raises no bar at all', async () => {
  const span = await web.evalJs(`(() => {
    const p = document.createElement('p');
    p.id = 'en';
    p.textContent = 'nothing to see here';
    document.body.append(p);
    const r = document.createRange();
    r.selectNodeContents(p.firstChild);
    const b = r.getClientRects()[0];
    return {
      from: { x: Math.round(b.left + 2), y: Math.round(b.top + b.height / 2) },
      to: { x: Math.round(b.right - 2), y: Math.round(b.top + b.height / 2) },
    };
  })()`);
  await web.dragSelect(span.from, span.to);
  assert.ok(await web.evalJs('getSelection().toString().trim().length > 0'), 'nothing selected');
  await new Promise((r) => setTimeout(r, 700));
  assert.equal(await web.actionPoint('save'), null, 'a save bar appeared over English text');
  assert.doesNotMatch(await web.popupHtml(), /<div class="bar"[^>]*><button/,
    'an empty bar was left on screen');
});
await check('the test page raised no errors', () => assert.deepEqual(web.errors, []));
web.close();

console.log(results.join('\n'));
console.log(failed ? '\nextension-smoke: FAILED' : '\nextension-smoke: all checks passed');
process.exit(failed ? 1 : 0);
