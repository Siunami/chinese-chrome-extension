// End-to-end test of the PWA against a running sync Worker (wrangler dev or
// deployed): seeds a deck through the API, boots the real app in headless
// Chrome with a QR-style pairing URL, reviews a card by clicking through the
// UI, and asserts the grade reached the server.
// Usage: node scripts/pwa-e2e.mjs [baseUrl]   (default http://localhost:8787)

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const base = process.argv[2] || 'http://localhost:8787';
const chromePath = process.env.CHROME ||
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const token = 'e2e-' + crypto.randomUUID().replaceAll('-', '');

// --- seed a deck through the API ------------------------------------------
const now = Date.now();
const seed = [
  { cardType: 'word', simp: '喜欢', trad: '喜歡', pinyin: 'xǐ huan', tones: '3,0',
    defs: 'to like; to be fond of', savedAt: now, lastSavedAt: now, touches: 1,
    srs: { due: now - 60000, ivl: 1, ease: 2.5, reps: 1, lapses: 0, reviewedAt: now - 864e5 },
    sourceWord: '' },
  { cardType: 'word', simp: '学习', trad: '學習', pinyin: 'xué xí', tones: '2,2',
    defs: 'to learn; to study', savedAt: now, lastSavedAt: now, touches: 1,
    srs: null, sourceWord: '' },
];
const seedRes = await fetch(`${base}/api/sync`, {
  method: 'POST',
  headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
  body: JSON.stringify({ since: 0, cards: seed }),
});
assert.equal(seedRes.status, 200, 'seed push');
await seedRes.json();

// --- boot Chrome with CDP --------------------------------------------------
const profile = mkdtempSync(join(tmpdir(), 'zw-e2e-'));
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run',
  `--user-data-dir=${profile}`, '--remote-debugging-port=0', 'about:blank',
], { stdio: 'ignore' });

async function debuggerUrl() {
  const portFile = join(profile, 'DevToolsActivePort');
  for (let i = 0; i < 100; i++) {
    try {
      return Number(readFileSync(portFile, 'utf8').split('\n')[0]);
    } catch {
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  throw new Error('Chrome did not expose a DevTools port');
}

const port = await debuggerUrl();
const created = await (await fetch(
  `http://127.0.0.1:${port}/json/new?${encodeURIComponent(`${base}/#pair=${token}`)}`,
  { method: 'PUT' },
)).json();

const ws = new WebSocket(created.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  ws.onopen = resolve;
  ws.onerror = reject;
});

let msgId = 0;
const pending = new Map();
ws.onmessage = (event) => {
  const msg = JSON.parse(event.data);
  if (msg.id && pending.has(msg.id)) {
    pending.get(msg.id)(msg);
    pending.delete(msg.id);
  }
};

function cdp(method, params = {}) {
  const id = ++msgId;
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve, reject) => {
    pending.set(id, (msg) => (msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result)));
  });
}

async function evalJs(expression) {
  const { result, exceptionDetails } = await cdp('Runtime.evaluate', {
    expression, returnByValue: true, awaitPromise: true,
  });
  if (exceptionDetails) throw new Error(exceptionDetails.exception?.description || 'JS error');
  return result.value;
}

