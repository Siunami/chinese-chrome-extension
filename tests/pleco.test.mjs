// Reading a Pleco flashcard export (extension/lib/pleco.js). Both export
// shapes, because which one a user has depends on a menu they clicked through
// without reading — and the awkward rows real files contain.
// Run: node tests/pleco.test.mjs

import assert from 'node:assert/strict';
import { parsePlecoExport, splitHeadword, spacePlecoPinyin } from '../extension/lib/pleco.js';

let passed = 0;
const failures = [];
function test(name, fn) {
  try {
    fn();
    passed++;
  } catch (e) {
    failures.push(`${name}\n    ${e.message.split('\n')[0]}`);
  }
}

// --- the pieces ------------------------------------------------------------

test('numbered pinyin is split into syllables', () => {
  assert.equal(spacePlecoPinyin('dian4nao3'), 'dian4 nao3');
  assert.equal(spacePlecoPinyin('ni3hao3ma5'), 'ni3 hao3 ma5');
  // Already spaced, and already tone-marked, both pass through.
  assert.equal(spacePlecoPinyin('dian4 nao3'), 'dian4 nao3');
  assert.equal(spacePlecoPinyin('diàn nǎo'), 'diàn nǎo');
  assert.equal(spacePlecoPinyin(''), '');
});

test('a bracketed headword splits into both scripts', () => {
  assert.deepEqual(splitHeadword('电脑[電腦]'), { simp: '电脑', trad: '電腦' });
  // Full-width brackets are what an export off a Chinese keyboard carries.
  assert.deepEqual(splitHeadword('电脑［電腦］'), { simp: '电脑', trad: '電腦' });
  // No bracket: the two scripts agree, as far as the file says.
  assert.deepEqual(splitHeadword('我'), { simp: '我', trad: '我' });
});

// --- text export -----------------------------------------------------------

const TEXT = `电脑[電腦]\tdian4nao3\tnoun computer
学习[學習]\txue2xi2\tverb to study; to learn
我\two3\tpronoun I; me`;

test('a text export becomes one card per line', () => {
  const { items, format, skipped } = parsePlecoExport(TEXT);
  assert.equal(format, 'text');
  assert.equal(skipped, 0);
  assert.equal(items.length, 3);
  assert.deepEqual(items[0], {
    simp: '电脑', trad: '電腦', pinyin: 'dian4 nao3', defs: 'noun computer',
  });
  assert.equal(items[2].simp, '我');
  assert.equal(items[2].trad, '我');
});

test('a bare word list is still importable', () => {
  // Not every export has pinyin and definitions; the dictionary supplies them.
  const { items } = parsePlecoExport('电脑\n学习\n\n我');
  assert.deepEqual(items.map((i) => i.simp), ['电脑', '学习', '我']);
  assert.equal(items[0].pinyin, '');
  assert.equal(items[0].defs, '');
});

test('rows with no Chinese are skipped, not turned into cards', () => {
  const { items, skipped } = parsePlecoExport(
    '// My cards\nHeadword\tPinyin\tDefinition\n电脑\tdian4nao3\tcomputer\n');
  assert.deepEqual(items.map((i) => i.simp), ['电脑']);
  assert.equal(skipped, 1, 'the English header row should be dropped');
});

test('a definition containing a tab is kept whole', () => {
  const { items } = parsePlecoExport('电脑\tdian4nao3\tnoun computer\tsee also 計算機');
  assert.equal(items[0].defs, 'noun computer see also 計算機');
});

test('the same word twice in one file is one card', () => {
  const { items } = parsePlecoExport('电脑\tdian4nao3\tcomputer\n电脑\tdian4nao3\tcomputer');
  assert.equal(items.length, 1);
});

// --- XML export ------------------------------------------------------------

const XML = `<?xml version="1.0" encoding="UTF-8"?>
<plecoflash formatversion="2" creator="Pleco User" generator="Pleco 3.2">
<cards>
<card language="chinese" created="1700000000">
<entry>
<headword charset="sc">电脑</headword>
<headword charset="tc">電腦</headword>
<pron type="hypy" tones="numbers">dian4nao3</pron>
<defn>noun computer &amp; peripherals</defn>
</entry>
<scoreinfo scorefile="0" score="500"/>
</card>
<card language="chinese">
<entry>
<headword charset="sc">学习</headword>
<headword charset="tc">學習</headword>
<pron type="hypy" tones="numbers">xue2xi2</pron>
<defn>verb to study</defn>
</entry>
</card>
</cards>
</plecoflash>`;

test('an XML export becomes one card per <card>', () => {
  const { items, format, skipped } = parsePlecoExport(XML);
  assert.equal(format, 'xml');
  assert.equal(skipped, 0);
  assert.equal(items.length, 2);
  assert.deepEqual(items[0], {
    simp: '电脑', trad: '電腦', pinyin: 'dian4 nao3', defs: 'noun computer & peripherals',
  });
  assert.equal(items[1].trad, '學習');
});

test('XML scoring and category elements are not mistaken for cards', () => {
  const { items } = parsePlecoExport(XML);
  // Two <card> blocks, and nothing from <scoreinfo> or the file header.
  assert.equal(items.length, 2);
  assert.ok(items.every((i) => !/score|plecoflash/i.test(i.defs)));
});

test('a single headword with no charset attribute still imports', () => {
  const { items } = parsePlecoExport(
    '<cards><card><entry><headword>電腦</headword>'
    + '<pron>dian4nao3</pron><defn>computer</defn></entry></card></cards>');
  assert.equal(items.length, 1);
  assert.equal(items[0].simp, '電腦');
  assert.equal(items[0].trad, '電腦');
});

test('an empty or junk file yields nothing rather than throwing', () => {
  assert.deepEqual(parsePlecoExport('').items, []);
  assert.deepEqual(parsePlecoExport('   \n\n').items, []);
  assert.deepEqual(parsePlecoExport('just some english prose').items, []);
});

if (failures.length) {
  console.error(`\n${failures.length} failing check(s):\n`);
  for (const f of failures) console.error(`  ✗ ${f}\n`);
  process.exit(1);
}
console.log(`pleco.test.mjs: ${passed} tests passed`);
