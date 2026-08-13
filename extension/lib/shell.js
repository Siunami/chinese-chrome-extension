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
 * Returns { setActive, refreshCounts }.
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

  header.append(brand, nav, el('div', 'zx-spacer'), settings);
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

  return { setActive, refreshCounts };
}
