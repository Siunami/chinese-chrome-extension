// Writing the file, and remembering that it was written.
//
// lib/backup.js is pure: it decides what belongs in a backup, what a restore
// means, and when a browser is overdue for one. This is the half that touches
// Chrome — the storage reads, the blob, the anchor click, and the one key that
// records what happened — and it lives apart from the options page because two
// surfaces now write backups: the Backup section, and the button the navbar
// grows when work has been sitting here unsaved for a week.
//
// One of those surfaces is a service worker away: background.js calls
// noteStorageChange() and nothing else here, so nothing at the top of this
// module may touch `document`.

import {
  BACKUP_STATE_KEY, SECRETS_PREF_KEY,
  backupFilename, backupReminder, buildBackup, countsAsWork, markDirty, markSaved,
  readBackupState,
} from './backup.js';

export async function getBackupState() {
  const stored = await chrome.storage.local.get(BACKUP_STATE_KEY).catch(() => ({}));
  return readBackupState(stored[BACKUP_STATE_KEY]);
}

/**
 * A storage change happened; start the clock if it is the first since the last
 * backup. Called from the service worker's storage listener, which is the only
 * place that sees every write — a card saved from a page you are reading is
 * written by the background, not by any extension page that could notice.
 *
 * Writes at most once per backup cycle. Everything after the first change is
 * already accounted for by the timestamp the first one set.
 */
export async function noteStorageChange(changes, area, now = Date.now()) {
  if (!countsAsWork(changes, area)) return;
  const next = markDirty(await getBackupState(), now);
  if (next) await chrome.storage.local.set({ [BACKUP_STATE_KEY]: next });
}

export async function getBackupReminder(now = Date.now()) {
  return backupReminder(await getBackupState(), now);
}

// The nudge appears and disappears as the learner works and backs up, and the
// navbar carrying it is on every page at once.
export function onBackupReminder(callback) {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (changes[BACKUP_STATE_KEY]) getBackupReminder().then(callback);
  });
}

// Whether the API key and the pairing code go in the file. The options page
// owns the checkbox; this is where its answer is kept, so that a button
// somewhere else in the app cannot quietly make the opposite choice.
export async function getIncludeSecrets() {
  const stored = await chrome.storage.sync
    .get({ [SECRETS_PREF_KEY]: true })
    .catch(() => ({ [SECRETS_PREF_KEY]: true }));
  return stored[SECRETS_PREF_KEY] !== false;
}

export const setIncludeSecrets = (on) =>
  chrome.storage.sync.set({ [SECRETS_PREF_KEY]: !!on }).catch(() => {});

/**
 * Write everything this browser knows to a file in the learner's Downloads.
 *
 * Resolves to { backup, bytes, includeSecrets } once the file has been handed
 * to Chrome and the install has been marked as saved.
 */
export async function downloadBackup({ includeSecrets, now = Date.now() } = {}) {
  const secrets = includeSecrets === undefined ? await getIncludeSecrets() : !!includeSecrets;
  // `null` rather than a list of keys: whatever this install has stored is
  // what the file gets, including state written by a version of the extension
  // this code has never heard of.
  const [sync, local] = await Promise.all([
    chrome.storage.sync.get(null),
    chrome.storage.local.get(null),
  ]);
  const backup = buildBackup({ sync, local }, {
    includeSecrets: secrets,
    now,
    extensionVersion: chrome.runtime.getManifest().version,
  });
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = backupFilename(backup.createdAt);
  a.click();
  URL.revokeObjectURL(url);

  // Only after the file exists. A failed download that still reset the clock
  // would leave the learner told they were safe by the thing that did not save
  // them — and backupState is one of the keys that does not itself count as
  // work, so this write cannot start the next cycle it is ending.
  await chrome.storage.local.set({ [BACKUP_STATE_KEY]: markSaved(backup.createdAt) });
  return { backup, bytes: blob.size, includeSecrets: secrets };
}
