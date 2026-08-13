// Client-side dictionary for the PWA's tap-to-define sheet. The extension
// keeps this data in its MV3 service worker; here the same TSVs are fetched
// as static assets (cached offline by sw.js after the first load) and the
// same lib/cedict.js does the parsing and lookup. lookupDetails() returns
// the identical result shape as handleLookup in extension/background.js so
// UIs on both sides render the same thing.

import {
  parseDictTSV, buildIndex, buildRelatedIndex, findRelated, lookupAt,
  charBreakdown, rankEntryIndices, parsePinyin, findExamples,
} from './cedict.js';

const MAX_ENTRIES_SHOWN = 8;

export function parseSentencesTSV(text) {
  const out = [];
  for (const line of text.split('\n')) {
    if (!line) continue;
    const parts = line.split('\t');
    if (parts.length < 3) continue;
    out.push({ zh: parts[0], py: parts[1], en: parts[2] });
  }
  return out;
}

// Pure builder, separated from fetch so tests can feed in a tiny dictionary.
export function buildData(dictText, sentencesText) {
  const entries = parseDictTSV(dictText);
  return {
    entries,
    index: buildIndex(entries),
    relatedIndex: buildRelatedIndex(entries),
    sentences: parseSentencesTSV(sentencesText),
  };
}

let dataPromise = null;

async function fetchAndBuild() {
  const [dictRes, sentRes] = await Promise.all([
    fetch('./data/dict.tsv'),
    fetch('./data/sentences.tsv'),
  ]);
  if (!dictRes.ok || !sentRes.ok) throw new Error('dictionary download failed');
  const [dictText, sentText] = await Promise.all([dictRes.text(), sentRes.text()]);
  // The parse + index passes take a moment on a phone; yield between them so
  // a tap that triggered the load still gets paint frames.
  const pause = () => new Promise((resolve) => setTimeout(resolve, 0));
  const entries = parseDictTSV(dictText);
  await pause();
  const index = buildIndex(entries);
  await pause();
  const relatedIndex = buildRelatedIndex(entries);
  await pause();
  const sentences = parseSentencesTSV(sentText);
  return { entries, index, relatedIndex, sentences };
}

// Lazy singleton; a failed download (offline before first cache) resets so a
// later tap retries.
export function loadDict() {
  if (!dataPromise) {
    dataPromise = fetchAndBuild();
    dataPromise.catch(() => { dataPromise = null; });
  }
  return dataPromise;
}

function entryForDisplay(e) {
  return {
    trad: e.trad,
    simp: e.simp,
    pinyin: parsePinyin(e.pinyin), // [{ text, tone }]
    defs: e.defs,
  };
}

// Mirrors handleLookup in extension/background.js (keep the two in step).
export function detailsFromData(data, text, cursorIndex, options = {}) {
  const { entries, index, relatedIndex, sentences } = data;
  const exampleCount = Math.max(0, Math.min(15, options.exampleCount ?? 5));
  const relatedCount = options.relatedCount ?? 3;
  const { groups, highlight } = lookupAt(index, entries, text || '', cursorIndex || 0);
  if (groups.length === 0) return { matches: [] };

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
  const examples = findExamples(
    sentences, top.simp, top.trad, exampleCount, index, entries,
  ).map((s) => ({ zh: s.zh, py: s.py, en: s.en }));

  const chars = charBreakdown(index, groups[0].word).map((c) => ({
    char: c.char,
    entryCount: c.idxs.length,
    entries: rankEntryIndices(c.idxs, entries)
      .slice(0, 3)
      .map((i) => entryForDisplay(entries[i])),
  }));

  const related = findRelated(entries, index, relatedIndex, groups[0].word, relatedCount)
    .map((r) => ({
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

export async function lookupDetails(text, cursorIndex, options) {
  return detailsFromData(await loadDict(), text, cursorIndex, options);
}

export async function examplesFor(simp, trad, count = 1) {
  const { entries, index, sentences } = await loadDict();
  return findExamples(sentences, simp, trad || simp, count, index, entries)
    .map((s) => ({ zh: s.zh, py: s.py, en: s.en }));
}
