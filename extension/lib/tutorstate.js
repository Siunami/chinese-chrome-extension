// Whether the tutor drawer is open — the one bit of state the navbar and the
// drawer both need, and neither of them owns.
//
// The Ask control is part of the app chrome now (lib/shell.js), not a pill
// floating over the corner of the page, so the button and the panel it opens
// are built by two different modules — and in the dashboard they are not even
// in the same document, because each view is an iframe with its own drawer.
// Keeping the bit in chrome.storage.local instead of a variable is what makes
// the drawer follow you: open it on the review card, switch to the library, and
// the library's drawer is already open with the same conversation in it.
//
// Presence is the other half. A page with no tutor (Options) must not show an
// Ask button, and a review card hides its tutor on the question side so asking
// cannot become a way to peek at the answer — the button has to say so rather
// than doing nothing when pressed. That travels as a DOM event, because it is
// about this document rather than about the profile.

export const ASK_OPEN_KEY = 'tutorOpen';

export async function getAskOpen() {
  const { [ASK_OPEN_KEY]: open } = await chrome.storage.local
    .get({ [ASK_OPEN_KEY]: false })
    .catch(() => ({ [ASK_OPEN_KEY]: false }));
  return !!open;
}

export function setAskOpen(open) {
  return chrome.storage.local.set({ [ASK_OPEN_KEY]: !!open }).catch(() => {});
}

// Call `cb(open)` whenever the drawer is opened or closed, here or anywhere
// else — another tab, another view of the dashboard.
export function onAskOpen(cb) {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes[ASK_OPEN_KEY]) cb(!!changes[ASK_OPEN_KEY].newValue);
  });
}

// -------------------------------------------------------------------------
// Presence, within one document
// -------------------------------------------------------------------------

const PRESENCE_EVENT = 'zx-tutor-presence';

// `available` is false while the page has a tutor it is deliberately holding
// back (the unrevealed review card).
export function announceTutor(available) {
  document.documentElement.dataset.zxTutor = available ? 'on' : 'off';
  document.dispatchEvent(new CustomEvent(PRESENCE_EVENT, { detail: { available } }));
  // Inside the dashboard the button is in the parent document, so the frame has
  // to say it out loud. The dashboard ignores everything but the active view.
  if (window.parent !== window) {
    window.parent.postMessage({ type: 'zx-tutor-presence', available }, '*');
  }
}

// Also fires immediately if the tutor announced itself before we started
// listening — mountShell and createTutor are two module loads in no fixed
// order, and a missed announcement would leave the navbar without its button.
export function onTutorPresence(cb) {
  document.addEventListener(PRESENCE_EVENT, (e) => cb(!!e.detail.available));
  const announced = document.documentElement.dataset.zxTutor;
  if (announced) cb(announced === 'on');
}
