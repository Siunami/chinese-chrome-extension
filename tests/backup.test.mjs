// Unit tests for extension/lib/backup.js — the file a learner falls back on
// when Chrome has thrown their progress away, and the restore that puts it
// back without throwing away what is already here.
// Run: node tests/backup.test.mjs

import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  BACKUP_DUE_MS, BACKUP_STATE_KEY, FORMAT, SECRET_KEYS, TRANSIENT_KEYS, VERSION,
  backupFilename, backupReminder, buildBackup, countsAsWork, humanizeSpan, joinList,
  labelFor, markDirty, markSaved, planRestore, readBackup, readBackupState, restoreOrder,
  summarizeBackup,
} from '../extension/lib/backup.js';
import { cardKey } from '../extension/lib/merge.js';
import { STUDY_PROGRESS_KEY } from '../extension/lib/studysets.js';

const DAY = 24 * 60 * 60 * 1000;

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
    backupState: { at: 50, dirtySince: 80 },
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
  assert.deepEqual(TRANSIENT_KEYS, ['aiState', 'aiHealth', 'backupState']);
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

test('shared set progress merges by newest grade and reconciles the library card', () => {
  const item = card('你好');
  const key = cardKey(item);
  const old = { due: 4000, reps: 2, reviewedAt: 3000 };
  const recent = { due: 9000, reps: 5, reviewedAt: 8000 };
  const state = fullState();
  state.local.wordlist = [{ ...item, srs: old }];
  state.local[STUDY_PROGRESS_KEY] = { [key]: old };
  const backup = roundTrip(buildBackup(state));
  const plan = planRestore(backup, {
    wordlist: [{ ...item, srs: recent }],
    tombstones: [],
    [STUDY_PROGRESS_KEY]: { [key]: recent },
  }, 10000);
  assert.deepEqual(plan.local[STUDY_PROGRESS_KEY][key], recent);
  assert.deepEqual(plan.local.wordlist[0].srs, recent);
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
  assert.equal(labelFor(STUDY_PROGRESS_KEY), 'your shared review schedules');
  assert.equal(labelFor('progressStreak'), '"progressStreak"');
  assert.equal(joinList(['a']), 'a');
  assert.equal(joinList(['a', 'b']), 'a and b');
  assert.equal(joinList(['a', 'b', 'c']), 'a, b and c');
  assert.equal(joinList([]), '');
});

// --- knowing when to ask --------------------------------------------------

test('an install with nothing unsaved is never asked to back up', () => {
  // The whole point of not putting this on a timer: a browser that has been
  // sitting untouched for a year is not overdue for anything.
  assert.equal(backupReminder({ at: 1000, dirtySince: 0 }, 1000 + 400 * DAY).due, false);
  assert.equal(backupReminder(null, 400 * DAY).due, false);
  assert.equal(backupReminder({ nonsense: true }, 400 * DAY).due, false);
});

test('work that is only hours old is not worth interrupting anybody for', () => {
  // A nudge ten minutes after a card is saved is how a reminder teaches you to
  // ignore it before the day it would have mattered.
  const now = 100 * DAY;
  assert.equal(backupReminder({ at: 1, dirtySince: now - 3 * DAY }, now).due, false);
  assert.equal(backupReminder({ at: 1, dirtySince: now - BACKUP_DUE_MS + 1 }, now).due, false);
  assert.equal(backupReminder({ at: 1, dirtySince: now - BACKUP_DUE_MS }, now).due, true);
});

test('the clock is the age of the oldest unsaved work, not of the last backup', () => {
  const now = 100 * DAY;
  // Backed up a year ago, studied yesterday: one day of exposure, not a year.
  assert.equal(backupReminder({ at: now - 365 * DAY, dirtySince: now - DAY }, now).due, false);
  // Backed up yesterday is irrelevant if dirtySince says otherwise; the two
  // are independent, and only one of them decides.
  assert.equal(backupReminder({ at: now - DAY, dirtySince: now - 30 * DAY }, now).due, true);
});

test('an install that has never made a file is told that, in those words', () => {
  const now = 100 * DAY;
  const fresh = backupReminder({ at: 0, dirtySince: now - 20 * DAY }, now);
  assert.equal(fresh.due, true);
  assert.match(fresh.detail, /has ever been saved to a file/);
  assert.match(fresh.detail, /3 weeks/);

  const again = backupReminder({ at: now - 60 * DAY, dirtySince: now - 20 * DAY }, now);
  assert.match(again.detail, /since your last backup/);
  assert.equal(again.at, now - 60 * DAY);
});

test('the age is rounded to something a person would say', () => {
  assert.equal(humanizeSpan(9 * DAY), '9 days');
  assert.equal(humanizeSpan(20 * DAY), '3 weeks');
  assert.equal(humanizeSpan(95 * DAY), '3 months');
});

