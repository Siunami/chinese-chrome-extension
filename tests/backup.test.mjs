// Unit tests for extension/lib/backup.js — the file a learner falls back on
// when Chrome has thrown their progress away, and the restore that puts it
// back without throwing away what is already here.
// Run: node tests/backup.test.mjs

import assert from 'node:assert/strict';
import {
  FORMAT, SECRET_KEYS, TRANSIENT_KEYS, VERSION,
  buildBackup, joinList, labelFor, planRestore, readBackup, restoreOrder, summarizeBackup,
} from '../extension/lib/backup.js';

let passed = 0;
function test(name, fn) {
  try {
    fn();
    passed++;
  } catch (e) {
    console.error(`FAIL: ${name}`);
    throw e;
  }
}

const card = (simp, over = {}) => ({
  cardType: 'word',
  simp,
  trad: simp,
  pinyin: 'ni3 hao3',
  defs: 'hello',
  savedAt: 1000,
  lastSavedAt: 1000,
  touches: 1,
  srs: null,
  ...over,
});

// A believable install: cards, settings, and every other thing the extension
// has learned about this learner.
const fullState = () => ({
  sync: {
    theme: 'dark',
    toneColors: true,
    exampleCount: 5,
    hanziPref: 'trad-first',
    newPerDay: 20,
    maxPerDay: 90,
  },
  local: {
    wordlist: [card('你好'), card('谢谢', { simp: '谢谢', trad: '謝謝' })],
    tombstones: [{ deleted: true, deletedAt: 900, cardType: 'word', simp: '再见', trad: '', pinyin: 'zai4 jian4' }],
    enabled: true,
    hskLevel: 3,
    newsDifficulty: 'harder',
    newsHistory: [{ id: '1', generatedAt: 5, data: {} }],
    newsCategories: { fetchedAt: 5, items: ['科技'] },
    placementResults: [{ level: 3, at: 7 }],
    tutorChatLog: [{ id: 'c1', messages: [] }],
    tutorOpen: true,
    aiKey: 'sk-abcdefghijklmnop',
    syncMeta: { token: 'abc123', serverUrl: 'https://example.workers.dev', cursor: 4 },
    aiState: { code: 'bad-key', at: 99, detail: 'refused' },
    aiHealth: { at: 99, serverUrl: 'https://example.workers.dev', configured: true },
  },
});

const roundTrip = (backup) => readBackup(JSON.stringify(backup));

// --- what goes in ---------------------------------------------------------

test('a backup carries every stored key, including ones this module never names', () => {
  const state = fullState();
  // The point of dumping storage rather than listing keys: state a future
  // feature adds is in the file without anyone editing backup.js.
  state.local.somethingAddedNextYear = { streak: 12 };
  const backup = buildBackup(state);
  for (const key of Object.keys(state.local)) {
    if (TRANSIENT_KEYS.includes(key)) continue;
    assert.deepEqual(backup.local[key], state.local[key], `${key} missing from the backup`);
  }
  assert.deepEqual(backup.sync, state.sync);
  assert.equal(backup.format, FORMAT);
  assert.equal(backup.version, VERSION);
});

test('the last provider error and the cached server health stay behind', () => {
  const backup = buildBackup(fullState());
  for (const key of TRANSIENT_KEYS) {
    assert.equal(key in backup.local, false, `${key} should not be backed up`);
  }
  assert.deepEqual(TRANSIENT_KEYS, ['aiState', 'aiHealth']);
});

test('the key and the pairing code travel only when asked for', () => {
  const withSecrets = buildBackup(fullState(), { includeSecrets: true });
  assert.equal(withSecrets.local.aiKey, 'sk-abcdefghijklmnop');
  assert.equal(withSecrets.local.syncMeta.token, 'abc123');

  const without = buildBackup(fullState(), { includeSecrets: false });
  for (const key of SECRET_KEYS) {
    assert.equal(key in without.local, false, `${key} should be left out`);
  }
  // Everything that is not a credential still is.
  assert.equal(without.local.wordlist.length, 2);
  assert.equal(without.local.hskLevel, 3);
});

