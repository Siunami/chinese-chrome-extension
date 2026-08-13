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
  placement: document.getElementById('placementFrame'),
  news: document.getElementById('newsFrame'),
};

const shell = mountShell({ active: 'review', onSelect: (view) => selectView(view) });

// Which frame's tutor the Ask button is speaking for. Each view owns its own
// drawer (the selection bar that feeds it lives inside the frame), so the
// button has to follow the frame on screen — and a review card that is still
// hiding its answer reports the tutor as unavailable.
let showing = 'review';

function selectView(view, updateHash = true) {
  const selected = frames[view] ? view : 'review';
  showing = selected;
  shell.setActive(selected);
  for (const [name, frame] of Object.entries(frames)) {
    const active = name === selected;
    // Lazy frames carry data-src and load on first activation.
    if (active && !frame.src && frame.dataset.src) frame.src = frame.dataset.src;
    frame.classList.toggle('active', active);
  }
  // The frame announced its tutor when it loaded, which was several tab
  // switches ago; ask the one now on screen to say it again. A frame that has
  // not loaded yet will announce of its own accord.
  frames[selected].contentWindow?.postMessage({ type: 'zx-tutor-ping' }, '*');
  if (updateHash) history.replaceState(null, '', `#${selected}`);
}

// Frames ask the shell to switch views rather than navigating themselves —
// otherwise the review frame would load a second copy of the library inside
// the dashboard's review tab.
window.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'zx-open' && frames[event.data.view]) {
    selectView(event.data.view);
  }
  // A frame reporting whether it can be asked about right now. Only the one on
  // screen may speak for the button.
  if (event.data && event.data.type === 'zx-tutor-presence'
      && event.source === frames[showing]?.contentWindow) {
    shell.setAskAvailable(!!event.data.available);
  }
});

selectView(location.hash.slice(1) || 'review', false);