test('the clock starts once per backup cycle, not once per card', () => {
  // The first change after a backup is the only one that says anything new, so
  // it is the only one that costs a write. Everything after it is a no-op.
  const first = markDirty({ at: 500, dirtySince: 0 }, 900);
  assert.deepEqual(first, { at: 500, dirtySince: 900 });
  assert.equal(markDirty(first, 1200), null);
  assert.equal(markDirty(first, 99999), null);
  // Backing up clears it, and the next change starts a fresh one.
  const saved = markSaved(2000);
  assert.deepEqual(saved, { at: 2000, dirtySince: 0 });
  assert.deepEqual(markDirty(saved, 2100), { at: 2000, dirtySince: 2100 });
});

test('storage that moves on its own does not count as the learner working', () => {
  // A background sync every half hour, a health probe, and the tutor drawer
  // being opened would otherwise make an abandoned browser look studied-in.
  assert.equal(countsAsWork({ syncMeta: {} }, 'local'), false);
  assert.equal(countsAsWork({ aiState: {}, aiHealth: {} }, 'local'), false);
  assert.equal(countsAsWork({ tutorOpen: {} }, 'local'), false);
  assert.equal(countsAsWork({ [BACKUP_STATE_KEY]: {} }, 'local'), false);
  // And in particular the write that records a backup cannot start the cycle
  // it just ended.
  assert.equal(countsAsWork({ [BACKUP_STATE_KEY]: {}, aiState: {} }, 'local'), false);

  assert.equal(countsAsWork({ wordlist: {} }, 'local'), true);
  assert.equal(countsAsWork({ placementResults: {} }, 'local'), true);
  assert.equal(countsAsWork({ theme: {} }, 'sync'), true);
  // A key from a build this code has never seen is work until proven otherwise:
  // the failure that matters is failing to ask, not asking too often.
  assert.equal(countsAsWork({ somethingAddedNextYear: {} }, 'local'), true);
  assert.equal(countsAsWork({ wordlist: {} }, 'managed'), false);
});

test('a stored state in any shape reads as two numbers', () => {
  assert.deepEqual(readBackupState({ at: 5, dirtySince: 9 }), { at: 5, dirtySince: 9 });
  assert.deepEqual(readBackupState(undefined), { at: 0, dirtySince: 0 });
  assert.deepEqual(readBackupState('nope'), { at: 0, dirtySince: 0 });
  assert.deepEqual(readBackupState({ at: -1, dirtySince: NaN }), { at: 0, dirtySince: 0 });
});

test("this install's own bookkeeping does not travel in the file", () => {
  // It describes the machine that wrote the file, at a moment before the file
  // existed. Restoring it would tell a just-restored install it had never
  // backed up, which is both wrong and the exact opposite of reassuring.
  const backup = buildBackup(fullState());
  assert.equal(BACKUP_STATE_KEY in backup.local, false);
});

test('restoring dates the install from the file it was restored from', () => {
  const backup = roundTrip(buildBackup(fullState(), { now: 1700000000000 }));
  const plan = planRestore(backup, {}, 1800000000000);
  // Restore a three-week-old backup and nothing is overdue: everything on this
  // machine is in that file, and dirtySince says so until you study again.
  assert.deepEqual(plan.local[BACKUP_STATE_KEY], { at: 1700000000000, dirtySince: 0 });
  assert.equal(backupReminder(plan.local[BACKUP_STATE_KEY], 1800000000000).due, false);

  // A file with no date still leaves the install in a truthful state rather
  // than claiming it has never been backed up.
  const undated = { ...backup, createdAt: 0 };
  assert.deepEqual(planRestore(undated, {}, 555).local[BACKUP_STATE_KEY],
    { at: 555, dirtySince: 0 });
});

test('backups are named by the day they were taken', () => {
  assert.equal(backupFilename(1700000000000), 'zhongwen-explorer-backup-2023-11-14.json');
});

// --- the promise the whole feature rests on -------------------------------

test('nothing in the extension keeps state anywhere a backup cannot see it', () => {
  // A backup is a dump of chrome.storage, and that is only "everything" for as
  // long as chrome.storage is the only place the extension puts anything. The
  // day a feature reaches for IndexedDB or localStorage, the file silently
  // stops being a complete copy — and it fails as somebody's lost progress
  // years later, not as anything visible at the time. So the guard is here.
  const extDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'extension');
  const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = join(dir, e.name);
    if (e.isDirectory()) return e.name === 'data' ? [] : walk(full);
    return e.name.endsWith('.js') ? [full] : [];
  });
  const banned = /\b(?:window\.|globalThis\.|self\.)?(indexedDB|localStorage|sessionStorage)\b/;
  const offenders = walk(extDir)
    .filter((file) => banned.test(readFileSync(file, 'utf8')))
    .map((file) => file.slice(extDir.length + 1));
  assert.deepEqual(offenders, [],
    `these keep state outside chrome.storage, so a backup no longer copies all of it: `
    + `${offenders.join(', ')}`);
});

console.log(`OK — ${passed} tests passed`);
