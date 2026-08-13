// The two limits that stop a shared deployment being ground down by whoever
// finds it: the per-address cap on self-provisioning new pairings, and the
// per-token hourly cap on /api/sync. Neither guards a model call — what they
// guard is the Worker owner's D1 quota, and with it everyone else's sync.
// Run: node tests/sync-limits.test.mjs

import assert from 'node:assert/strict';
import worker, { ipBucket } from '../worker/src/index.js';
import { fakeDb } from './fake-d1.mjs';

let passed = 0;
const failures = [];
async function test(name, fn) {
  try {
    await fn();
    passed++;
  } catch (e) {
    failures.push(`${name}\n    ${e.message.split('\n')[0]}`);
  }
}

// A distinct 32-char token per caller: every one of these self-provisions a
// user on first sight, which is exactly the behaviour under test.
const tokenFor = (n) => String(n).padStart(2, '0').repeat(16);

// Set at the top of each test so every one starts on a clean database; `sync`
// reads it at call time.
let db;

const sync = (token, ip) => worker.fetch(
  new Request('https://example.com/api/sync', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${token}`,
      'cf-connecting-ip': ip,
    },
    body: JSON.stringify({ since: 0, cards: [] }),
  }),
  { DB: db },
);

// --- ipBucket --------------------------------------------------------------

await test('an IPv4 address buckets to itself', () => {
  assert.equal(ipBucket('203.0.113.7'), '203.0.113.7');
});

await test('a missing address is not silently shared with real ones', () => {
  assert.equal(ipBucket(''), 'unknown');
  assert.equal(ipBucket(null), 'unknown');
  assert.equal(ipBucket(undefined), 'unknown');
});

await test('an IPv6 address buckets to its /64', () => {
  assert.equal(ipBucket('2001:db8:85a3:1234:5678:9abc:def0:1'), '2001:db8:85a3:1234::/64');
});

await test('every address in one /64 lands in the same bucket', () => {
  const bucket = ipBucket('2001:db8:85a3:1234::1');
  for (const addr of [
    '2001:db8:85a3:1234::2',
    '2001:db8:85a3:1234:ffff:ffff:ffff:ffff',
    '2001:db8:85a3:1234:0:0:0:dead',
  ]) {
    assert.equal(ipBucket(addr), bucket, addr);
  }
});

await test('different /64s stay different buckets', () => {
  assert.notEqual(
    ipBucket('2001:db8:85a3:1234::1'),
    ipBucket('2001:db8:85a3:1235::1'),
  );
});

await test('the same /64 written differently gives one bucket', () => {
  // Expanded, zero-compressed, leading zeros, and uppercase are all the same
  // network — if they bucketed differently the cap would be trivially evaded.
  const forms = [
    '2001:0db8:0000:0000:0000:0000:0000:0001',
    '2001:db8:0:0:0:0:0:1',
    '2001:db8::1',
    '2001:DB8::1',
  ];
  const buckets = new Set(forms.map(ipBucket));
  assert.equal(buckets.size, 1, [...buckets].join(' vs '));
});

await test('a zone id does not fork the bucket', () => {
  assert.equal(ipBucket('fe80::1%eth0'), ipBucket('fe80::1'));
});

await test('an IPv4-mapped address is one client, not a whole network', () => {
  // ::ffff:1.2.3.4 identifies a single v4 client. Bucketing it as v6 would
  // collapse every such address onto one counter and lock real users out.
  assert.equal(ipBucket('::ffff:203.0.113.7'), '::ffff:203.0.113.7');
  assert.notEqual(ipBucket('::ffff:203.0.113.7'), ipBucket('::ffff:203.0.113.8'));
});

await test('a bucket can never collide with a literal address', () => {
  assert.match(ipBucket('2001:db8::1'), /::\/64$/);
  assert.doesNotMatch(ipBucket('203.0.113.7'), /::\/64$/);
});

// --- the pairing cap, through the real handler -----------------------------

await test('ten new pairings from one IPv4 address are allowed, the eleventh is not', async () => {
  db = fakeDb();
  for (let i = 0; i < 10; i++) {
    const res = await sync(tokenFor(i), '203.0.113.7');
    assert.equal(res.status, 200, `pairing ${i}`);
  }
  const res = await sync(tokenFor(99), '203.0.113.7');
  assert.equal(res.status, 429);
  assert.match((await res.json()).error, /too many new pairings/);
});

await test('rotating the low half of an IPv6 address does not buy more pairings', async () => {
  // The regression this whole change exists for: a /64 is free to rotate, so
  // counting full v6 addresses made the cap above an IPv4-only speed bump.
  db = fakeDb();
  for (let i = 0; i < 10; i++) {
    const res = await sync(tokenFor(i), `2001:db8:85a3:1234::${i + 1}`);
    assert.equal(res.status, 200, `pairing ${i}`);
  }
  const res = await sync(tokenFor(99), '2001:db8:85a3:1234::dead');
  assert.equal(res.status, 429);
  assert.equal(db._users.length, 10);
});

await test('a genuinely different /64 still gets its own allowance', async () => {
  db = fakeDb();
  for (let i = 0; i < 10; i++) {
    await sync(tokenFor(i), `2001:db8:85a3:1234::${i + 1}`);
  }
  const res = await sync(tokenFor(50), '2001:db8:85a3:9999::1');
  assert.equal(res.status, 200);
});

await test('an existing token is never charged against the pairing cap', async () => {
  // The cap guards provisioning, not use: a paired learner on a busy network
  // must keep syncing after ten strangers there have paired.
  db = fakeDb();
  const mine = tokenFor(1);
  assert.equal((await sync(mine, '2001:db8:85a3:1234::1')).status, 200);
  for (let i = 2; i < 12; i++) {
    await sync(tokenFor(i), `2001:db8:85a3:1234::${i}`);
  }
  assert.equal((await sync(mine, '2001:db8:85a3:1234::1')).status, 200);
});

// --- the per-token sync cap ------------------------------------------------

const SYNC_PER_HOUR = 1200;
const NOW = Date.now();

await test('a sync is logged against the hourly cap', async () => {
  db = fakeDb();
  await sync(tokenFor(1), '203.0.113.7');
  assert.equal(db.countOf('sync'), 1);
});

await test('the sync cap is per user, not shared across the deployment', async () => {
  const usage = Array.from({ length: SYNC_PER_HOUR }, () => (
    { user_id: 1, kind: 'sync', created_at: NOW }
  ));
  db = fakeDb({
    users: [{ id: 1, version: 0, token_hash: 'x', created_at: NOW, created_ip: 'ip' }],
    usage,
  });
  // The seeded user's token_hash won't match, so this request provisions its
  // own user (id 2) and is unaffected — the cap is per user, not global.
  assert.equal((await sync(tokenFor(2), '203.0.113.7')).status, 200);
});

await test('the cap counts only this user, and only this hour', async () => {
  const stale = Array.from({ length: SYNC_PER_HOUR }, () => (
    { user_id: 1, kind: 'sync', created_at: NOW - 2 * 60 * 60 * 1000 }
  ));
  db = fakeDb({ usage: stale });
  // user_id 1 is what the first pairing here gets; its whole budget is spent,
  // but every row is more than an hour old.
  assert.equal((await sync(tokenFor(1), '203.0.113.7')).status, 200);
});

await test('a full hour of syncing is refused with 429', async () => {
  const spent = Array.from({ length: SYNC_PER_HOUR }, () => (
    { user_id: 1, kind: 'sync', created_at: NOW }
  ));
  db = fakeDb({ usage: spent });
  const res = await sync(tokenFor(1), '203.0.113.7');
  assert.equal(res.status, 429);
  assert.match((await res.json()).error, /sync limit reached/);
});

await test('other endpoints do not spend the sync budget', async () => {
  // `kind` keeps the budgets separate; a heavy tutor hour must not stop sync.
  const asks = Array.from({ length: SYNC_PER_HOUR }, () => (
    { user_id: 1, kind: 'ask', created_at: NOW }
  ));
  db = fakeDb({ usage: asks });
  assert.equal((await sync(tokenFor(1), '203.0.113.7')).status, 200);
});

await test('a refused sync still answers CORS, so the client can read the error', async () => {
  const spent = Array.from({ length: SYNC_PER_HOUR }, () => (
    { user_id: 1, kind: 'sync', created_at: NOW }
  ));
  db = fakeDb({ usage: spent });
  const res = await sync(tokenFor(1), '203.0.113.7');
  assert.equal(res.headers.get('access-control-allow-origin'), '*');
});

await test('a malformed token is rejected before it can provision or be logged', async () => {
  db = fakeDb();
  const res = await worker.fetch(
    new Request('https://example.com/api/sync', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer short' },
      body: '{}',
    }),
    { DB: db },
  );
  assert.equal(res.status, 401);
  assert.equal(db._users.length, 0);
  assert.equal(db.countOf('sync'), 0);
});

if (failures.length) {
  console.error(`\nFAIL (${failures.length}):`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(`sync-limits: ${passed} passed`);
