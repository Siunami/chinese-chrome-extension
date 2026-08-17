// MV3 service worker: owns the dictionary + example corpus, answers lookups.

import {
  parseDictTSV, buildIndex, buildRelatedIndex, findRelated, lookupAt,
  charBreakdown, rankEntryIndices, parsePinyin, findExamples, sentencePinyin,
} from './lib/cedict.js';
import {
  pickMandarinVoice, sortedMandarinVoices, voiceId,
} from './lib/voices.js';
import { resolveCard, isMachineGloss } from './lib/cards.js';
import { buildScriptMap, convertText, TO_TRAD, TO_SIMP } from './lib/script.js';
import { translateGlossed, isPermanent } from './lib/translate.js';
import { cardKey, tombstoneFor } from './lib/merge.js';
import { getAiKey, getSyncMeta, syncNow } from './lib/sync.js';
import { postAi } from './lib/aistatus.js';
import { latestSrs, STUDY_PROGRESS_KEY } from './lib/studysets.js';

// ---------------------------------------------------------------------------
// Data loading (lazy; the worker may be restarted at any time)
// ---------------------------------------------------------------------------

let dataPromise = null;

async function loadData() {
  const [dictText, sentText] = await Promise.all([
    fetch(chrome.runtime.getURL('data/dict.tsv')).then((r) => r.text()),
    fetch(chrome.runtime.getURL('data/sentences.tsv')).then((r) => r.text()),
  ]);
  const entries = parseDictTSV(dictText);
  const index = buildIndex(entries);
  const relatedIndex = buildRelatedIndex(entries);
  // Character fallback tables for simplified <-> traditional. Built with the
  // indexes because it walks the same entries and is only worth doing once.
  const scriptMap = buildScriptMap(entries);
  const sentences = [];
  for (const line of sentText.split('\n')) {
    if (!line) continue;
    const [zh, py, en] = line.split('\t');
    if (zh && en) sentences.push({ zh, py: py || '', en });
  }
  return { entries, index, relatedIndex, scriptMap, sentences };
}

function ensureData() {
  if (!dataPromise) dataPromise = loadData().catch((e) => { dataPromise = null; throw e; });
  return dataPromise;
}

// ---------------------------------------------------------------------------
// Enabled state + badge
// ---------------------------------------------------------------------------

async function getEnabled() {
  const { enabled = true } = await chrome.storage.local.get('enabled');
  return enabled;
}

async function updateBadge(enabled) {
  await chrome.action.setBadgeText({ text: enabled ? 'ON' : '' });
  if (enabled) await chrome.action.setBadgeBackgroundColor({ color: '#B5232B' });
}

chrome.runtime.onInstalled.addListener(async () => {
  await updateBadge(await getEnabled());
  const { exampleDefaultsVersion = 1, exampleCount } =
    await chrome.storage.sync.get(['exampleDefaultsVersion', 'exampleCount']);
  if (exampleDefaultsVersion < 2) {
    const update = { exampleDefaultsVersion: 2 };
    // Preserve explicit custom choices; only migrate the old default.
    if (exampleCount === undefined || exampleCount === 5) update.exampleCount = 8;
    await chrome.storage.sync.set(update);
  }
});

chrome.runtime.onStartup.addListener(() => {
  getEnabled().then(updateBadge);
});

// Re-sync on every worker start: neither onInstalled nor onStartup fires when
// the user re-enables the extension from chrome://extensions, and badge text
// does not survive a disable/enable cycle.
getEnabled().then(updateBadge);

chrome.action.onClicked.addListener(async () => {
  const enabled = !(await getEnabled());
  await chrome.storage.local.set({ enabled });
  await updateBadge(enabled);
});

// ---------------------------------------------------------------------------
// Phone sync (lib/sync.js). Triggers: a periodic alarm, a short debounce
// alarm armed whenever cards change, and explicit syncNow messages from the
// review/options pages. Alarms (not setTimeout) so triggers survive the
// service worker being torn down. Unpaired installs no-op instantly.
// ---------------------------------------------------------------------------

