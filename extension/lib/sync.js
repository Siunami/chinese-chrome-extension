// Sync client for the extension side. Pushes local changes (cards touched
// since the last successful push, plus tombstones) to the sync Worker and
// merges its response back into chrome.storage.local. Offline-tolerant:
// every failure is a silent no-op retried by the next trigger (storage
// change, alarm, or explicit syncNow message).

import { changedSince, applyRemote, capCards } from './merge.js';

const MAX_WORDLIST = 5000;
const MAX_TOMBSTONES = 5000;

// The shared Worker this extension ships pointed at: it stores your cards and
// serves the phone app, and costs its owner effectively nothing to run because
// the expensive part — the model calls — is paid for by whoever makes them
// (see getAiKey). Self-hosters change this one line to their own
// `wrangler deploy` URL; anyone can override it per-install from the options
// page, which is what dev does to reach `wrangler dev`. Stored in
// syncMeta.serverUrl.
export const DEFAULT_SERVER_URL = 'https://zhongwen-sync.siunami-matt.workers.dev';

export async function getSyncMeta() {
  const { syncMeta = null } = await chrome.storage.local.get('syncMeta');
  return syncMeta;
}

// The learner's own model-provider key (OpenAI `sk-…`, or a fal.ai key), which
// pays for the news digest, the tutor, and card translation. It lives only in
// this browser's local storage and is sent to the sync Worker on those three
// requests, which forwards it to the provider and never stores it. Empty is a
// normal state: everything except those three features works without one.
export async function getAiKey() {
  const { aiKey = '' } = await chrome.storage.local.get('aiKey');
  return typeof aiKey === 'string' ? aiKey.trim() : '';
}

// Headers for a model-backed endpoint. The pairing token says whose deck this
// is; the provider key says who is paying for the call.
export async function aiHeaders(meta, contentType = 'application/json') {
  const headers = {
    authorization: `Bearer ${meta.token}`,
    'content-type': contentType,
  };
  const key = await getAiKey();
  if (key) headers['x-provider-key'] = key;
  return headers;
}

export function newToken() {
  // 20 random bytes as base32 (RFC 4648 alphabet, lowercase) — easy to type
  // on a phone if the QR is unavailable, high enough entropy to be a
  // capability on its own.
  const alphabet = 'abcdefghijklmnopqrstuvwxyz234567';
  const bytes = crypto.getRandomValues(new Uint8Array(20));
  let bits = 0;
  let acc = 0;
  let out = '';
  for (const b of bytes) {
    acc = (acc << 8) | b;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      out += alphabet[(acc >> bits) & 31];
    }
  }
  return out;
}

export function pairUrl(meta) {
  // Token travels in the fragment: it never reaches the server in the
  // request line and the PWA strips it from the address bar after pairing.
  return `${meta.serverUrl.replace(/\/+$/, '')}/#pair=${meta.token}`;
}

// Serialized so a burst of triggers (alarm + storage change + page message)
// runs one sync at a time; each call gets the result of a full fresh pass.
let inFlight = null;

export function syncNow() {
  if (!inFlight) {
    inFlight = doSync().finally(() => { inFlight = null; });
  }
  return inFlight;
}

async function doSync() {
  const meta = await getSyncMeta();
  if (!meta || !meta.token || !meta.serverUrl) return { ok: false, reason: 'unpaired' };

  // Anything touched at or after this instant is re-pushed by the next sync
  // (-1 covers same-millisecond changes). Merge is idempotent, so pushing a
  // card twice is harmless; silently never pushing it would lose data.
  const started = Date.now() - 1;
  const { wordlist = [], tombstones = [] } =
    await chrome.storage.local.get(['wordlist', 'tombstones']);
  const push = changedSince(wordlist, tombstones, meta.lastPushAt || 0);

  let res;
  try {
    res = await fetch(`${meta.serverUrl.replace(/\/+$/, '')}/api/sync`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${meta.token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ since: meta.cursor || 0, cards: push }),
    });
  } catch {
    return { ok: false, reason: 'offline' };
  }
  if (!res.ok) return { ok: false, reason: `http ${res.status}` };
  let data;
  try {
    data = await res.json();
  } catch {
    return { ok: false, reason: 'bad response' };
  }

  // Re-read storage before merging: a save or review may have landed while
  // the request was in flight, and applyRemote must not clobber it.
  const cur = await chrome.storage.local.get(['wordlist', 'tombstones']);
  const merged = applyRemote(cur.wordlist || [], cur.tombstones || [], data.cards || []);
  const capped = capCards(merged.cards, MAX_WORDLIST, Date.now());
  const newTombstones = capped.tombstones.concat(merged.tombstones).slice(0, MAX_TOMBSTONES);
  // Write card keys only when they materially changed: background.js resyncs
  // on wordlist/tombstones changes, and an unconditional write would make
  // every sync schedule the next one forever.
  const update = {
    syncMeta: { ...meta, cursor: data.version, lastPushAt: started, lastSyncAt: Date.now() },
  };
  if (JSON.stringify(capped.cards) !== JSON.stringify(cur.wordlist || [])) {
    update.wordlist = capped.cards;
  }
  if (JSON.stringify(newTombstones) !== JSON.stringify(cur.tombstones || [])) {
    update.tombstones = newTombstones;
  }
  await chrome.storage.local.set(update);
  return { ok: true, pushed: push.length, pulled: (data.cards || []).length };
}
