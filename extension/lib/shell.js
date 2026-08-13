// The app navbar, built once and worn by every extension page.
//
// Before this, each page hand-wrote its own <h1> plus a row of red links, and
// they had drifted: different link sets, different order, a "Pronunciation"
// entry that outlived the page it pointed at, and Options looking like a
// different product entirely. Destinations now live in VIEWS below, so adding
// or removing one is a single edit rather than five.
//
// The dashboard (newtab.html) renders the same bar from the same markup, but
// its tabs are <button>s that swap iframes instead of <a>s that navigate —
// pass `onSelect` to get that behaviour. Either way the styling is shell.css,
// so the two cannot drift apart again.

import { DEFAULT_LIMITS, reviewBadgeCount } from './srs.js';
import {
  SIMP_FIRST, TRAD_FIRST, getHanziPref, setHanziPref, onHanziPref,
} from './hanzi.js';
import { getAskOpen, setAskOpen, onAskOpen, onTutorPresence } from './tutorstate.js';
import { icon } from './icons.js';

// id -> { label, href, count }. `count` names the badge this tab carries.
export const VIEWS = [
  { id: 'review', label: 'Review', href: 'review.html', count: 'due' },
  { id: 'library', label: 'Library', href: 'wordlist.html', count: 'saved' },
  { id: 'guides', label: 'Guides', href: 'hsk.html' },
  { id: 'news', label: 'News', href: 'news.html' },
];

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

// Both badges answer "what would I get if I clicked this right now". The due
// count is what a session started this instant would actually serve — due
// cards plus what is left of today's new-card allowance — not every unstudied
// word, which is what used to make the tab promise 23 on a day review had
// already said "done".
async function readCounts() {
  const { wordlist = [] } = await chrome.storage.local.get('wordlist');
  const limits = await chrome.storage.sync.get(DEFAULT_LIMITS).catch(() => DEFAULT_LIMITS);
  return { due: reviewBadgeCount(wordlist, Date.now(), limits), saved: wordlist.length };
}

/**
 * Render the navbar as the first element of <body>.
 *
 *   active     id of the current view ('review', …), or 'options'
 *   onSelect   optional (id) => void. Given, tabs become buttons and call this
 *              instead of navigating — the dashboard's iframe swap.
 *
 * Returns { setActive, refreshCounts, setAskAvailable }. The dashboard calls
 * setAskAvailable for the frame it is showing, since that frame's tutor is in
 * another document and cannot reach the button itself.
 */
