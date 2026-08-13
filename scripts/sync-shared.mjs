// Copies the modules the PWA shares verbatim with the extension from their
// canonical home in extension/lib/ into pwa/lib/ (the Worker can bundle
// across directories, but static assets can only serve files under pwa/).
// Run after editing any of them; tests/merge.test.mjs
// fails if the copies drift.
//
// Also copies the dictionary + example-sentence data into pwa/data/ so the
// PWA's tap-to-define sheet can fetch them as static assets. pwa/data/ is
// gitignored (generated); run this before `wrangler deploy`.

import { copyFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dest = join(root, 'pwa', 'lib');
mkdirSync(dest, { recursive: true });

for (const name of ['srs.js', 'merge.js', 'cedict.js', 'progress.js']) {
  copyFileSync(join(root, 'extension', 'lib', name), join(dest, name));
  console.log(`pwa/lib/${name}`);
}

const dataDest = join(root, 'pwa', 'data');
mkdirSync(dataDest, { recursive: true });
for (const name of ['dict.tsv', 'sentences.tsv']) {
  copyFileSync(join(root, 'extension', 'data', name), join(dataDest, name));
  console.log(`pwa/data/${name}`);
}
