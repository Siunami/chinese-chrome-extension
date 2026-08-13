// Integration smoke test for the extension's own pages, driven in headless
// Chrome through scripts/harness.mjs — the shipped code, a faked transport, and
// the real dictionary running in Node. See that file for how the browser is
// stood up; everything below is what we assert about it.
//
// Usage: node scripts/extension-smoke.mjs
//   CHROME=/path/to/chrome    override the browser.
//   ZX_SHOTS=/some/dir        also write a PNG of each page. Off by default;
//                             every assertion here can pass on a page that
//                             looks wrong, and twice now one did.

import assert from 'node:assert/strict';
import { base, openPage } from './harness.mjs';

let failed = false;

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

// The tutor drawer is one switch for the whole profile, so it may already be
// open when a page arrives — it follows you from the page before. "Open it"
// therefore means "press the switch unless it is already pressed", not "press
// the switch", which would close it.
async function openDrawer(page) {
  await page.waitFor('!document.getElementById("tutorToggle").disabled', 'the Ask switch');
  await page.evalJs(`(() => {
    if (document.querySelector('.tutor').hidden) document.getElementById('tutorToggle').click();
  })()`);
  await page.waitFor('!document.querySelector(".tutor").hidden', 'the tutor drawer');
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
  // Earlier checks on this page left it open; closing must leave the navbar's
  // Ask switch un-pressed rather than removing the tutor from the page.
  await hsk.evalJs(`(() => {
    const close = document.querySelector('.tutor-close');
    if (!document.querySelector('.tutor').hidden) close.click();
  })()`);
  await hsk.waitFor('document.querySelector(".tutor").hidden', 'the closed drawer');
  assert.equal(await hsk.evalJs('document.getElementById("tutorToggle").hidden'), false,
    'closing the drawer left no way back into it');
  await hsk.waitFor('document.getElementById("tutorToggle").getAttribute("aria-pressed") === "false"',
    'the switch to come back up');
  await hsk.evalJs('document.getElementById("tutorToggle").click()');
  await hsk.waitFor('!document.querySelector(".tutor").hidden', 'the drawer');
  // It slides in; measuring mid-slide reads the transform, not the layout.
  await hsk.waitFor('document.querySelector(".tutor").getAnimations().length === 0',
    'the drawer to finish sliding');
  // The right-hand strip below the navbar, which stays where it is: the drawer
  // takes its width out of the page, not out of the bar.
  const box = await hsk.evalJs(`(() => {
    const r = document.querySelector('.tutor').getBoundingClientRect();
    const head = document.querySelector('.zx-header').getBoundingClientRect();
    return { right: Math.round(innerWidth - r.right), top: Math.round(r.top),
      width: Math.round(r.width), left: Math.round(r.left),
      headHeight: Math.round(head.height), headRight: Math.round(innerWidth - head.right),
      bodyRight: Math.round(document.querySelector('.layout').getBoundingClientRect().right) };
  })()`);
  assert.equal(box.right, 0, `drawer is ${box.right}px off the right edge`);
  assert.equal(box.top, box.headHeight,
    'the drawer covers the navbar instead of starting under it');
  assert.ok(box.width > 200, `drawer is only ${box.width}px wide`);
  assert.equal(box.headRight, 0, 'the navbar moved when the drawer opened');
  assert.ok(box.bodyRight <= box.left + 1,
    `the page runs to ${box.bodyRight} but the drawer starts at ${box.left}`);
  await hsk.shot('tutor-drawer-guides');
  await hsk.evalJs('document.querySelector(".tutor-close").click()');
});

