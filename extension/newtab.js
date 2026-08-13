import { DEFAULT_LIMITS, reviewBadgeCount } from './lib/srs.js';

const tabs = [...document.querySelectorAll('.tab')];
const frames = {
  review: document.getElementById('reviewFrame'),
  library: document.getElementById('libraryFrame'),
  guides: document.getElementById('guidesFrame'),
  news: document.getElementById('newsFrame'),
  pronounce: document.getElementById('pronounceFrame'),
};
const reviewCountEl = document.getElementById('reviewCount');
const savedCountEl = document.getElementById('savedCount');

function selectView(view, updateHash = true) {
  const selected = frames[view] ? view : 'review';
  for (const tab of tabs) {
    const active = tab.dataset.view === selected;
    tab.classList.toggle('active', active);
    tab.setAttribute('aria-selected', String(active));
  }
  for (const [name, frame] of Object.entries(frames)) {
    const active = name === selected;
    // Lazy frames carry data-src and load on first activation.
    if (active && !frame.src && frame.dataset.src) frame.src = frame.dataset.src;
    frame.classList.toggle('active', active);
  }
  if (updateHash) history.replaceState(null, '', `#${selected}`);
}

// The Review badge counts what a session started right now would actually
// serve — due cards plus what is left of today's new-card allowance. Counting
// every unstudied word instead is what made the tab claim "23" on a day the
// review page had already said "done".
async function updateCounts(wordlist) {
  const words = wordlist || (await chrome.storage.local.get('wordlist')).wordlist || [];
  const limits = await chrome.storage.sync.get(DEFAULT_LIMITS).catch(() => DEFAULT_LIMITS);
  reviewCountEl.textContent = String(reviewBadgeCount(words, Date.now(), limits));
  savedCountEl.textContent = String(words.length);
}

for (const tab of tabs) {
  tab.addEventListener('click', () => selectView(tab.dataset.view));
}

// Settings open in their own tab rather than replacing the dashboard.
document.getElementById('openOptions').addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.wordlist) updateCounts(changes.wordlist.newValue || []);
  if (area === 'sync' && (changes.newPerDay || changes.maxPerDay)) updateCounts();
});

// Frames ask the shell to switch views rather than navigating themselves —
// otherwise the review frame would load a second copy of the library inside
// the dashboard's review tab.
window.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'zx-open' && frames[event.data.view]) {
    selectView(event.data.view);
  }
});

selectView(location.hash.slice(1) || 'review', false);
updateCounts();
