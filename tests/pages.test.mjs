// Wiring checks for the universal popup (extension/lib/popup.js).
//
// popup.js is a classic script that publishes globalThis.ZhongwenPopup, and
// every consumer reads that global at module-evaluation time. If a page
// imports lib/lookup.js but forgets the <script src="lib/popup.js"> tag — or
// puts it after the module — the page throws on load and the popup silently
// stops working on that surface only. Nothing else catches that, so it is
// checked here.
// Run: node tests/pages.test.mjs

import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const extDir = join(root, 'extension');
const read = (p) => readFileSync(join(extDir, p), 'utf8');

let passed = 0;
function test(name, fn) {
  try {
    fn();
    passed++;
  } catch (e) {
    console.error(`FAIL: ${name}`);
    throw e;
  }
}

const htmlFiles = readdirSync(extDir).filter((f) => f.endsWith('.html'));
const jsFiles = readdirSync(extDir).filter((f) => f.endsWith('.js'));

// page module -> does it (transitively, one level) pull in lib/lookup.js?
const usesLookup = new Set(
  jsFiles.filter((f) => /from '\.\/lib\/lookup\.js'/.test(read(f))),
);

// Same trap, second global: a page that reads ZhongwenSaveCard without loading
// lib/savecard.js first throws on load and loses every save control it has.
const usesSaveCard = new Set(
  jsFiles.filter((f) => /globalThis\.ZhongwenSaveCard/.test(read(f))),
);

// The <script type="module"> entry point of a page, if it has one.
function moduleOf(source) {
  return jsFiles.find((js) => source.includes(`<script type="module" src="${js}">`));
}

function assertLoadedFirst(html, source, module, lib) {
  const at = source.indexOf(`<script src="${lib}"></script>`);
  assert.notEqual(at, -1, `${html} loads ${module}, which needs ${lib}, but never loads it`);
  assert.ok(at < source.indexOf(`<script type="module" src="${module}">`),
    `${html} loads ${lib} after ${module}; the global must exist first`);
}

test('every page whose module needs the popup loads popup.js first, as a classic script', () => {
  assert.ok(usesLookup.size >= 4, `expected several lookup consumers, found ${usesLookup.size}`);
  for (const html of htmlFiles) {
    const source = read(html);
    const module = moduleOf(source);
    if (!module || !usesLookup.has(module)) continue;
    assertLoadedFirst(html, source, module, 'lib/popup.js');
  }
});

test('every page whose module needs a save control loads savecard.js first', () => {
  assert.ok(usesSaveCard.size >= 4,
    `expected several savecard consumers, found ${usesSaveCard.size}`);
  for (const html of htmlFiles) {
    const source = read(html);
    const module = moduleOf(source);
    if (!module || !usesSaveCard.has(module)) continue;
    assertLoadedFirst(html, source, module, 'lib/savecard.js');
  }
});

test('the content script loads both classic libraries ahead of content.js', () => {
  const manifest = JSON.parse(read('manifest.json'));
  const js = manifest.content_scripts[0].js;
  assert.deepEqual(js, ['lib/popup.js', 'lib/savecard.js', 'content.js']);
});

test('popup.js is a classic script, not a module', () => {
  const source = read('lib/popup.js');
  assert.ok(!/^\s*(export|import)\s/m.test(source),
    'popup.js must not use import/export — content scripts cannot be modules');
  assert.ok(source.includes('globalThis.ZhongwenPopup'), 'popup.js must publish the global');
});

test('savecard.js is a classic script, not a module', () => {
  const source = read('lib/savecard.js');
  assert.ok(!/^\s*(export|import)\s/m.test(source),
    'savecard.js must not use import/export — content scripts cannot be modules');
  assert.ok(source.includes('globalThis.ZhongwenSaveCard'),
    'savecard.js must publish the global');
});

// What may become a card — a word, a phrase, or one sentence, never a
// paragraph — is decided once, in lib/cards.js, and asked for over
// resolveCards. A second copy of the rule in a page would drift from it, and
// the two would disagree about the same highlighted text.
test('only lib/cards.js decides what may become a card', () => {
  const rule = /MAX_CARD_CHARS|multi-sentence/;
  const owners = new Set(['lib/cards.js', 'background.js', 'lib/savecard.js']);
  for (const file of [...jsFiles, ...readdirSync(join(extDir, 'lib')).map((f) => `lib/${f}`)]) {
    if (owners.has(file)) continue;
    assert.ok(!rule.test(read(file)),
      `${file} repeats the card-size rule; that belongs in lib/cards.js`);
  }
  // savecard.js may name the refusals, but must not decide them itself.
  assert.ok(!/MAX_CARD_CHARS/.test(read('lib/savecard.js')),
    'lib/savecard.js must ask the worker rather than measure cards itself');
});