// The toggle has to move the whole app, not just the surfaces that happen to
// store both forms. A guide is written in simplified, so flipping to
// traditional has to convert it — and by word, so 发 lands right.
await check('flipping to traditional converts the guide, and back again', async () => {
  await hsk.evalJs('chrome.storage.sync.set({ hanziPref: "simp-first" })');
  await hsk.waitFor('!!document.querySelector(".passage p")', 'the passage');
  const passage = () => hsk.evalJs('document.querySelector(".passage").textContent');
  const before = await passage();
  assert.ok(/[\u4e00-\u9fff]/.test(before), 'no Chinese in the guide to convert');

  await hsk.evalJs('chrome.storage.sync.set({ hanziPref: "trad-first" })');
  await hsk.waitFor(
    `document.querySelector('.passage')?.textContent !== ${JSON.stringify(before)}`,
    'the guide to convert');
  const after = await passage();
  assert.notEqual(after, before, 'the guide did not change script');
  // Converted, not mangled: same length, still Chinese, no empty gaps.
  assert.equal(Array.from(after.trim()).length, Array.from(before.trim()).length,
    'conversion changed the length of the passage');
  assert.ok(/[\u4e00-\u9fff]/.test(after));

  await hsk.evalJs('chrome.storage.sync.set({ hanziPref: "simp-first" })');
  await hsk.waitFor(
    `document.querySelector('.passage')?.textContent === ${JSON.stringify(before)}`,
    'the guide to convert back');
  assert.deepEqual(hsk.errors, []);
});
await check('hsk.html raised no page errors', () => assert.deepEqual(hsk.errors, []));
hsk.close();

// --- the other surfaces ----------------------------------------------------

// Every standalone page wears the same navbar from lib/shell.js. Asserting the
// tab set here is what stops the drift this replaced: five hand-written navs
// that had grown different link lists, and one still advertising a page that
// no longer existed.
const NAV_TABS = ['Review', 'Library', 'Guides', 'Level', 'News'];