async function waitFor(expression, label, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await evalJs(expression);
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${label}`);
    await new Promise((r) => setTimeout(r, 250));
  }
}

let failed = null;
try {
  await cdp('Runtime.enable');

  // Boot: pairing token consumed, sync ran, review view shows a card.
  const hanzi = await waitFor(
    "document.querySelector('#view .hanzi')?.textContent || ''", 'review card');
  assert.ok(['喜欢', '学习'].includes(hanzi), `unexpected card: ${hanzi}`);
  console.log(`boot ok — showing ${hanzi}`);

  // Token stripped from the URL after pairing.
  assert.equal(await evalJs('location.hash'), '');

  // Reveal, check answer, grade Good.
  await evalJs("document.querySelector('#view button.reveal').click()");
  await waitFor("!!document.querySelector('#view .defs')", 'answer reveal');

  // Tap-to-define: tapping a hanzi on the revealed answer opens the detail
  // sheet with full dictionary entries (first open waits for the ~13 MB
  // dictionary download + parse).
  await evalJs("document.querySelector('#view .hanzi .tap-char').click()");
  assert.ok(await evalJs("!!document.querySelector('.sheet-overlay.open')"),
    'detail sheet opened');
  await waitFor("!!document.querySelector('.sheet-entry')", 'dictionary entries', 60000);
  const sheetWord = await evalJs(
    "document.querySelector('.sheet-word')?.textContent || ''");
  assert.equal(sheetWord, hanzi, 'sheet shows the chunk-aware word');
  assert.ok(await evalJs("document.querySelectorAll('.sheet-sense').length >= 1"),
    'definition senses render');
  assert.ok(await evalJs("document.querySelectorAll('.sheet-char-row').length >= 2"),
    'per-character breakdown renders');
  assert.ok(await evalJs("document.querySelectorAll('.sheet-example').length >= 1"),
    'example sentences render');
  // Drill into the first character, then back out.
  const firstChar = Array.from(hanzi)[0];
  await evalJs("document.querySelector('.sheet-char-row').click()");
  await waitFor(
    `(document.querySelector('.sheet-word')?.textContent || '') === ${JSON.stringify(firstChar)}`,
    'character page');
  await evalJs("document.querySelector('.sheet-back').click()");
  await waitFor(
    `(document.querySelector('.sheet-word')?.textContent || '') === ${JSON.stringify(hanzi)}`,
    'back to word page');
  await evalJs("document.querySelector('.sheet-close').click()");
  assert.equal(await evalJs("!!document.querySelector('.sheet-overlay.open')"), false,
    'sheet closed');
  console.log('detail sheet ok — entries, characters, examples, navigation');

  await evalJs("document.querySelector('#view button.g-good').click()");
  await waitFor(
    `(document.querySelector('#view .hanzi')?.textContent || '') !== ${JSON.stringify(hanzi)}` +
    " || !!document.querySelector('#view .done')", 'next card after grading');
  // Regression check: the next card must start face-down (reveal button
  // showing, no answer), not pre-revealed.
  if (await evalJs("!!document.querySelector('#view .hanzi')")) {
    assert.equal(await evalJs("!!document.querySelector('#view .defs')"), false,
      'next card leaked its answer');
    assert.equal(await evalJs("!!document.querySelector('#view button.reveal')"), true,
      'next card missing reveal button');
  }
  console.log('review flow ok — graded one card, next card face-down');

  // The grade must reach the server (session-end or visibility sync may not
  // have fired yet, so poke the app's own sync from inside the page).
  await evalJs("import('./sync.js').then(m => m.syncNow())");
  const pull = await fetch(`${base}/api/sync`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ since: 0, cards: [] }),
  }).then((r) => r.json());
  const graded = pull.cards.find((c) => c.simp === hanzi);
  assert.ok(graded.srs && graded.srs.reviewedAt >= now, 'grade reached the server');
  console.log('sync ok — grade visible on the server');

  // Words tab renders both cards.
  await evalJs("document.querySelector('nav button[data-tab=words]').click()");
  const count = await waitFor(
    "document.querySelectorAll('#view .word-row').length", 'word list');
  assert.equal(count, 2);
  console.log('word list ok — 2 cards');
} catch (err) {
  failed = err;
} finally {
  ws.close();
  const exited = new Promise((resolve) => chrome.once('exit', resolve));
  chrome.kill();
  await Promise.race([exited, new Promise((r) => setTimeout(r, 3000))]);
  try {
    rmSync(profile, { recursive: true, force: true });
  } catch {
    // Chrome can still be flushing the profile; a leftover tmp dir is fine.
  }
}

if (failed) {
  console.error('FAIL:', failed.message);
  process.exit(1);
}
console.log('OK — PWA end-to-end test passed against', base);
