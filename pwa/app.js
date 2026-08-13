// App shell: pairing, tab routing, sync triggers, settings view. The heavy
// lifting lives in review.js / wordlist.js / sync.js.

import { DEFAULT_LIMITS, reviewBadgeCount } from './lib/srs.js';
import * as db from './db.js';
import { syncNow } from './sync.js';
import { renderReview } from './review.js';
import { renderWords } from './wordlist.js';
import { initDetails } from './details.js';
import { loadDict } from './lib/dict.js';

const viewEl = document.getElementById('view');
const dueBadge = document.getElementById('dueBadge');
const tabs = [...document.querySelectorAll('nav button')];

let activeTab = 'review';
let views = {};

function el(tag, cls, text) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined) node.textContent = text;
  return node;
}

// What a session started now would actually serve — due cards plus what is
// left of today's new-card allowance — not every unstudied card in the deck.
async function updateBadge() {
  const cards = (await db.allDocs()).filter((d) => !d.deleted);
  const total = reviewBadgeCount(cards, Date.now(), DEFAULT_LIMITS);
  dueBadge.hidden = total === 0;
  dueBadge.textContent = String(total);
}

// Sync, then repaint whatever view is showing with the fresh cards.
async function syncAndRefresh() {
  const result = await syncNow();
  await refreshActive();
  return result;
}

async function refreshActive() {
  await views[activeTab]?.refresh();
  await updateBadge();
}

function requestSync() {
  // Fire-and-forget: the view already painted its optimistic state.
  syncNow().then(updateBadge).catch(() => {});
}

// Each grade schedules a push a few seconds out, so progress trickles to the
// server mid-session instead of waiting for the session to end.
let gradePushTimer = null;
function requestSyncSoon() {
  clearTimeout(gradePushTimer);
  gradePushTimer = setTimeout(requestSync, 3000);
}

// ---------------------------------------------------------------------------
// Settings / pairing view
// ---------------------------------------------------------------------------

function fmtAgo(ts) {
  if (!ts) return 'never';
  const mins = Math.round((Date.now() - ts) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  return hours < 48 ? `${hours}h ago` : `${Math.round(hours / 24)}d ago`;
}

function renderSettings(root) {
  return {
    async refresh() {
      root.replaceChildren();
      const token = await db.getMeta('token');
      const box = el('div', 'settings');
      if (!token) {
        box.append(el('h2', '', 'Pair with your computer'));
        box.append(el('p', '',
          'In Chrome on your computer, open the Zhongwen Explorer extension options, enable phone sync, and scan the QR code with this phone — or type the pairing code below.'));
        const input = el('input', 'token-input');
        input.placeholder = 'pairing code';
        input.autocapitalize = 'none';
        input.spellcheck = false;
        const btn = el('button', 'primary', 'Pair');
        btn.addEventListener('click', async () => {
          const value = input.value.trim();
          if (!/^[A-Za-z0-9_-]{16,128}$/.test(value)) {
            input.focus();
            return;
          }
          await db.setMeta({ token: value, cursor: 0, lastPushAt: 0 });
          const result = await syncAndRefresh();
          if (!result.ok) alert(`Pairing saved, but first sync failed: ${result.reason}`);
        });
        box.append(input, btn);
      } else {
        box.append(el('h2', '', 'Sync'));
        const cards = (await db.allDocs()).filter((d) => !d.deleted);
        box.append(el('p', '', `${cards.length} cards on this phone.`));
        box.append(el('p', 'note', `Last synced: ${fmtAgo(await db.getMeta('lastSyncAt'))}`));
        const syncBtn = el('button', 'primary', 'Sync now');
        const status = el('span', 'note', '');
        syncBtn.addEventListener('click', async () => {
          status.textContent = ' Syncing…';
          const result = await syncAndRefresh();
          status.textContent = result.ok
            ? ` Synced ✓ (${result.pushed} sent, ${result.pulled} received)`
            : ` Failed: ${result.reason}`;
        });
        const row = el('div', 'row');
        row.append(syncBtn, status);
        box.append(row);

        const unpair = el('button', 'danger', 'Unpair this phone');
        unpair.addEventListener('click', async () => {
          if (!confirm('Unpair? Cards are removed from this phone only — they stay in the extension and on the server.')) return;
          await db.wipe();
          await refreshActive();
        });
        box.append(el('h2', '', 'Pairing'));
        box.append(unpair);
      }
      box.append(el('p', 'note',
        'Cards sync with the Zhongwen Explorer Chrome extension through your own sync server. Reviews made here flow back to your computer.'));
      root.append(box);
    },
  };
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

function switchTab(name) {
  activeTab = name;
  for (const tab of tabs) tab.classList.toggle('active', tab.dataset.tab === name);
  refreshActive();
}

async function boot() {
  // Pairing by QR: the token arrives in the URL fragment, which never reaches
  // the server; strip it from the address bar immediately.
  const match = location.hash.match(/pair=([A-Za-z0-9_-]{16,128})/);
  if (match) {
    await db.setMeta({ token: match[1], cursor: 0, lastPushAt: 0 });
    history.replaceState(null, '', location.pathname);
  }

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }

  initDetails({
    requestSync,
    // Repainting mid-session would pull the card out from under the reviewer;
    // the word list, though, must not keep a row the sheet just removed.
    onDeckChange: () => { if (activeTab !== 'review') refreshActive(); },
  });
  views = {
    review: renderReview(viewEl, { onSessionEnd: requestSync, onGrade: requestSyncSoon }),
    words: renderWords(viewEl, { requestSync }),
    settings: renderSettings(viewEl),
  };
  // Warm the tap-to-define dictionary once the app is idle. One-time ~13 MB
  // download; sw.js keeps it cached for offline use after that.
  setTimeout(() => loadDict().catch(() => {}), 2500);
  for (const tab of tabs) {
    tab.addEventListener('click', () => switchTab(tab.dataset.tab));
  }

  const paired = !!(await db.getMeta('token'));
  switchTab(paired ? 'review' : 'settings');

  // First paint used local cards; fold in anything new from the server.
  if (paired) await syncAndRefresh();

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) syncAndRefresh();
  });

  // A tab left open would otherwise never pull again. Poll while visible;
  // leave the review view alone mid-session (its refresh guard keeps the
  // current card, but re-rendering under a finger is still rude) — the badge
  // and the other tabs stay live.
  setInterval(async () => {
    if (document.hidden || !(await db.getMeta('token'))) return;
    await syncNow();
    if (activeTab === 'review') await updateBadge();
    else await refreshActive();
  }, 60_000);
}

boot();