for (const [page, ready, active] of [
  ['review.html', '!!document.getElementById("app")', 'review'],
  ['wordlist.html', '!!document.getElementById("list")', 'library'],
  ['news.html', '!!document.getElementById("app")', 'news'],
  ['hsk.html', '!!document.getElementById("rail")', 'guides'],
  ['placement.html', '!!document.querySelector("#view .panel, #view .headline")', 'placement'],
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

// --- the API key notice ----------------------------------------------------
//
// Four features run on a model, and each used to meet a missing key by failing
// inside itself with a sentence only that page showed. The bar carries it now,
// and — the part worth a test — it stays quiet for a deployment that pays for
// its own calls, because nagging somebody to paste a key they do not need is
// worse than saying nothing.

const keyless = await openPage('wordlist.html');
await check('a paired browser with no API key is told so, in the bar', async () => {
  await keyless.waitFor('!!document.querySelector(".zx-header")', 'the navbar');
  await keyless.evalJs('chrome.storage.local.remove(["aiKey", "aiState", "aiHealth"])');
  await keyless.evalJs(`chrome.storage.local.set({ syncMeta: {
    token: 'smoketokensmoketokensmoketoken', serverUrl: location.origin, cursor: 0, lastPushAt: 0 } })`);
  await keyless.waitFor('!document.querySelector(".zx-notice").hidden', 'the notice');
  assert.match(
    await keyless.evalJs('document.querySelector(".zx-notice-text").textContent'),
    /API key/);
  // It goes to the field, not to the top of a six-section settings page.
  assert.match(await keyless.evalJs('document.querySelector(".zx-notice").getAttribute("href")'),
    /options\.html#ai$/);
});
await keyless.shot('ai-notice');

await check('pasting a key puts the notice away without a reload', async () => {
  await keyless.evalJs(`chrome.storage.local.set({ aiKey: 'sk-${'x'.repeat(40)}' })`);
  await keyless.waitFor('document.querySelector(".zx-notice").hidden', 'the notice to go');
});

await check('a rejected key raises the notice on every page, not only the one that failed', async () => {
  // The state is the app's, not the failing page's — which is the whole reason
  // it lives in lib/aistatus.js rather than in whichever tab asked first.
  await keyless.evalJs(
    `chrome.storage.local.set({ aiState: { code: 'bad-key', at: Date.now(), detail: 'refused' } })`);
  await keyless.waitFor('!document.querySelector(".zx-notice").hidden', 'the notice');
  assert.match(
    await keyless.evalJs('document.querySelector(".zx-notice-text").textContent'), /rejected/);

  const elsewhere = await openPage('hsk.html');
  await elsewhere.waitFor('!document.querySelector(".zx-notice").hidden',
    'the notice on a page that never made a request');
  assert.deepEqual(elsewhere.errors, []);
  elsewhere.close();
});

await check('the options page lands on the AI key field when sent there', async () => {
  const opts = await openPage('options.html#ai');
  await opts.waitFor('!!document.getElementById("aiKey")', 'the options page');
  await opts.waitFor('document.querySelector("#ai").classList.contains("called-out")',
    'the section to be called out');
  assert.equal(await opts.evalJs('document.activeElement.id'), 'aiKey',
    'landed on the section but not on the field');
  // And it says what the app knows about the key, not just that one is saved.
  await opts.waitFor('/rejected/i.test(document.getElementById("aiKeyStatus").textContent)',
    'the rejection to be explained where it is fixed');
  await opts.shot('ai-notice-options');
  assert.deepEqual(opts.errors, []);
  opts.close();
});

await check('a deployment that supplies its own key raises nothing', async () => {
  await keyless.evalJs('chrome.storage.local.remove(["aiKey", "aiState"])');
  await keyless.evalJs(`chrome.storage.local.set({ aiHealth: {
    at: Date.now(), serverUrl: location.origin, configured: true, requiresUserKey: false } })`);
  await keyless.waitFor('document.querySelector(".zx-notice").hidden',
    'the notice to stay down for a server that pays its own way');
});
await check('wordlist.html raised no page errors with the notice', () =>
  assert.deepEqual(keyless.errors, []));
keyless.close();

// --- the placement interview, start to report ------------------------------
//
// The harness plays a learner who is comfortable to HSK 4 and lost above it
// (scripts/harness.mjs), so a run driven through it has a known answer. This
// is the only check that the ladder in lib/placement.js, the transport, and
// the report on screen agree with each other — the unit tests drive the rules
// with no page, and the page can render a perfectly tidy wrong number.

const place = await openPage('placement.html');
await check('the placement interview runs to a report and lands on the right level', async () => {
  await place.waitFor('!!document.querySelector("#view .panel")', 'the invitation');
  await place.evalJs(`chrome.storage.local.set({ syncMeta: {
    token: 'smoketokensmoketokensmoketoken', serverUrl: location.origin, cursor: 0, lastPushAt: 0 } })`);
  await place.evalJs(
    '[...document.querySelectorAll("#view button")].find(b => /Start/.test(b.textContent)).click()');
  await place.waitFor('document.querySelectorAll(".log .msg.examiner .zh").length > 0',
    'the first question');

  // Answer every task until the run ends of its own accord. The cap is the
  // ladder's own ceiling plus slack: a run that needs more turns than the rules
  // permit is the bug this is here to catch.
  for (let i = 0; i < 20; i++) {
    if (await place.evalJs('!!document.querySelector("#view .headline")')) break;
    // Count before sending, not after: the reply can land between the two, and
    // waiting for a number already reached never returns.
    const asked = await place.evalJs('document.querySelectorAll(".log .msg.examiner .zh").length');
    await place.evalJs(`(() => {
      const box = document.getElementById('answer');
      if (!box || box.disabled) return;
      box.value = '我今天学习了中文。';
      box.closest('form').requestSubmit();
    })()`);
    await place.waitFor(
      `document.querySelectorAll(".log .msg.examiner .zh").length > ${asked}`
      + ' || !!document.querySelector("#view .headline")',
      'the next question or the report');
  }

  await place.waitFor('!!document.querySelector("#view .headline")', 'the report');
  assert.equal(await place.evalJs('document.querySelector(".headline .level b").textContent'),
    'HSK 4', 'the interview did not land on the level the examiner was playing');
  assert.deepEqual(place.errors, []);
});
await place.shot('placement-report');

await check('the report charts every level, not only the ones asked about', async () => {
  assert.equal(await place.evalJs('document.querySelectorAll(".ladder .lad-row").length'), 9);
  // The level the number came from is marked in the chart, not only stated
  // above it.
  assert.equal(await place.evalJs(
    'document.querySelector(".ladder .lad-row[data-here]").textContent.includes("HSK 4")'), true);
  assert.equal(await place.evalJs(
    'document.querySelectorAll(".ladder .lad-row[data-verdict=untested]").length > 0'), true,
  'levels that were never asked about should still have a row');
});

await check('corrections from the interview can be saved as cards', async () => {
  await place.waitFor('!!document.querySelector(".fix .zwe-save:not([disabled])")',
    'a saveable correction');
  const before = await place.evalJs(
    'chrome.storage.local.get("wordlist").then(r => (r.wordlist || []).length)');
  await place.evalJs('document.querySelector(".fix .zwe-save").click()');
  await place.waitFor(
    'chrome.storage.local.get("wordlist")'
    + `.then(r => (r.wordlist || []).length > ${before})`,
    'the correction to reach the deck');
  assert.equal(await place.evalJs('document.querySelector(".fix .zwe-save").textContent'), '✓');

  // Put it back. The deck is shared with every check after this one, and a card
  // left behind here moves whatever they count.
  await place.evalJs('document.querySelector(".fix .zwe-save").click()');
  await place.waitFor(
    'chrome.storage.local.get("wordlist")'
    + `.then(r => (r.wordlist || []).length === ${before})`,
    'the correction to come back out');
});

await check('the interview sent the rubric, the deck and the transcript', async () => {
  const calls = await (await fetch(`${base}/__placement`)).json();
  assert.ok(calls.length >= 3, `only ${calls.length} turns reached the examiner`);
  const [first] = calls;
  assert.ok(first.rubrics?.length, 'no rubric travelled with the opening turn');
  assert.ok(first.rubrics[0].canDo?.length, 'the rubric carried no can-do statements');
  assert.ok(first.rubrics[0].grammar?.length, 'the rubric carried no grammar points');
  assert.ok(first.profile, 'the deck profile never reached the examiner');
  assert.equal(first.history.length, 0, 'the opening turn invented a transcript');

  // Every turn offers a band the examiner may choose from, and the answer
  // being marked is named with the level it was asked at.
  const second = calls[1];
  assert.ok(second.allowed?.length, 'no band of levels travelled');
  assert.ok(second.allowed.includes(second.target), 'the suggestion was outside its own band');
  assert.equal(second.answer, '我今天学习了中文。');
  assert.equal(typeof second.answeredLevel, 'number');
  assert.ok(second.history.length >= 1, 'the transcript did not travel');
  assert.equal(calls[calls.length - 1].finish, true, 'the run never asked for a report');
});

await check('a finished placement is what the page opens on next time', async () => {
  const again = await openPage('placement.html');
  await again.waitFor('!!document.querySelector("#view .headline")', 'the stored result');
  assert.equal(await again.evalJs('document.querySelector(".headline .level b").textContent'),
    'HSK 4');
  // And the guides are pointed one level past what was held, so "what now" is
  // answered by the app.
  assert.equal(await again.evalJs(
    'chrome.storage.local.get("hskLevel").then(r => r.hskLevel)'), 5);
  assert.deepEqual(again.errors, []);
  again.close();
});
await check('placement.html raised no page errors', () => assert.deepEqual(place.errors, []));
place.close();

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

// A backup is only worth anything if it round-trips through a real file. The
// unit tests cover what goes in it and what a restore means; this covers the
// two halves nothing else can — that the page actually reads all of storage
// into a downloadable blob, and that handing that blob back to the file input
// puts the state back.
//
// The download is caught at URL.createObjectURL rather than let out to disk:
// the file's bytes are the assertion.
const downloadBackup = async () => opts.evalJs(`(async () => {
  let blob = null;
  const create = URL.createObjectURL;
  const click = HTMLAnchorElement.prototype.click;
  URL.createObjectURL = (b) => { blob = b; return 'blob:captured'; };
  HTMLAnchorElement.prototype.click = function () {};
  try {
    document.getElementById('backupDownload').click();
    for (let i = 0; i < 100 && !blob; i++) await new Promise((r) => setTimeout(r, 50));
  } finally {
    URL.createObjectURL = create;
    HTMLAnchorElement.prototype.click = click;
  }
  return blob && blob.text();
})()`);

let backupText = null;
await check('the options page downloads everything in storage as one file', async () => {
  await opts.evalJs(`Promise.all([
    chrome.storage.local.set({ hskLevel: 4, newsDifficulty: 'harder' }),
    chrome.storage.sync.set({
      theme: 'dark', toneColors: true, exampleCount: 5, showHints: true,
      newPerDay: 20, maxPerDay: 90,
    }),
  ])`);
  backupText = await downloadBackup();
  assert.ok(backupText, 'no file was produced');
  const backup = JSON.parse(backupText);
  assert.equal(backup.format, 'zhongwen-explorer-backup');
  assert.equal(backup.extensionVersion, await opts.evalJs('chrome.runtime.getManifest().version'));
  assert.equal(backup.local.hskLevel, 4);
  assert.equal(backup.local.newsDifficulty, 'harder');
  // The key the check above saved, because the box is ticked.
  assert.match(backup.local.aiKey, /^sk-x+$/);
  // Settings live in the other storage area; a backup with an empty `sync` is
  // the shape of this feature silently only half working.
  assert.ok(Object.keys(backup.sync).length >= 5, 'no settings in the backup');
});

await check('unticking the box leaves the credentials out of the file', async () => {
  await opts.evalJs(`(() => {
    const box = document.getElementById('backupSecrets');
    box.checked = false;
  })()`);
  const backup = JSON.parse(await downloadBackup());
  assert.equal('aiKey' in backup.local, false, 'the API key was written anyway');
  assert.equal('syncMeta' in backup.local, false, 'the pairing code was written anyway');
  assert.equal(backup.local.hskLevel, 4, 'everything else should still be there');
  await opts.evalJs(`(() => { document.getElementById('backupSecrets').checked = true; })()`);
});

await check('restoring that file puts the state back', async () => {
  const result = await opts.evalJs(`(async () => {
    // The restore asks before it writes; this test is the yes.
    window.confirm = () => true;
    await chrome.storage.local.set({ hskLevel: 9, newsDifficulty: 'easier' });
    await chrome.storage.sync.set({ theme: 'light' });
    document.getElementById('theme').value = 'light';
    const input = document.getElementById('backupFile');
    const dt = new DataTransfer();
    dt.items.add(new File([${JSON.stringify(backupText)}], 'backup.json',
      { type: 'application/json' }));
    input.files = dt.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
    const status = document.getElementById('backupStatus');
    for (let i = 0; i < 100 && !/^Restored/.test(status.textContent); i++) {
      await new Promise((r) => setTimeout(r, 50));
    }
    return {
      status: status.textContent,
      local: await chrome.storage.local.get(['hskLevel', 'newsDifficulty']),
      theme: (await chrome.storage.sync.get('theme')).theme,
      shown: document.getElementById('theme').value,
    };
  })()`);
  assert.match(result.status, /^Restored\./);
  assert.equal(result.local.hskLevel, 4, 'the level was not restored');
  assert.equal(result.local.newsDifficulty, 'harder');
  assert.equal(result.theme, 'dark', 'settings were not restored');
  // And the page redraws itself, rather than showing what it read on load.
  assert.equal(result.shown, 'dark', 'the page still shows the pre-restore settings');
});

await check('a file that is not a backup is refused rather than applied', async () => {
  const status = await opts.evalJs(`(async () => {
    window.confirm = () => true;
    const input = document.getElementById('backupFile');
    const dt = new DataTransfer();
    dt.items.add(new File(['{"hello":"world"}'], 'notes.json', { type: 'application/json' }));
    input.files = dt.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
    const el = document.getElementById('backupStatus');
    for (let i = 0; i < 100 && /^Restored/.test(el.textContent); i++) {
      await new Promise((r) => setTimeout(r, 50));
    }
    return el.textContent;
  })()`);
  assert.match(status, /not a Zhongwen Explorer backup/);
  assert.equal(
    await opts.evalJs('chrome.storage.local.get("hskLevel").then((r) => r.hskLevel)'), 4);
});
await opts.shot('options-backup');
await check('the options page raised no page errors', () => assert.deepEqual(opts.errors, []));
opts.close();

// --- the dashboard: every view is a tab, so the chrome never disappears ----

const dash = await openPage('newtab.html');
await check('the dashboard shows every view as a tab', async () => {
  // The tabs are static markup; wait for newtab.js to have wired them, or a
  // click lands before there is a handler to receive it.
  await dash.waitFor('!!document.querySelector(".tab[aria-selected]")', 'the dashboard script');
  await dash.waitFor('document.querySelectorAll(".tab").length === 5', 'five tabs');
  assert.deepEqual(
    await dash.evalJs('[...document.querySelectorAll(".tab")].map(t => t.dataset.view)'),
    ['review', 'library', 'guides', 'placement', 'news']);
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
//
// The attribute is set here rather than waited for. Whether the toolbar hides
// it of its own accord depends on how many cards the checks before this one
// happened to leave in the shared deck and whether sync was switched on, which
// made this a race decided by the order of everything above. The bug it guards
// is a CSS rule beating `hidden`, so it sets `hidden` and looks at the pixels.
const newsTab = await openPage('news.html');
await check('the difficulty control is really hidden when it is hidden', async () => {
  await newsTab.waitFor('!!document.getElementById("app")', 'the digest container');
  assert.equal(await newsTab.evalJs(`(() => {
    const el = document.getElementById('difficultyLabel');
    el.hidden = true;
    return getComputedStyle(el).display;
  })()`), 'none');
});

// Articles are kept rather than replaced, so the page has to be able to show
// you the ones it wrote before — including the one it wrote yesterday, which is
// what the day headings are for.
const digest = (title, extra = {}) => ({
  level: 'HSK 3', targetHsk: 3, topics: ['环境'], title,
  article: '这个星期，很多人一起去海边捡垃圾。\n\n他们说，海水比去年干净了一些。',
  englishSummary: 'Volunteers cleaned a beach.',
  glossary: [{ word: '垃圾', pinyin: 'lā jī', meaning: 'rubbish' }],
  sources: [], ...extra,
});
const HISTORY = [
  { id: '2', generatedAt: Date.now() - 3 * 60 * 60 * 1000, data: digest('海边的塑料越来越少') },
  {
    id: '1',
    generatedAt: Date.now() - 27 * 60 * 60 * 1000,
    data: digest('新的地铁线开始试运行', { topic: { label: '科技', query: '科技 新闻' } }),
  },
];
await check('news opens on the last article and offers the ones before it', async () => {
  await newsTab.evalJs(`chrome.storage.local.set({
    newsHistory: ${JSON.stringify(HISTORY)},
    wordlist: ${JSON.stringify(Array.from({ length: 6 }, (_, i) => ({
    cardType: 'word', simp: '朋友', trad: '朋友', pinyin: 'péng you', tones: '2,0',
    defs: 'friend', savedAt: i + 1, lastSavedAt: i + 1, touches: 1, srs: null,
  })))},
    syncMeta: { token: 'smoketokensmoketokensmoketoken', serverUrl: location.origin,
                cursor: 0, lastPushAt: 0 } })`);
  // The script toggle is profile-wide and an earlier check may have left it on
  // traditional, which would repaint these headlines as 海邊的塑料 — a different
  // string to match. This check is about the archive, so it pins the script.
  await newsTab.evalJs('chrome.storage.sync.set({ hanziPref: "simp-first" })');
  // Stamp the outgoing document: a reload does not commit synchronously, and
  // an earlier check may well have left an article on screen — the wait below
  // would then be satisfied by the page on its way out.
  await newsTab.evalJs('window.__stale = true');
  await newsTab.evalJs('location.reload()');
  await newsTab.waitFor('!window.__stale && !!document.querySelector(".article p")',
    'the newest article');
  assert.match(await newsTab.evalJs('document.querySelector(".headline h2").textContent'),
    /海边的塑料/, 'the page opened on something other than the most recent article');
  await newsTab.waitFor('!document.getElementById("history").hidden', 'the archive button');
  assert.match(await newsTab.evalJs('document.getElementById("history").textContent'),
    /\(2\)/, 'the archive button does not say how much is in it');
});
// Suggesting categories is a model call, so a page load must not make one: with
// nothing cached the row is an offer, not a row of chips.
await check('the category row waits to be asked before it costs anything', async () => {
  const chips = await newsTab.evalJs(
    '[...document.querySelectorAll("#cats button")].map(b => b.textContent)');
  assert.deepEqual(chips, ['Suggest topics for me'],
    `a page load should suggest nothing on its own; got ${chips.join(', ')}`);
});
await check('the archive lists past articles under the day they were written', async () => {
  await newsTab.evalJs('document.getElementById("history").click()');
  await newsTab.waitFor('document.querySelectorAll(".past").length === 2', 'both articles');
  const days = await newsTab.evalJs('[...document.querySelectorAll(".day")].map(d => d.textContent)');
  assert.deepEqual(days, ['Today', 'Yesterday'],
    `articles should be grouped by day; got ${days.join(', ')}`);
  // The topic a search asked for travels with the article, so the archive can
  // say which of these you went looking for.
  assert.equal(await newsTab.evalJs('document.querySelectorAll(".past .chip.asked").length'), 1);
});
await check('opening a past article brings it back', async () => {
  await newsTab.evalJs('[...document.querySelectorAll(".past")].at(-1).click()');
  await newsTab.waitFor('!!document.querySelector(".article p")', 'the older article');
  assert.match(await newsTab.evalJs('document.querySelector(".headline h2").textContent'),
    /地铁/, 'clicking a row in the archive did not open that article');
});
await check('news.html raised no page errors', () => assert.deepEqual(newsTab.errors, []));
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
  await library.waitFor('!document.getElementById("tutorToggle").hidden', 'the Ask switch');
  assert.equal(await library.evalJs('document.getElementById("tutorToggle").disabled'), false,
    'Ask is dead on a page that never gates the tutor');
  await openDrawer(library);
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
  // #import is static markup, present before wordlist.js has attached
  // anything; #list having rendered is what says the module is running.
  await library.waitFor('!!document.getElementById("list").textContent', 'the page');

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

// The drawer is a column of the app, not a sheet over it. It used to be fixed
// on top of a padded-out body, which left the document's own scrollbar running
// down the outside of the chat: a scrollbar that looked like the chat's and
// scrolled the article behind it.
await check('the drawer is in the layout, and the page keeps its own scrollbar', async () => {
  await library.setViewport(1365, 900);
  await openDrawer(library);
  await library.waitFor('document.querySelector(".tutor").getAnimations().length === 0',
    'the drawer to finish sliding');
  const layout = await library.evalJs(`(() => {
    const drawer = document.querySelector('.tutor');
    const page = document.querySelector('.zx-page');
    const r = drawer.getBoundingClientRect();
    const p = page.getBoundingClientRect();
    return {
      sibling: drawer.parentElement === page.parentElement,
      fixed: getComputedStyle(drawer).position === 'fixed',
      pageScrolls: page.scrollHeight > page.clientHeight + 1,
      // The page's scrollbar lives inside its own column, so it stops where
      // the drawer starts rather than running down the far side of it.
      gutter: Math.round(p.width - page.clientWidth),
      pageRight: Math.round(p.right),
      drawerLeft: Math.round(r.left),
      documentScrolls: document.documentElement.scrollHeight > innerHeight + 1,
    };
  })()`);
  assert.ok(layout.sibling, 'the drawer is not a sibling of the page column');
  assert.ok(!layout.fixed, 'the drawer is still floating over the page');
  assert.ok(layout.pageScrolls, 'this check needs a page long enough to scroll');
  assert.ok(layout.gutter > 0, 'the page column has no scrollbar of its own');
  assert.ok(!layout.documentScrolls,
    'the document still scrolls behind the drawer, so its scrollbar sits outside the chat');
  assert.ok(Math.abs(layout.pageRight - layout.drawerLeft) <= 1,
    `page ends at ${layout.pageRight}, drawer starts at ${layout.drawerLeft}`);
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
  // The switch stays in the bar and goes flat, rather than vanishing and
  // reappearing as you grade — but it must not open anything.
  await review.waitFor('document.getElementById("tutorToggle").disabled',
    'Ask to go flat on the question side');

  await review.evalJs('document.getElementById("reveal").click()');
  await review.waitFor('!document.getElementById("tutorToggle").disabled', 'the Ask switch');
  await openDrawer(review);
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
  // …and with who is asking. An answer pitched at nobody in particular is a
  // dictionary entry with a friendlier voice.
  assert.ok(asked.profile, 'the question carried no learner profile');
  assert.equal(typeof asked.profile.savedWords, 'number', 'no deck counts in the profile');
  assert.ok(Array.isArray(asked.profile.studyingWords), 'no review queue in the profile');
  assert.ok(asked.profile.recentWords.includes('努力'),
    `the card being reviewed is not in the deck the tutor was given: ${
      JSON.stringify(asked.profile.recentWords)}`);
});
// Pasting a picture. The questions a learner most wants to ask are often about
// Chinese the extension cannot reach — a sign, a menu, a screenshot from
// another app — so the clipboard is the way in.
await check('a pasted image is attached, shown with the question, and sent', async () => {
  await review.evalJs(`(async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 40; canvas.height = 30;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#b5232b';
    ctx.fillRect(0, 0, 40, 30);
    const blob = await new Promise((r) => canvas.toBlob(r, 'image/png'));
    const data = new DataTransfer();
    data.items.add(new File([blob], 'sign.png', { type: 'image/png' }));
    document.getElementById('question').dispatchEvent(
      new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
  })()`);
  await review.waitFor('document.querySelectorAll(".tutor-tray .tutor-chip img").length === 1',
    'the pasted image in the tray');
  // A picture on its own is a question; Ask must be live with an empty box.
  assert.equal(await review.evalJs('document.getElementById("send").disabled'), false,
    'Ask stayed dead with an image attached');
  await review.shot('tutor-image-attached');

  await review.evalJs(`(() => {
    document.getElementById('question').value = 'What does this say?';
    document.getElementById('composer').requestSubmit();
  })()`);
  await review.waitFor('document.querySelectorAll(".tutor-tray .tutor-chip").length === 0',
    'the tray to empty on send');
  await review.waitFor('document.querySelectorAll(".tutor .msg.user .shots img").length > 0',
    'the image kept with the question');
  // Above the bubble, not inside it: a picture and the sentence asking about it
  // are two things.
  assert.equal(await review.evalJs(
    '!!document.querySelector(".tutor .msg.user .bubble .shots")'), false,
  'the image was drawn inside the message bubble');
  await review.shot('tutor-image-sent');
  const asked = await (await fetch(`${base}/__lastask`)).json();
  assert.equal(asked.images?.length, 1, 'the image never reached the request');
  assert.equal(asked.images[0].mime, 'image/jpeg', 'the image was not shrunk before sending');
  assert.ok(asked.images[0].data.length > 100, 'the image data is empty');
  assert.ok(!asked.images[0].data.startsWith('data:'), 'the data: prefix was sent as payload');
});

// The bug this was reported as: the model said it could not see any image,
// because a follow-up question sent none. A picture belongs to the
// conversation, not to the one turn it arrived in.
await check('a follow-up question still carries the picture', async () => {
  await review.evalJs(`(() => {
    document.getElementById('question').value = 'And the second line?';
    document.getElementById('composer').requestSubmit();
  })()`);
  await review.waitFor(
    'document.querySelectorAll(".tutor .msg.user").length > 1', 'the follow-up');
  await review.settle(400);
  const asked = await (await fetch(`${base}/__lastask`)).json();
  assert.equal(asked.question, 'And the second line?');
  assert.equal(asked.images?.length, 1, 'the picture was dropped after one turn');
  assert.equal(asked.imagesFromEarlier, true, 'the model was not told it is the earlier picture');
  // Only the turn it was attached to shows it in the log, though — a thumbnail
  // repeated under every follow-up would read as sending it again.
  assert.equal(await review.evalJs(
    'document.querySelectorAll(".tutor .msg.user .shots").length'), 1,
  'the thumbnail was repeated under the follow-up');
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
  await review.waitFor('!document.getElementById("tutorToggle").disabled', 'the Ask switch');
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
