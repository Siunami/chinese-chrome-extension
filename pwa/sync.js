// Sync client for the PWA — same protocol and merge rules as
// extension/lib/sync.js, but over IndexedDB and always same-origin (the
// Worker that serves this app also hosts /api/sync).

import { changedSince, applyRemote } from './lib/merge.js';
import * as db from './db.js';

let inFlight = null;

export function syncNow() {
  if (!inFlight) {
    inFlight = doSync().finally(() => { inFlight = null; });
  }
  return inFlight;
}

async function doSync() {
  const token = await db.getMeta('token');
  if (!token) return { ok: false, reason: 'unpaired' };

  // Anything touched at or after this instant is re-pushed by the next sync
  // (-1 covers same-millisecond changes); merge is idempotent so over-pushing
  // is harmless.
  const started = Date.now() - 1;
  const all = await db.allDocs();
  const push = changedSince(
    all.filter((d) => !d.deleted),
    all.filter((d) => d.deleted),
    await db.getMeta('lastPushAt', 0),
  );

  let res;
  try {
    res = await fetch('/api/sync', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ since: await db.getMeta('cursor', 0), cards: push }),
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

  // Re-read before merging: a grade may have landed while the request was in
  // flight, and applyRemote must not clobber it.
  const cur = await db.allDocs();
  const merged = applyRemote(
    cur.filter((d) => !d.deleted),
    cur.filter((d) => d.deleted),
    data.cards || [],
  );
  await db.putDocs(merged.cards.concat(merged.tombstones));
  await db.setMeta({ cursor: data.version, lastPushAt: started, lastSyncAt: Date.now() });
  return { ok: true, pushed: push.length, pulled: (data.cards || []).length };
}