test('a backup records when and by which version it was written', () => {
  const backup = buildBackup(fullState(), { now: 1700000000000, extensionVersion: '1.7.0' });
  assert.equal(backup.createdAt, 1700000000000);
  assert.equal(backup.extensionVersion, '1.7.0');
});

// --- reading a file back --------------------------------------------------

test('a backup survives the trip through JSON unchanged', () => {
  const backup = buildBackup(fullState(), { now: 42 });
  assert.deepEqual(roundTrip(backup), backup);
});

test('a file that is not a backup is refused with a sentence, not a stack trace', () => {
  assert.throws(() => readBackup('not json at all'), /not even JSON/);
  assert.throws(() => readBackup('[1, 2, 3]'), /not a Zhongwen Explorer backup/);
  assert.throws(() => readBackup('{"hello": "world"}'), /not a Zhongwen Explorer backup/);
  assert.throws(() => readBackup(JSON.stringify({ format: FORMAT })), /which format/);
});

test('a backup from a newer extension is refused rather than half-applied', () => {
  const future = { ...buildBackup(fullState()), version: VERSION + 1 };
  assert.throws(() => readBackup(JSON.stringify(future)), /newer version/);
});

test('a backup with a mangled body reads as empty rather than throwing later', () => {
  const odd = readBackup(JSON.stringify({ format: FORMAT, version: 1, sync: 'nope', local: null }));
  assert.deepEqual(odd.sync, {});
  assert.deepEqual(odd.local, {});
  // And restoring it does nothing but rewrite the deck it found.
  const plan = planRestore(odd, { wordlist: [card('你好')], tombstones: [] }, 2000);
  assert.deepEqual(plan.sync, {});
  assert.equal(plan.local.wordlist.length, 1);
});

// --- what a restore means -------------------------------------------------

test('restoring onto a wiped install brings back everything in the file', () => {
  const backup = roundTrip(buildBackup(fullState()));
  const plan = planRestore(backup, {}, 2000);
  assert.deepEqual(plan.sync, fullState().sync);
  assert.equal(plan.local.hskLevel, 3);
  assert.equal(plan.local.newsDifficulty, 'harder');
  assert.equal(plan.local.tutorChatLog.length, 1);
  assert.equal(plan.local.aiKey, 'sk-abcdefghijklmnop');
  assert.deepEqual(plan.local.wordlist.map((c) => c.simp).sort(), ['你好', '谢谢']);
});

test('cards saved since the backup survive the restore', () => {
  const backup = roundTrip(buildBackup(fullState()));
  const newer = card('电脑', { savedAt: 5000, lastSavedAt: 5000 });
  const plan = planRestore(backup, { wordlist: [newer], tombstones: [] }, 6000);
  assert.deepEqual(plan.local.wordlist.map((c) => c.simp).sort(), ['你好', '电脑', '谢谢']);
});

test('review progress made since the backup is not rolled back by it', () => {
  const backup = roundTrip(buildBackup(fullState()));
  const reviewed = card('你好', { srs: { due: 9000, reps: 3, reviewedAt: 8000 } });
  const plan = planRestore(backup, { wordlist: [reviewed], tombstones: [] }, 9000);
  const restored = plan.local.wordlist.find((c) => c.simp === '你好');
  assert.deepEqual(restored.srs, { due: 9000, reps: 3, reviewedAt: 8000 });
});

test('the backup carries back review progress the deck has since lost', () => {
  const state = fullState();
  state.local.wordlist = [card('你好', { srs: { due: 4000, reps: 6, reviewedAt: 3000 } })];
  const backup = roundTrip(buildBackup(state));
  const plan = planRestore(backup, { wordlist: [card('你好')], tombstones: [] }, 9000);
  assert.equal(plan.local.wordlist[0].srs.reps, 6);
});

test('a card deleted after the backup stays deleted', () => {
  const backup = roundTrip(buildBackup(fullState()));
  const deleted = {
    deleted: true, deletedAt: 8000, cardType: 'word', simp: '你好', trad: '你好', pinyin: 'ni3 hao3',
  };
  const plan = planRestore(backup, { wordlist: [], tombstones: [deleted] }, 9000);
  assert.deepEqual(plan.local.wordlist.map((c) => c.simp), ['谢谢']);
  assert.ok(plan.local.tombstones.some((t) => t.simp === '你好'));
});

