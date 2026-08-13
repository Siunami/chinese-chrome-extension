// Builds extension/data/ from the raw downloads in rawdata/.
//
//   rawdata/cedict.txt.gz  (CC-CEDICT, https://www.mdbg.net/chinese/dictionary?page=cedict)
//   rawdata/cmn.txt        (Tatoeba Mandarin-English pairs via manythings.org/anki)
//
// Outputs:
//   extension/data/dict.tsv       trad \t simp \t pinyin \t def/def/def
//   extension/data/sentences.tsv  zh \t pinyin \t en \t attribution   (sorted by zh length)
//
// Usage: node scripts/build-data.mjs

import { gunzipSync } from 'node:zlib';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  parseCedict, entriesToTSV, buildIndex, sentencePinyin, hasChinese,
} from '../extension/lib/cedict.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'extension', 'data');
mkdirSync(outDir, { recursive: true });

// --- Dictionary -----------------------------------------------------------

const cedictText = gunzipSync(readFileSync(join(root, 'rawdata', 'cedict.txt.gz'))).toString('utf8');
const entries = parseCedict(cedictText);
if (entries.length < 100000) {
  throw new Error(`suspiciously few CEDICT entries: ${entries.length}`);
}
writeFileSync(join(outDir, 'dict.tsv'), entriesToTSV(entries));
console.log(`dict.tsv: ${entries.length} entries`);

// --- Example sentences ----------------------------------------------------

const index = buildIndex(entries);
const raw = readFileSync(join(root, 'rawdata', 'cmn.txt'), 'utf8');
const seen = new Set();
const sentences = [];
let skipped = 0;
for (const line of raw.split('\n')) {
  if (!line.trim()) continue;
  const parts = line.split('\t');
  if (parts.length < 2) { skipped++; continue; }
  const en = parts[0].trim();
  const zh = parts[1].trim();
  const attribution = (parts[2] || '').replace(/^CC-BY 2\.0 \(France\) Attribution:\s*/, '').trim();
  if (!zh || !en || !hasChinese(zh)) { skipped++; continue; }
  if (zh.includes('\t') || en.includes('\t')) { skipped++; continue; }
  if (seen.has(zh)) { skipped++; continue; } // keep first English per Chinese sentence
  seen.add(zh);
  sentences.push({ zh, en, attribution });
}
sentences.sort((a, b) => a.zh.length - b.zh.length);

const t0 = Date.now();
const lines = sentences.map((s) =>
  [s.zh, sentencePinyin(index, entries, s.zh), s.en, s.attribution].join('\t'),
);
writeFileSync(join(outDir, 'sentences.tsv'), lines.join('\n'));
console.log(`sentences.tsv: ${sentences.length} sentences (${skipped} skipped, pinyin in ${Date.now() - t0}ms)`);
