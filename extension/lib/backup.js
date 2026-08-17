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

import { applyRemote, capCards, cardKey } from './merge.js';
import {
  latestSrs, mergeStudyProgress, STUDY_PROGRESS_KEY,
} from './studysets.js';

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

export function joinList(parts) {
  if (parts.length < 2) return parts[0] || '';
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
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
  return parts.length ? joinList(parts) : 'an empty backup';
}

// ---------------------------------------------------------------------------
// Writing a restore back into a browser that may not have room for it
//
// chrome.storage.local holds ten megabytes without the unlimitedStorage
// permission, and this app can approach that on its own: sixty news passages,
// forty tutor conversations carrying thumbnails, five thousand cards and five
// thousand tombstones. The manifest asks for unlimitedStorage so the ceiling is
// the disk rather than the number — but a quota is never the only reason a
// write fails, and one that fails takes down whatever it was bundled with.
//
// So a restore that cannot be written in one call is written a key at a time,
// in this order: the deck first, because nothing anywhere can reconstruct it;
// then everything else smallest-first, so one oversized value cannot starve a
// dozen small ones; and last the bulky, replaceable things — a news passage can
// be generated again and suggested topics are a cache. Whatever is left over is
// named rather than silently dropped.
// ---------------------------------------------------------------------------

const DECK_KEYS = ['wordlist', 'tombstones', STUDY_PROGRESS_KEY];
const BULK_KEYS = ['newsHistory', 'tutorChatLog', 'newsCategories'];

export function restoreOrder(values) {
  const bytes = (key) => JSON.stringify(values[key] ?? null).length;
  const tier = (key) => {
    if (DECK_KEYS.includes(key)) return 0;
    return BULK_KEYS.includes(key) ? 2 : 1;
  };
  return Object.keys(values).sort((a, b) => {
    if (tier(a) !== tier(b)) return tier(a) - tier(b);
    // The deck keeps its own order rather than going smallest-first: the cards
    // are the irreplaceable half, and an empty tombstone list is smaller than
    // any deck, so size would send the wrong one in first.
    if (tier(a) === 0) return DECK_KEYS.indexOf(a) - DECK_KEYS.indexOf(b);
    return bytes(a) - bytes(b) || (a < b ? -1 : 1);
  });
}

// Storage keys are not a thing to show anyone, but "the news archive did not
// fit" is. Anything unnamed is a key from a newer build, so it says the key.
const KEY_LABELS = {
  wordlist: 'your saved cards',
  tombstones: 'the record of deleted cards',
  [STUDY_PROGRESS_KEY]: 'your shared review schedules',
  newsHistory: 'the news archive',
  newsCategories: 'the suggested news topics',
  newsDifficulty: 'the news level',
  tutorChatLog: 'your tutor conversations',
  tutorOpen: 'whether the tutor drawer is open',
  placementResults: 'your placement results',
  hskLevel: 'your HSK level',
  enabled: 'the on/off switch',
  aiKey: 'the API key',
  syncMeta: 'the pairing code',
};

export const labelFor = (key) => KEY_LABELS[key] || `"${key}"`;

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
  // HSK sets and the saved library have different membership but one schedule
  // per card. Merge that schedule exactly like card review state: the newest
  // grade wins, whether it lived in the file, this browser's HSK progress, or
  // an inline library card from an older version.
  let progress = mergeStudyProgress(
    backup.local?.[STUDY_PROGRESS_KEY],
    current[STUDY_PROGRESS_KEY],
  );
  for (const card of local.wordlist) {
    const key = cardKey(card);
    const srs = latestSrs(card.srs, progress[key]);
    card.srs = srs;
    if (srs) progress[key] = srs;
  }
  if (Object.keys(progress).length
      || backup.local?.[STUDY_PROGRESS_KEY] || current[STUDY_PROGRESS_KEY]) {
    local[STUDY_PROGRESS_KEY] = progress;
  }
  return { sync: { ...backup.sync }, local };
}