const SYNC_ALARM = 'sync-periodic';
const SYNC_DEBOUNCE_ALARM = 'sync-debounce';

// Create only if missing: create() replaces the alarm and would restart the
// 30-minute countdown on every service-worker wake, so a busy browser would
// never actually reach it.
chrome.alarms.get(SYNC_ALARM).then((alarm) => {
  if (!alarm) chrome.alarms.create(SYNC_ALARM, { periodInMinutes: 30 });
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === SYNC_ALARM || alarm.name === SYNC_DEBOUNCE_ALARM) syncNow();
  // Backstop for translations lost to the worker being torn down mid-request,
  // and the path by which cards saved before /api/translate existed get a real
  // back rather than staying glossed forever.
  if (alarm.name === SYNC_ALARM) translateGlossedCards();
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  // syncMeta changes are sync's own bookkeeping; reacting to them would loop.
  if (!changes.wordlist && !changes.tombstones) return;
  chrome.alarms.create(SYNC_DEBOUNCE_ALARM, { delayInMinutes: 0.5 });
});

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

const MAX_ENTRIES_SHOWN = 8;
const MAX_WORDLIST = 5000;
const MAX_TOMBSTONES = 5000;
// A popup shows at most 8 entries plus their example sentences, characters,
// and related words; this is well clear of that and bounds the message.
const MAX_SAVED_STATE_KEYS = 200;
// One HSK guide asks for a star on every grammar example, vocabulary item and
// passage sentence at once; the longest level stays comfortably inside this.
const MAX_RESOLVE_ITEMS = 400;
// Long enough that an oversized selection is refused by lib/cards.js with a
// reason the bar can explain, rather than silently truncated into a card.
const MAX_CARD_TEXT = 400;
// A whole HSK guide converts in one request: every heading, example, vocabulary
// item and passage sentence at once. The longest level stays well inside this.
const MAX_CONVERT_TEXTS = 2000;
const MAX_CONVERT_CHARS = 4000;
let voicesPromise = null;

function entryForDisplay(e) {
  return {
    trad: e.trad,
    simp: e.simp,
    pinyin: parsePinyin(e.pinyin), // [{ text, tone }]
    defs: e.defs,
  };
}

async function handleLookup(msg) {
  const { entries, index, relatedIndex, sentences } = await ensureData();
  const { groups, highlight } = lookupAt(
    index, entries, msg.text || '', msg.cursorIndex || 0,
  );
  if (groups.length === 0) return { matches: [] };

  // CEDICT source order sometimes puts a surname or variant before the
  // everyday sense (e.g. 全 Quan2 before quan2 "all; whole"). Rank each
  // homograph group before rendering and before choosing the default save.
  const rankedGroups = groups.map((group) => {
    const localIds = group.entries.map((_, i) => i);
    return {
      ...group,
      entries: rankEntryIndices(localIds, group.entries).map((i) => group.entries[i]),
    };
  });

  let shown = 0;
  const outMatches = [];
  for (const g of rankedGroups) {
    if (shown >= MAX_ENTRIES_SHOWN) break;
    const display = g.entries.slice(0, MAX_ENTRIES_SHOWN - shown).map(entryForDisplay);
    shown += display.length;
    outMatches.push({ word: g.word, entries: display });
  }

  const top = rankedGroups[0].entries[0];
  const exampleCount = Math.max(0, Math.min(15, msg.exampleCount ?? 8));
  const examples = findExamples(
    sentences, top.simp, top.trad, exampleCount, index, entries,
  ).map((s) => ({ zh: s.zh, py: s.py, en: s.en }));

  // per-character definitions when the primary match is a phrase
  const chars = charBreakdown(index, groups[0].word).map((c) => ({
    char: c.char,
    entryCount: c.idxs.length,
    entries: rankEntryIndices(c.idxs, entries)
      .slice(0, 3)
      .map((i) => entryForDisplay(entries[i])),
  }));

  const related = msg.includeRelated === false ? [] :
    findRelated(entries, index, relatedIndex, groups[0].word, 3).map((r) => ({
      ...entryForDisplay(entries[r.idx]),
      reason: r.reason,
      sharedChars: r.sharedChars,
    }));

  return {
    matches: outMatches,
    highlight,
    chars,
    related,
    examples,
    exampleWord: { simp: top.simp, trad: top.trad },
  };
}

