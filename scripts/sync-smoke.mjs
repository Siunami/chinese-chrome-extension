// Smoke-test the sync Worker over real HTTP: two simulated devices push,
// pull, review, and delete against one pairing token and must converge.
// Usage: node scripts/sync-smoke.mjs [baseUrl]   (default http://localhost:8787)

import assert from 'node:assert/strict';
import { changedSince, applyRemote, tombstoneFor } from '../extension/lib/merge.js';
import { schedule } from '../extension/lib/srs.js';

const base = process.argv[2] || 'http://localhost:8787';
const token = 'smoke-' + crypto.randomUUID().replaceAll('-', '');

async function sync(client) {
  // Anything touched at or after this instant is re-pushed next sync (the -1
  // covers changes in the same millisecond); merge is idempotent so over-
  // pushing is harmless, silently never pushing is not.
  const started = Date.now() - 1;
  const res = await fetch(`${base}/api/sync`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      since: client.cursor,
      cards: changedSince(client.cards, client.tombstones, client.lastPushAt),
    }),
  });
  if (res.status !== 200) {
    assert.fail(`sync HTTP ${res.status}: ${await res.text().catch(() => '')}`);
  }
  const data = await res.json();
  const merged = applyRemote(client.cards, client.tombstones, data.cards);
  client.cards = merged.cards;
  client.tombstones = merged.tombstones;
  client.cursor = data.version;
  client.lastPushAt = started;
}

function card(simp, pinyin, now) {
  return {
    cardType: 'word', simp, trad: '', pinyin, tones: '1', defs: `def of ${simp}`,
    savedAt: now, lastSavedAt: now, touches: 1, srs: null, sourceWord: '',
  };
}

const ext = { cards: [], tombstones: [], cursor: 0, lastPushAt: 0 };
const phone = { cards: [], tombstones: [], cursor: 0, lastPushAt: 0 };
const t0 = Date.now();

// bad token rejected
const bad = await fetch(`${base}/api/sync`, { method: 'POST', body: '{}' });
assert.equal(bad.status, 401);

// extension saves two words and pushes
ext.cards.unshift(card('喜欢', 'xǐ huan', t0), card('学习', 'xué xí', t0 + 1));
await sync(ext);
assert.equal(ext.cursor > 0, true);

// phone pulls both
await sync(phone);
assert.equal(phone.cards.length, 2);

// phone reviews one; extension deletes the other
phone.cards.find((c) => c.simp === '喜欢').srs = schedule(null, 'good', Date.now());
const dead = ext.cards.find((c) => c.simp === '学习');
ext.cards = ext.cards.filter((c) => c !== dead);
ext.tombstones.unshift(tombstoneFor(dead, Date.now()));

await sync(phone);
await sync(ext);
await sync(phone);

assert.equal(ext.cards.length, 1, 'delete propagated to ext view');
assert.equal(phone.cards.length, 1, 'delete propagated to phone');
assert.equal(ext.cards[0].srs?.reps, 1, 'review propagated to ext');
assert.deepEqual(
  phone.cards.map((c) => c.simp),
  ext.cards.map((c) => c.simp),
);

// idempotent re-sync
const before = JSON.stringify(phone.cards);
await sync(phone);
assert.equal(JSON.stringify(phone.cards), before);

console.log('OK — sync smoke test passed against', base);