export function mountShell({ active, onSelect } = {}) {
  // Pages inside the dashboard's iframes still build the bar (so the page is
  // the same page either way) and let shell.css hide it.
  if (new URLSearchParams(location.search).has('embedded')) {
    document.body.classList.add('embedded');
  }

  const header = el('header', 'zx-header');

  const brand = el(onSelect ? 'div' : 'a', 'zx-brand');
  if (!onSelect) {
    brand.href = 'newtab.html';
    brand.title = 'Open the dashboard';
  }
  brand.append(el('div', 'zx-mark', '中'));
  const brandText = el('div', 'zx-brand-text');
  brandText.append(el('h1', null, 'Zhongwen Explorer'), el('span', null, 'READ · SAVE · REMEMBER'));
  brand.append(brandText);

  const nav = el('nav', 'nav');
  nav.setAttribute('aria-label', 'Learning views');
  const badges = {};
  const tabs = VIEWS.map((view) => {
    const tab = el(onSelect ? 'button' : 'a', 'tab');
    tab.dataset.view = view.id;
    if (onSelect) tab.type = 'button';
    else tab.href = view.href;
    tab.append(el('span', 'tab-label', view.label));
    if (view.count) {
      const badge = el('span', 'count');
      badge.id = view.count === 'due' ? 'reviewCount' : 'savedCount';
      badges[view.count] = badge;
      tab.append(badge);
    }
    if (onSelect) tab.addEventListener('click', () => onSelect(view.id));
    nav.append(tab);
    return tab;
  });

  // Which script to study in is a thing you flip while reading, not a thing
  // you go to Settings for — a traditional reader had to dig a dropdown out of
  // the options page, and it only ever moved the popup anyway.
  //
  // It is a switch you slide: the thumb sits under whichever script you are
  // reading in and travels to the other one. Click either half, drag the thumb
  // across, or press ← / → — all three land on the same two states, because a
  // two-position switch has nowhere else to go.
  const script = el('div', 'zx-script');
  script.setAttribute('role', 'group');
  script.setAttribute('aria-label', 'Character script');
  const thumb = el('span', 'zx-script-thumb');
  thumb.setAttribute('aria-hidden', 'true');
  script.append(thumb);
  const SCRIPTS = [SIMP_FIRST, TRAD_FIRST];
  const scriptButtons = [
    [SIMP_FIRST, '简', 'Show simplified first'],
    [TRAD_FIRST, '繁', 'Show traditional first'],
  ].map(([value, glyph, label]) => {
    const btn = el('button', 'zx-script-btn', glyph);
    btn.type = 'button';
    btn.dataset.pref = value;
    btn.title = label;
    btn.setAttribute('aria-label', label);
    btn.addEventListener('click', () => setHanziPref(value));
    script.append(btn);
    return btn;
  });

  // Dragging. The half the pointer is released over wins, so a press on 简 that
  // ends over 繁 flips it — the gesture the control's shape promises. Pointer
  // capture keeps a drag that wanders off the switch (easy, at 75px wide) from
  // being lost, and retargets the click that follows to the group, which is why
  // the buttons' own click handlers do not also fire and double-write.
  const halfAt = (clientX) => {
    const box = script.getBoundingClientRect();
    return clientX - box.left < box.width / 2 ? SIMP_FIRST : TRAD_FIRST;
  };
  script.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    script.setPointerCapture?.(e.pointerId);
    script.classList.add('dragging');
  });
  script.addEventListener('pointermove', (e) => {
    // Follow the finger while it is down, so the thumb is being dragged rather
    // than jumping once you let go.
    if (script.classList.contains('dragging')) paintScript(halfAt(e.clientX));
  });
  const endDrag = (e) => {
    if (!script.classList.contains('dragging')) return;
    script.classList.remove('dragging');
    script.releasePointerCapture?.(e.pointerId);
    setHanziPref(halfAt(e.clientX));
  };
  script.addEventListener('pointerup', endDrag);
  // A cancelled gesture (scroll takeover, window blur) leaves the thumb wherever
  // the finger last was; put it back where the setting actually is.
  script.addEventListener('pointercancel', () => {
    script.classList.remove('dragging');
    getHanziPref().then(paintScript);
  });

  script.addEventListener('keydown', (e) => {
    const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const at = SCRIPTS.indexOf(script.dataset.pref);
    const next = SCRIPTS[Math.min(SCRIPTS.length - 1, Math.max(0, at + step))];
    setHanziPref(next);
    scriptButtons[SCRIPTS.indexOf(next)].focus();
  });

  function paintScript(pref) {
    script.dataset.pref = pref; // slides the thumb; see shell.css
    for (const btn of scriptButtons) {
      const on = btn.dataset.pref === pref;
      btn.classList.toggle('active', on);
      btn.setAttribute('aria-pressed', String(on));
    }
  }
  getHanziPref().then(paintScript);
  // Every page carries the toggle, so a flip on one has to show on the others.
  onHanziPref(paintScript);

  // Ask. The tutor used to be a pill floating over the bottom-right corner of
  // whatever you were reading — a second, page-level piece of chrome competing
  // with the app's own. It is a switch in the bar now: press it and the drawer
  // takes the right-hand side of the page, press it again and the page has it
  // back. The bar itself never moves, so the app does not appear to jump every
  // time you ask something.
  //
  // It is one bit for the whole profile (lib/tutorstate.js), which is what makes
  // the drawer follow you from the review card to the library with the same
  // conversation still in it.
  const ask = el('button', 'zx-ask');
  ask.type = 'button';
  ask.id = 'tutorToggle';
  ask.append(icon('chat', 15), el('span', null, 'Ask'));
  ask.setAttribute('aria-pressed', 'false');
  // Pages with no tutor at all (Options) never show it; the dashboard's views
  // all have one, and each frame reports its own as it loads.
  ask.hidden = !onSelect;
  let askOpen = false;
  function paintAsk() {
    ask.classList.toggle('active', askOpen);
    ask.setAttribute('aria-pressed', String(askOpen));
    ask.title = ask.disabled
      ? 'Reveal the answer before asking about this card'
      : askOpen ? 'Close the tutor' : 'Ask the tutor about what you are reading';
  }
  function setAskAvailable(available) {
    ask.hidden = false;
    ask.disabled = !available;
    paintAsk();
  }
  ask.addEventListener('click', () => {
    askOpen = !askOpen;
    paintAsk();
    setAskOpen(askOpen);
  });
  getAskOpen().then((open) => { askOpen = open; paintAsk(); });
  onAskOpen((open) => { askOpen = open; paintAsk(); });
  // A tutor in this document announces itself directly; inside the dashboard the
  // drawer is in an iframe, so the frame posts up and newtab.js relays it.
  onTutorPresence(setAskAvailable);
  paintAsk();

  // Settings is deliberately not a tab: it is a place you visit and come back
  // from, not one of the things you study.
  const settings = el(onSelect ? 'button' : 'a', 'zx-settings', 'Options');
  if (onSelect) {
    settings.type = 'button';
    // Its own tab rather than replacing the dashboard.
    settings.addEventListener('click', () => chrome.runtime.openOptionsPage());
  } else {
    settings.href = 'options.html';
  }

  header.append(brand, nav, el('div', 'zx-spacer'), script, ask, settings);
  document.body.prepend(header);

  function setActive(id) {
    for (const tab of tabs) {
      const on = tab.dataset.view === id;
      tab.classList.toggle('active', on);
      if (onSelect) tab.setAttribute('aria-selected', String(on));
      else if (on) tab.setAttribute('aria-current', 'page');
      else tab.removeAttribute('aria-current');
    }
    settings.classList.toggle('active', id === 'options');
    if (id === 'options' && !onSelect) settings.setAttribute('aria-current', 'page');
  }

  async function refreshCounts() {
    const counts = await readCounts();
    for (const [key, badge] of Object.entries(badges)) {
      badge.textContent = String(counts[key]);
      // A zero badge is noise; shell.css hides it on this attribute.
      badge.dataset.zero = counts[key] ? '0' : '1';
    }
  }

  setActive(active);
  refreshCounts();
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.wordlist) refreshCounts();
    if (area === 'sync' && (changes.newPerDay || changes.maxPerDay)) refreshCounts();
  });

  return { setActive, refreshCounts, setAskAvailable };
}