// Identity of a card as the popup and the library see it. cardKey includes
// trad so homographs sharing a simplified form and pinyin (面 face vs 麵→面
// noodles) stay separate entries; a missing trad (legacy entries) equals simp.
function keyForEntry(e) {
  return cardKey({
    cardType: e.cardType === 'sentence' ? 'sentence' : 'word',
    simp: String(e.simp || ''),
    trad: String(e.trad || ''),
    pinyin: String(e.pinyin || ''),
  });
}

async function handleSaveWord(msg) {
  const e = msg.entry || {};
  const cardType = e.cardType === 'sentence' ? 'sentence' : 'word';
  const simp = String(e.simp || '');
  const pinyin = String(e.pinyin || '');
  if (!simp) return { ok: false };
  const trad = String(e.trad || '');
  const now = Date.now();
  const { wordlist = [], [STUDY_PROGRESS_KEY]: studyProgress = {} } =
    await chrome.storage.local.get(['wordlist', STUDY_PROGRESS_KEY]);
  const key = keyForEntry(e);
  const idx = wordlist.findIndex((w) => cardKey(w) === key);
  let word;
  if (idx !== -1) {
    // Re-saving an existing word: bump the counter, keep SRS progress,
    // refresh content (also backfills tones on entries saved by v1.0).
    word = wordlist.splice(idx, 1)[0];
    word.touches = (word.touches || 1) + 1;
    word.lastSavedAt = now;
    word.defs = String(e.defs || word.defs || '');
    word.tones = String(e.tones || word.tones || '');
    word.cardType = cardType;
    word.sourceWord = String(e.sourceWord || word.sourceWord || '');
  } else {
    word = {
      cardType,
      simp,
      trad,
      pinyin,
      tones: String(e.tones || ''),
      defs: String(e.defs || ''),
      savedAt: now,
      lastSavedAt: now,
      touches: 1,
      srs: null,
      sourceWord: String(e.sourceWord || ''),
    };
  }
  // Joining the saved library is membership, not a reset. If this word has
  // already been studied through an HSK set, carry that one shared schedule
  // into the new library row.
  word.srs = latestSrs(word.srs, studyProgress[key]);
  if (e.glossed) word.glossed = true;
  wordlist.unshift(word);
  await chrome.storage.local.set({ wordlist: wordlist.slice(0, MAX_WORDLIST) });
  // Saving stays instant: the card lands with its gloss and the translation
  // arrives a moment later. Not awaited, and deliberately not fatal — the
  // sweep below picks up anything this misses.
  if (word.cardType === 'sentence' && word.glossed) translateGlossedCards();
  return { ok: true, count: wordlist.length };
}

// ---------------------------------------------------------------------------
// Real translations for sentence cards the dictionary cannot translate. The
// decision half lives in lib/translate.js; this is the chrome wiring.
//
// Runs on save and again on the periodic sync alarm, so a translation lost to
// the service worker being torn down mid-request is retried rather than gone,
// and cards saved before /api/translate existed get a real back too.
// ---------------------------------------------------------------------------

let translating = false;

async function requestTranslation(meta, text) {
  try {
    return await postAi(meta, '/api/translate', { text });
  } catch (err) {
    // A card the model will never translate (not Chinese, too long, nothing
    // translatable in it) must not come back on every sweep. A rejected key is
    // the opposite: the same card is worth trying again the moment a working
    // key is pasted, so it is explicitly not permanent.
    err.permanent = isPermanent(err.status) && err.code !== 'bad-key'
      && err.code !== 'no-quota' && err.code !== 'no-key';
    throw err;
  }
}

// Rewrite by identity against the freshest list: the card may have been
// deleted, edited, or reordered while the model was thinking. cardKey ignores
// `defs`, so a translated card is the same card, not a second copy.
async function patchCard(card, changes) {
  const key = cardKey(card);
  const { wordlist = [] } = await chrome.storage.local.get('wordlist');
  const target = wordlist.find((w) => cardKey(w) === key);
  if (!target) return false;
  Object.assign(target, changes);
  await chrome.storage.local.set({ wordlist });
  return true;
}

