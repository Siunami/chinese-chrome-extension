// The fake browser the extension's own pages are driven in.
//
// Chrome no longer honours --load-extension, so instead of installing the
// extension this serves extension/ over http and injects a small `chrome` shim
// before any page script runs. Only the transport is faked: the shim forwards
// runtime.sendMessage to Node, where the REAL background handlers run against
// the REAL bundled dictionary. Everything the page does — module load order,
// the shared popup, the guides, hover-to-define — is the shipped code.
//
// Importing this starts a server and a headless Chrome, and gives you
// `openPage(name)` to drive one. Two scripts share it: extension-smoke.mjs,
// which asserts against what it finds, and screenshots.mjs, which photographs
// it. A screenshot taken through the same harness as the tests cannot drift
// from what the tests are checking, which is the point of it living here.
//
//   CHROME=/path/to/chrome    override the browser.

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
import { buildScriptMap, convertText } from '../extension/lib/script.js';
import { cardKey } from '../extension/lib/merge.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const extDir = join(root, 'extension');
const chromePath = process.env.CHROME ||
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

// --- the real lookup engine, as the service worker would run it ------------

const entries = parseDictTSV(readFileSync(join(extDir, 'data/dict.tsv'), 'utf8'));
const index = buildIndex(entries);
const relatedIndex = buildRelatedIndex(entries);
const scriptMap = buildScriptMap(entries);
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
  convertScript: (msg) => ({
    texts: (msg.texts || []).map(
      (t) => convertText(index, entries, scriptMap, String(t ?? ''), msg.to)),
  }),
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

// A scripted examiner for the placement interview. It plays a learner who is
// comfortable up to PLACEMENT_CEILING and lost above it, so a run driven
// through it must converge on that level — which is the only way to test that
// the ladder, the transport and the report agree end to end. Every request is
// kept so a test can assert the rubric, the deck and the transcript travelled.
const PLACEMENT_CEILING = 4;
const placementCalls = [];

function placementTurn(body) {
  const answered = Number(body.answeredLevel) || Number(body.target);
  const held = answered <= PLACEMENT_CEILING;
  const marked = body.answer || (body.history || []).length;
  const assess = marked ? {
    comprehension: held ? 3 : 0,
    production: held ? 3 : 0,
    // One correction per marked turn, so the report has something to save.
    errors: held ? [] : [{
      span: '我是很好',
      correction: '我很好',
      note: 'No 是 before an adjective.',
    }],
    vocabUsed: [],
    comment: held ? 'Answered the question.' : 'Did not get the question.',
  } : null;
  return {
    // Pick from the band the ladder offered, which is what a real examiner
    // does once it has marked the answer above.
    level: (body.allowed || [body.target]).includes(body.target)
      ? body.target : (body.allowed || [body.target])[0],
    reply: body.finish ? '今天就到这里，谢谢你！' : '你今天做了什么？',
    taskType: body.finish ? 'wind-down' : 'question',
    assess,
    result: body.finish ? {
      summary: 'Comfortable with everyday topics, out of depth on abstract ones.',
      strengths: ['Daily routine and preferences'],
      gaps: ['Abstract and formal registers'],
      advice: ['Read one short article a day'],
    } : null,
    generatedAt: 1,
  };
}

// The fake deployment describes itself the way the shared Worker does: it has
// no provider key of its own and expects the caller to bring one. That is what
// makes the navbar's "Add your API key" notice appear for a paired browser
// with no key, which is a state worth being able to drive.
const server = createServer(async (req, res) => {
  if (req.url === '/api/health') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true, ai: { configured: false, requiresUserKey: true } }));
    return;
  }
  if (req.url === '/api/placement') {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const body = JSON.parse(Buffer.concat(chunks).toString());
    placementCalls.push(body);
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(placementTurn(body)));
    return;
  }
  if (req.url === '/__placement') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(placementCalls));
    return;
  }
  if (req.url === '/api/ask') {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    lastAsk = JSON.parse(Buffer.concat(chunks).toString());
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({
      answer: '这个词很常用。It is used for studying in general.',
      // The real Worker reports back how many pictures it took, which is how
      // the drawer tells a current deployment from one that drops them.
      sawImages: (lastAsk.images || []).length,
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
export const base = `http://127.0.0.1:${server.address().port}`;

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

export async function openPage(page) {
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
  // `scale` is the device pixel ratio: 2 for a screenshot anyone will look at,
  // 1 for a measurement, where doubling the pixels buys nothing.
  async function setViewport(width, height, scale = 1) {
    await cdp('Emulation.setDeviceMetricsOverride', {
      width, height, deviceScaleFactor: scale, mobile: false,
    });
  }

  // Base64 PNG of the viewport, for a caller that wants to keep it.
  async function png() {
    const { data } = await cdp('Page.captureScreenshot', { format: 'png' });
    return data;
  }

  async function shot(name) {
    if (!process.env.ZX_SHOTS) return;
    writeFileSync(join(process.env.ZX_SHOTS, `${name}.png`), Buffer.from(await png(), 'base64'));
  }

  return {
    page, evalJs, waitFor, popupHtml, popupBox, waitForPopup, pressKey, moveMouseTo,
    dragSelect, clickAt, actionPoint, waitForAction, settle, shot, png, setViewport, errors,
    close: () => ws.close(),
  };
}
