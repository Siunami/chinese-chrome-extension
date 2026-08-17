// Build extension/data/hsk.tsv from Ivan Krasilnikov's transcription of the
// official 2021 HSK 3.0 vocabulary appendix, enriching it with the copy of
// CC-CEDICT already bundled by this project.
//
// Download the source CSV, then run:
//   node scripts/build-hsk.mjs rawdata/hsk30.csv
//
// Source: https://github.com/ivankra/hsk30 (MIT; see data/LICENSE.md)

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildIndex, parseDictTSV, parsePinyin, pinyinToDisplay, rankEntryIndices,
} from '../extension/lib/cedict.js';
import { glossFor } from '../extension/lib/cards.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const sourcePath = resolve(process.argv[2] || join(root, 'rawdata', 'hsk30.csv'));
const outputPath = join(root, 'extension', 'data', 'hsk.tsv');

// Productive phrases and complements that the standard treats as vocabulary
// items but CC-CEDICT only has as separate component words. A segmented gloss
// is a useful last resort for an unknown phrase; for these known 28 it would be
// actively misleading (眼里 is "in one's eyes", not "eye · lining").
const FALLBACK_DEFS = {
  车上: 'in or on a vehicle',
  不太: 'not very; not too',
  不一会儿: 'in a little while; before long',
  见过: 'to have seen; to have met (experiential)',
  送到: 'to deliver or take to; to send as far as',
  这时候: 'at this time; at this moment',
  放到: 'to put or place at, in, or on',
  能不能: 'can or cannot; whether one can',
  眼里: "in one's eyes; in one's view",
  有劲儿: 'strong; energetic; interesting',
  城里: 'in town; in the city',
  很难说: 'hard to say',
  一番: 'one round or spell; an amount of effort',
  指着: 'to point at; to point to',
  不利于: 'to be unfavorable or detrimental to',
  不肯: 'to refuse to; to be unwilling to',
  不难: 'not difficult',
  不如说: 'rather; it would be better to say',
  不予: 'not to grant; to withhold',
  趁着: 'to take advantage of a time or opportunity',
  定为: 'to designate or set as',
  飞往: 'to fly to; bound for by air',
  公益性: 'public-benefit nature; public-interest character',
  怀着: 'to harbor or carry (a feeling)',
  难以想象: 'hard to imagine',
  说起来: 'speaking of it; when it comes to',
  致力于: 'to devote oneself to',
  着眼于: 'to focus on; to have in view',
};

// Enough CSV for the source file, including quoted JSON with doubled quotes.
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"') quoted = true;
    else if (char === ',') { row.push(field); field = ''; }
    else if (char === '\n') {
      row.push(field.replace(/\r$/, ''));
      rows.push(row);
      row = [];
      field = '';
    } else field += char;
  }
  if (field || row.length) { row.push(field.replace(/\r$/, '')); rows.push(row); }
  const header = rows.shift();
  return rows.filter((values) => values.some(Boolean)).map((values) =>
    Object.fromEntries(header.map((key, i) => [key, values[i] || ''])));
}

function cedictRef(text) {
  const match = /^([^|]+)\|([^[]+)\[([^\]]+)]$/.exec(String(text || '').trim());
  return match ? { trad: match[1], simp: match[2], pinyin: match[3].trim() } : null;
}

const samePinyin = (a, b) => String(a || '').replace(/\s+/g, '').toLowerCase()
  === String(b || '').replace(/\s+/g, '').toLowerCase();

function cleanField(value) {
  return String(value ?? '').replace(/[\t\r\n]+/g, ' ').replace(/\s+/g, ' ').trim();
}

const source = parseCsv(readFileSync(sourcePath, 'utf8').replace(/^\uFEFF/, ''));
const entries = parseDictTSV(readFileSync(join(root, 'extension', 'data', 'dict.tsv'), 'utf8'));
const index = buildIndex(entries);

const header = [
  'id', 'level', 'simp', 'trad', 'pinyin', 'tones', 'pos',
  'notationSimp', 'notationTrad', 'defs',
];
const lines = [header.join('\t')];
let exactMatches = 0;
let fallbacks = 0;

for (const row of source) {
  let variants = [];
  try { variants = row.Variants ? JSON.parse(row.Variants) : []; } catch { variants = []; }
  const first = variants[0] || null;
  const ref = cedictRef(first?.CEDICT) || cedictRef(row.CEDICT);
  const simp = cleanField(first?.Simplified || ref?.simp
    || row.Simplified.split('|')[0].replace(/\d+$/, ''));
  const trad = cleanField(first?.Traditional || ref?.trad
    || row.Traditional.split('|')[0].replace(/\d+$/, '')) || simp;

  const candidateIds = index.get(simp) || [];
  const best = (ids) => ids.length ? entries[rankEntryIndices(ids, entries)[0]] : null;
  let match = ref && best(candidateIds.filter((i) => {
    const entry = entries[i];
    return entry.simp === ref.simp && entry.trad === ref.trad
      && samePinyin(entry.pinyin, ref.pinyin);
  }));
  if (!match && ref) {
    match = best(candidateIds.filter((i) => {
      const entry = entries[i];
      return entry.simp === ref.simp && entry.trad === ref.trad;
    }));
  }
  if (!match) match = best(candidateIds);

  let pinyin;
  let tones;
  let defs;
  if (match) {
    exactMatches++;
    const syllables = parsePinyin(match.pinyin);
    pinyin = pinyinToDisplay(match.pinyin);
    tones = syllables.map((syllable) => syllable.tone).join(',');
    defs = match.defs.join('; ');
  } else {
    fallbacks++;
    pinyin = cleanField(first?.Pinyin || row.Pinyin).replace(/\|.*/, '');
    tones = '';
    defs = FALLBACK_DEFS[simp] || glossFor(index, entries, simp) || 'HSK vocabulary item';
  }

  lines.push([
    row.ID,
    row.Level,
    simp,
    trad,
    pinyin,
    tones,
    row.POS,
    row.Simplified,
    row.Traditional,
    defs,
  ].map(cleanField).join('\t'));
}

const expected = { 1: 500, 2: 772, 3: 973, 4: 1000, 5: 1071, 6: 1140, '7-9': 5636 };
const counts = Object.fromEntries(Object.keys(expected).map((level) => [
  level, source.filter((word) => word.Level === level).length,
]));
if (source.length !== 11092 || JSON.stringify(counts) !== JSON.stringify(expected)) {
  throw new Error(`Unexpected HSK source counts: ${JSON.stringify(counts)}`);
}
if (lines.some((line, i) => i > 0 && line.split('\t').length !== header.length)) {
  throw new Error('A generated field contains a tab');
}

writeFileSync(outputPath, `${lines.join('\n')}\n`);
console.log(`hsk.tsv: ${source.length} entries (${exactMatches} dictionary entries, ${fallbacks} fallback definitions)`);