// The tutor used to float its own "Ask about this" bubble. Two floating
// affordances over one highlight is one too many.
test('the tutor asks through the shared selection bar', () => {
  const source = read('lib/tutor.js');
  assert.ok(!source.includes('tutor-ask-bubble'),
    'lib/tutor.js still builds its own selection bubble');
  assert.ok(source.includes('selectionBar?.addAction'),
    'lib/tutor.js must contribute its ask action to the shared bar');
  for (const page of ['hsk.js', 'news.js', 'review.js', 'wordlist.js']) {
    assert.ok(read(page).includes('selectionBar'),
      `${page} must give its tutor a selection bar`);
  }
});

// The whole point of the refactor: one popup implementation. A second copy of
// the rendering code would drift.
test('only popup.js renders the popup', () => {
  for (const file of ['content.js', 'lib/lookup.js']) {
    const source = read(file);
    assert.ok(!source.includes('mini-popup'),
      `${file} builds popup internals; that belongs in lib/popup.js`);
    assert.ok(!/Example sentences|Related words/.test(source),
      `${file} renders popup sections; that belongs in lib/popup.js`);
  }
});

// Same rule as the popup: one chat, mounted in several places. A page that
// talked to /api/ask itself would drift from the others.
test('only lib/tutor.js implements the chat', () => {
  // Prose about the endpoint is fine; calling it is not.
  const code = (file) => read(file)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n').filter((line) => !line.trim().startsWith('//')).join('\n');
  const consumers = jsFiles.filter((f) => /from '\.\/lib\/tutor\.js'/.test(read(f)));
  assert.ok(consumers.length >= 3, `expected several tutor consumers, found ${consumers.length}`);
  for (const file of jsFiles) {
    const source = code(file);
    assert.ok(!source.includes('/api/ask'),
      `${file} calls /api/ask directly; that belongs in lib/tutor.js`);
    assert.ok(!source.includes('tutorChatLog'),
      `${file} touches tutor storage directly; that belongs in lib/tutor.js`);
  }
});

// The review page grades with the number keys, so an unguarded keydown handler
// would grade the card while the learner types a question.
test('review guards its keyboard shortcuts against typing', () => {
  const source = read('review.js');
  const handler = source.slice(source.indexOf("document.addEventListener('keydown'"));
  assert.match(handler.slice(0, 400), /isTyping\(e\.target\)/,
    'review.js grades on keydown without checking whether a field has focus');
});

test('the HSK page ships with the guide data it renders', () => {
  const hsk = read('hsk.js');
  assert.ok(hsk.includes("from './guides/index.js'"), 'hsk.js must import the guides');
  assert.ok(hsk.includes("type: 'pinyinBatch'"),
    'hsk.js must ask the service worker for readings rather than storing them');
  assert.ok(read('background.js').includes('pinyinBatch: handlePinyinBatch'),
    'background.js must answer pinyinBatch');
});

// Any Chinese anywhere in the app should open the popup. The exceptions are
// never deliberate — a run of hanzi gets rendered with the plain el() helper
// instead of lookup.hoverable() and nothing complains, because it looks right;
// it just does not respond to the pointer. The news glossary shipped that way,
// which is the worst place for it: the stretch words are the hardest Chinese on
// the page and the ones most worth looking up.
test('every run of hanzi a page prints is hoverable', () => {
  // (file, the element that must be built with lookup.hoverable, why)
  const mustHover = [
    ['news.js', "'gloss-word'", 'the stretch vocabulary list'],
    // Matched on `data.topics` rather than the class: the chip row also holds
    // an English "reading at HSK 2" chip, which is not Chinese and not hoverable.
    ['news.js', 'data.topics', 'the topic chips, which come back in Chinese'],
    ['wordlist.js', "'imp-hanzi'", 'headwords in the Pleco import preview'],
  ];
  for (const [file, marker, what] of mustHover) {
    const source = read(file);
    const at = source.indexOf(marker);
    assert.notEqual(at, -1, `${file} no longer renders ${marker} — update this list`);
    // The call has to be lookup.hoverable(...), not el(...): find the opening
    // of the statement this class name belongs to.
    const line = source.slice(source.lastIndexOf('\n', at) + 1, source.indexOf('\n', at));
    assert.match(line, /lookup\.hoverable\(/,
      `${file}: ${what} (${marker}) is rendered as plain text, so it cannot be hovered`);
  }
});

console.log(`pages.test.mjs: ${passed} tests passed`);