async function translateGlossedCards() {
  if (translating) return;
  const meta = await getSyncMeta();
  if (!meta || !meta.token || !meta.serverUrl) return; // no server: keep the gloss
  // Same for no AI key: translation is the one sync-alarm job that costs the
  // learner money, so don't run the pass at all rather than let every alarm
  // spend a round of requests on a 503.
  if (!(await getAiKey())) return;
  translating = true;
  try {
    const { entries, index } = await ensureData();
    const { wordlist = [] } = await chrome.storage.local.get('wordlist');
    await translateGlossed({
      cards: wordlist,
      isGloss: (card) => isMachineGloss(index, entries, card),
      request: (text) => requestTranslation(meta, text),
      patch: patchCard,
    });
  } finally {
    translating = false;
  }
}

// The other half of the popup's save toggle. Tombstoned like a delete from the
// library, so the removal syncs to other devices instead of being resurrected
// by the next pull.
async function handleUnsaveWord(msg) {
  const e = msg.entry || {};
  if (!e.simp) return { ok: false };
  const key = keyForEntry(e);
  const { wordlist = [], tombstones = [] } =
    await chrome.storage.local.get(['wordlist', 'tombstones']);
  const idx = wordlist.findIndex((w) => cardKey(w) === key);
  if (idx === -1) return { ok: true, removed: false, count: wordlist.length };
  const [removed] = wordlist.splice(idx, 1);
  tombstones.unshift(tombstoneFor(removed, Date.now()));
  await chrome.storage.local.set({
    wordlist,
    tombstones: tombstones.slice(0, MAX_TOMBSTONES),
  });
  return { ok: true, removed: true, count: wordlist.length };
}

// Which of these cards are already saved, answered in the order asked. Keys
// are cardKey() strings: a popup can ask about a whole screenful of entries in
// one message instead of pulling the entire word list into every page.
async function handleSavedStates(msg) {
  const keys = (Array.isArray(msg.keys) ? msg.keys : [])
    .slice(0, MAX_SAVED_STATE_KEYS)
    .map(String);
  if (keys.length === 0) return { saved: [] };
  const { wordlist = [] } = await chrome.storage.local.get('wordlist');
  const have = new Set(wordlist.map(cardKey));
  return { saved: keys.map((k) => have.has(k)) };
}

// Text -> card, for every save control that is not the popup's own: the star
// on an HSK example sentence, a vocabulary item, a line of a reading passage,
// and the floating bar that appears on a text selection anywhere.
//
// Resolving here rather than in the page keeps one definition of what may
// become a card (lib/cards.js) and lets the answer carry the current saved
// state, so a control can paint itself correctly in a single round trip.
async function handleResolveCards(msg) {
  const items = (Array.isArray(msg.items) ? msg.items : []).slice(0, MAX_RESOLVE_ITEMS);
  if (items.length === 0) return { cards: [] };
  const { entries, index } = await ensureData();
  const { wordlist = [] } = await chrome.storage.local.get('wordlist');
  const have = new Set(wordlist.map(cardKey));
  return {
    cards: items.map((item) => {
      const resolved = resolveCard({
        map: index,
        entries,
        text: String(item?.text || '').slice(0, MAX_CARD_TEXT),
        en: String(item?.en || '').slice(0, 600),
        sourceWord: String(item?.sourceWord || '').slice(0, 40),
        unit: !!item?.unit,
      });
      if (resolved.issue) return { issue: resolved.issue };
      const key = cardKey(resolved.card);
      return { card: resolved.card, key, saved: have.has(key) };
    }),
  };
}