test('restoring the same file twice changes nothing the second time', () => {
  const backup = roundTrip(buildBackup(fullState()));
  const once = planRestore(backup, {}, 2000);
  const twice = planRestore(backup, once.local, 2000);
  assert.deepEqual(twice.local.wordlist, once.local.wordlist);
  assert.deepEqual(twice.local.tombstones, once.local.tombstones);
});

test('a restore leaves alone the keys the file does not carry', () => {
  const backup = roundTrip(buildBackup(fullState(), { includeSecrets: false }));
  const plan = planRestore(backup, {}, 2000);
  // Nothing to say about the key or the pairing, so options.js writes neither
  // and this machine keeps its own.
  for (const key of SECRET_KEYS) {
    assert.equal(key in plan.local, false, `restoring should not touch ${key}`);
  }
});

test('a restore cannot push the deck past the cap sync also enforces', () => {
  const state = fullState();
  state.local.wordlist = Array.from({ length: 5100 }, (_, i) => card(`词${i}`, {
    pinyin: `ci${i}`, savedAt: 1000 + i, lastSavedAt: 1000 + i,
  }));
  const plan = planRestore(roundTrip(buildBackup(state)), {}, 9000);
  assert.equal(plan.local.wordlist.length, 5000);
  // Evicted rather than vanished: every other replica drops the same 100.
  assert.ok(plan.local.tombstones.filter((t) => t.deleted).length >= 100);
});

// --- what the learner is told before anything is written ------------------

test('the summary names what is in the file, in the app\'s own words', () => {
  const backup = buildBackup(fullState());
  assert.equal(
    summarizeBackup(backup),
    '2 cards, 6 settings, 1 news article, 1 placement result, 1 tutor conversation, '
    + 'the API key and the pairing code',
  );
});

test('the summary says so when a backup holds no credentials, and when it holds nothing', () => {
  const plain = summarizeBackup(buildBackup(fullState(), { includeSecrets: false }));
  assert.equal(/API key|pairing code/.test(plain), false);
  assert.match(plain, /^2 cards, 6 settings/);
  assert.equal(summarizeBackup(buildBackup({ sync: {}, local: {} })), 'an empty backup');
  assert.equal(summarizeBackup(buildBackup({ local: { wordlist: [card('你好')] } })), '1 card');
});

// --- writing it back into a browser that may not have room ----------------

test('when it cannot go in at once, the deck goes in first', () => {
  const plan = planRestore(roundTrip(buildBackup(fullState())), {}, 2000);
  const order = restoreOrder(plan.local);
  // Nothing regenerates a deck, so it does not queue behind a news archive —
  // and the cards go before the record of what was deleted from them.
  assert.deepEqual(order.slice(0, 2), ['wordlist', 'tombstones']);
  // Bulky and, in the end, replaceable: last, whatever their size.
  assert.deepEqual(
    order.slice(-3).sort(),
    ['newsCategories', 'newsHistory', 'tutorChatLog'],
  );
});

test('between the two, the small things go first so one big value cannot starve them', () => {
  const order = restoreOrder({
    newsHistory: ['big'.repeat(500)],
    wordlist: [card('你好')],
    hskLevel: 3,
    // A key from a build this code has never seen is ordinary state: neither
    // privileged like the deck nor deprioritised like the archive.
    progressStreak: { days: 12, best: 30 },
    tombstones: [],
  });
  assert.deepEqual(order, ['wordlist', 'tombstones', 'hskLevel', 'progressStreak', 'newsHistory']);
});

test('what did not fit is named in words, and an unknown key names itself', () => {
  assert.equal(labelFor('newsHistory'), 'the news archive');
  assert.equal(labelFor('wordlist'), 'your saved cards');
  assert.equal(labelFor('progressStreak'), '"progressStreak"');
  assert.equal(joinList(['a']), 'a');
  assert.equal(joinList(['a', 'b']), 'a and b');
  assert.equal(joinList(['a', 'b', 'c']), 'a, b and c');
  assert.equal(joinList([]), '');
});

console.log(`OK — ${passed} tests passed`);
