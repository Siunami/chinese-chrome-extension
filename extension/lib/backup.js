// Taking your work with you: one file that holds everything this browser knows
// about your learning, and a restore that puts it back.
//
// All of it lives in chrome.storage — saved cards and review progress,
// settings, the news archive, placement results, tutor conversations — which
// makes it the browser's data rather than yours. Uninstalling the extension,
// resetting a Chrome profile, or moving to another Mac takes the lot, silently
// and with no copy anywhere. Phone sync is not that copy: it carries cards and
// nothing else, and only while a server is paired.
//
// So a backup is a straight dump of both storage areas rather than a
// hand-picked list of keys. A curated list is the version of this that rots —
// a feature added next year stores something new, nobody remembers to add it
// here, and the omission surfaces as a learner's lost progress instead of as a
// failing test. Everything is in; the two keys that describe the last five
// minutes rather than the learner are named below, and the two that are
// credentials are the one choice the page asks about.
//
// Pure functions, no browser APIs: options.js does the storage reads, the file
// download and the DOM, and this module decides what goes in and what a
// restore means.

import { applyRemote, capCards } from './merge.js';

export const FORMAT = 'zhongwen-explorer-backup';
export const VERSION = 1;

// Same caps sync.js enforces — a restore is another way for cards to arrive,
// and it must leave the deck in a shape the next sync would also accept.
const MAX_WORDLIST = 5000;
const MAX_TOMBSTONES = 5000;

// Not the learner's, and actively wrong to carry: the last thing a model
// provider said about a key (aiState) and what the paired server answered
// about its own (aiHealth). Both are re-derived by the next call, and a stale
// "your key was rejected" restored onto a fresh install is a warning banner
// about a key nobody has tried yet.
export const TRANSIENT_KEYS = ['aiState', 'aiHealth'];

// A credential and a capability: the model-provider key that calls are billed
// to, and the pairing token, which is the password to the synced deck. Both
// are needed to use the app exactly as it was, and both make the file worth
// more than the cards in it — so whether they travel is the one decision the
// backup puts to the learner rather than making for them.
export const SECRET_KEYS = ['aiKey', 'syncMeta'];

export function buildBackup(
  { sync = {}, local = {} },
  { includeSecrets = true, now = 0, extensionVersion = '' } = {},
) {
  const drop = new Set(includeSecrets ? TRANSIENT_KEYS : TRANSIENT_KEYS.concat(SECRET_KEYS));
  const kept = {};
  for (const [key, value] of Object.entries(local)) {
    if (!drop.has(key)) kept[key] = value;
  }
  return {
    format: FORMAT,
    version: VERSION,
    createdAt: now,
    extensionVersion,
    sync: { ...sync },
    local: kept,
  };
}

// Parse and vet a file the learner picked. Every rejection throws a sentence
// meant to be shown as-is: this is the one place where the alternative to a
// plain explanation is overwriting a working install from a file that turned
// out to be someone's tax return.
export function readBackup(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('That file is not a backup — it is not even JSON.');
  }
  if (!data || typeof data !== 'object' || Array.isArray(data) || data.format !== FORMAT) {
    throw new Error('That is not a Zhongwen Explorer backup. Pick the .json file the '
      + 'Download backup button saved.');
  }
  const version = Number(data.version);
  if (!Number.isFinite(version) || version < 1) {
    throw new Error('That backup does not say which format it is in, so it cannot be read.');
  }
  // Forward compatibility is the one thing a backup cannot fake: a file from a
  // newer extension may hold state this build has no idea how to place, and
  // half-restoring it is worse than saying so.
  if (version > VERSION) {
    throw new Error(`That backup was written by a newer version of the extension `
      + `(format ${version}; this one reads ${VERSION}). Update the extension, then restore.`);
  }
  const plain = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
  return { ...data, version, sync: plain(data.sync), local: plain(data.local) };
}

// What is in this file, in the words the app uses elsewhere for it. Shown
// before anything is written, because "Restore backup?" asks the learner to
// approve something they cannot see.
export function summarizeBackup(backup) {
  const local = backup.local || {};
  const size = (v) => (Array.isArray(v) ? v.length : 0);
  const parts = [];
  const add = (n, one, many) => { if (n) parts.push(`${n} ${n === 1 ? one : many}`); };
  add(size(local.wordlist), 'card', 'cards');
  add(Object.keys(backup.sync || {}).length, 'setting', 'settings');
  add(size(local.newsHistory), 'news article', 'news articles');
  add(size(local.placementResults), 'placement result', 'placement results');
  add(size(local.tutorChatLog), 'tutor conversation', 'tutor conversations');
  if (typeof local.aiKey === 'string' && local.aiKey) parts.push('the API key');
  if (local.syncMeta && local.syncMeta.token) parts.push('the pairing code');
  if (!parts.length) return 'an empty backup';
  if (parts.length === 1) return parts[0];
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

// What to write, given the file and what this computer holds now.
//
// Two different meanings of "restore", because the state divides in two. A
// setting, a difficulty dial, a level: single-valued, so the file wins — that
// is what restoring a setting means. Cards are not like that. They are a
// replica that already knows how to reconcile with another replica, so they go
// through the same merge the phone's sync uses: a card saved or reviewed since
// the backup survives it, a card deleted since stays deleted, and restoring
// the same file twice changes nothing the second time.
//
// Keys absent from the file are left alone rather than cleared. That is what
// makes leaving the credentials out of a backup safe: restoring it does not
// then unpair the machine you restore onto.
export function planRestore(backup, current = {}, now = 0) {
  const local = { ...backup.local };
  const cards = Array.isArray(backup.local?.wordlist) ? backup.local.wordlist : [];
  const dead = Array.isArray(backup.local?.tombstones) ? backup.local.tombstones : [];
  const incoming = cards.concat(dead.map((t) => ({ ...t, deleted: true })));
  const merged = applyRemote(current.wordlist || [], current.tombstones || [], incoming);
  const capped = capCards(merged.cards, MAX_WORDLIST, now);
  local.wordlist = capped.cards;
  local.tombstones = capped.tombstones.concat(merged.tombstones).slice(0, MAX_TOMBSTONES);
  return { sync: { ...backup.sync }, local };
}