// Convert text into the script the 简/繁 toggle is set to.
//
// Lives here because conversion needs the dictionary: it segments first and
// swaps whole entries, so 头发 becomes 頭髮 while 发现 becomes 發現 (see
// lib/script.js). Pages send the strings they are about to render — a study
// guide, a generated news passage — and get them back in the right script.
async function handleConvertScript(msg) {
  const texts = (Array.isArray(msg.texts) ? msg.texts : []).slice(0, MAX_CONVERT_TEXTS);
  if (!texts.length) return { texts: [] };
  const to = msg.to === TO_TRAD ? TO_TRAD : TO_SIMP;
  const { entries, index, scriptMap } = await ensureData();
  return {
    texts: texts.map((t) => convertText(
      index, entries, scriptMap, String(t ?? '').slice(0, MAX_CONVERT_CHARS), to,
    )),
  };
}

// Example sentences for a specific word (used by the review page).
async function handleExamples(msg) {
  const { entries, index, sentences } = await ensureData();
  const simp = String(msg.simp || '');
  const trad = String(msg.trad || '') || simp;
  const count = Math.max(1, Math.min(5, msg.count ?? 2));
  const examples = findExamples(sentences, simp, trad, count, index, entries)
    .map((s) => ({ zh: s.zh, py: s.py, en: s.en }));
  return { examples };
}

async function availableVoices() {
  if (!voicesPromise) {
    voicesPromise = chrome.tts.getVoices().catch(() => []);
  }
  return voicesPromise;
}

if (chrome.tts.onVoicesChanged) {
  chrome.tts.onVoicesChanged.addListener(() => { voicesPromise = null; });
}

async function handleListVoices() {
  const voices = sortedMandarinVoices(await availableVoices());
  return {
    voices: voices.map((voice, index) => ({
      id: voiceId(voice),
      voiceName: voice.voiceName,
      lang: voice.lang || '',
      remote: !!voice.remote,
      recommended: index === 0,
    })),
  };
}

// Pinyin for a batch of Chinese strings, annotated the same way the bundled
// example corpus is. The HSK guides store no readings of their own — they ask
// for them here — so the guide text and the hover popup can never disagree.
async function handlePinyinBatch(msg) {
  const texts = (Array.isArray(msg.texts) ? msg.texts : [])
    .slice(0, 400)
    .map((t) => String(t || '').slice(0, 600));
  const { entries, index } = await ensureData();
  return { pinyin: texts.map((t) => (t ? sentencePinyin(index, entries, t) : '')) };
}

async function handleSpeak(msg) {
  const text = String(msg.text || '').trim().slice(0, 300);
  if (!text) return { ok: false };
  const settings = await chrome.storage.sync.get({
    mandarinVoiceId: 'auto',
    voiceRate: 0.95,
  });
  const preferredId = msg.voiceId || settings.mandarinVoiceId;
  const voice = pickMandarinVoice(await availableVoices(), preferredId);
  const requestedRate = Number(msg.rate ?? settings.voiceRate);
  const normalRate = Math.max(0.55, Math.min(1.35,
    Number.isFinite(requestedRate) ? requestedRate : 0.95));
  const options = {
    lang: voice?.lang || 'zh-CN',
    rate: msg.slow ? Math.max(0.45, normalRate * 0.72) : normalRate,
    pitch: 1,
    enqueue: false,
  };
  if (voice?.voiceName) options.voiceName = voice.voiceName;
  if (voice?.extensionId) options.extensionId = voice.extensionId;
  chrome.tts.stop();
  await chrome.tts.speak(text, options);
  return {
    ok: true,
    voice: voice?.voiceName || 'Chrome default',
    lang: voice?.lang || 'zh-CN',
  };
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  const handlers = {
    lookup: handleLookup,
    saveWord: handleSaveWord,
    unsaveWord: handleUnsaveWord,
    savedStates: handleSavedStates,
    resolveCards: handleResolveCards,
    examples: handleExamples,
    speak: handleSpeak,
    pinyinBatch: handlePinyinBatch,
    convertScript: handleConvertScript,
    listVoices: handleListVoices,
    getEnabled: async () => ({ enabled: await getEnabled() }),
    syncNow: () => syncNow(),
  };
  const handler = handlers[msg && msg.type];
  if (!handler) return false;
  handler(msg).then(sendResponse, (err) => sendResponse({ error: String(err) }));
  return true; // async response
});
