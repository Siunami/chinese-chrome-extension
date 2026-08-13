// The new-tab dashboard: one navbar, one surface, an iframe per view.
//
// The navbar itself is lib/shell.js — the same component every standalone page
// mounts — so the dashboard and the pages inside it cannot drift apart. Here
// it is given an onSelect, which turns the tabs into buttons that swap frames
// instead of links that navigate.

import { mountShell } from './lib/shell.js';

const frames = {
  review: document.getElementById('reviewFrame'),
  library: document.getElementById('libraryFrame'),
  guides: document.getElementById('guidesFrame'),
  news: document.getElementById('newsFrame'),
};

const shell = mountShell({ active: 'review', onSelect: (view) => selectView(view) });

function selectView(view, updateHash = true) {
  const selected = frames[view] ? view : 'review';
  shell.setActive(selected);
  for (const [name, frame] of Object.entries(frames)) {
    const active = name === selected;
    // Lazy frames carry data-src and load on first activation.
    if (active && !frame.src && frame.dataset.src) frame.src = frame.dataset.src;
    frame.classList.toggle('active', active);
  }
  if (updateHash) history.replaceState(null, '', `#${selected}`);
}

// Frames ask the shell to switch views rather than navigating themselves —
// otherwise the review frame would load a second copy of the library inside
// the dashboard's review tab.
window.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'zx-open' && frames[event.data.view]) {
    selectView(event.data.view);
  }
});

selectView(location.hash.slice(1) || 'review', false);
