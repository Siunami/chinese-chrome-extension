// Unit tests for extension/lib/cards.js — the one place that decides whether a
// piece of Chinese may become a flashcard, and which card it becomes.
// Run: node tests/cards.test.mjs

import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { HSK_GUIDES } from '../extension/guides/index.js';
import { parseDictTSV, buildIndex } from '../extension/lib/cedict.js';
import { cardKey } from '../extension/lib/merge.js';
import {
  MAX_CARD_CHARS, splitSentences, cardTextIssue, glossFor, resolveCard, isMachineGloss,
} from '../extension/lib/cards.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
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

// --- splitting ------------------------------------------------------------

test('a paragraph splits into sentences, each keeping its terminator', () => {
  assert.deepEqual(
    splitSentences('我是学生。他是老师！你呢？'),
    ['我是学生。', '他是老师！', '你呢？'],
  );
});

test('a run of terminators and its closing quote stay with the sentence', () => {
  assert.deepEqual(splitSentences('他说「我不去。」然后走了。'),
    ['他说「我不去。」', '然后走了。']);
  assert.deepEqual(splitSentences('真的吗……我不信。'), ['真的吗……', '我不信。']);
});

test('text with no terminator is one sentence, and empties are dropped', () => {
  assert.deepEqual(splitSentences('今天天气很好'), ['今天天气很好']);
  assert.deepEqual(splitSentences('。。。'), ['。。。']);
  assert.deepEqual(splitSentences('   '), []);
});

// --- what may become a card ----------------------------------------------

test('a word, a phrase and one sentence are all card-sized', () => {
  assert.equal(cardTextIssue('老师'), null);
  assert.equal(cardTextIssue('喜欢吃米饭'), null);
  assert.equal(cardTextIssue('今天是星期六，天气很热。'), null);
});

test('a paragraph is refused, and says why', () => {
  assert.equal(cardTextIssue('我是学生。他是老师。'), 'multi-sentence');
  assert.equal(cardTextIssue('中'.repeat(MAX_CARD_CHARS + 1)), 'too-long');
  assert.equal(cardTextIssue('中'.repeat(MAX_CARD_CHARS)), null);
});

test('text with no Chinese in it is not a card', () => {
  assert.equal(cardTextIssue('hello there'), 'no-chinese');
  assert.equal(cardTextIssue('   '), 'empty');
  assert.equal(cardTextIssue(null), 'empty');
});

// --- resolution against the real dictionary -------------------------------

const dictPath = join(root, 'extension', 'data', 'dict.tsv');
if (!existsSync(dictPath)) {
  console.log('cards.test.mjs: dict.tsv missing — run scripts/build-data.mjs');
  console.log(`cards.test.mjs: ${passed} tests passed (dictionary tests skipped)`);
  process.exit(0);
}
const entries = parseDictTSV(readFileSync(dictPath, 'utf8'));
const index = buildIndex(entries);
const resolve = (text, en, unit) => resolveCard({ map: index, entries, text, en, unit });

test('a bare headword becomes a word card with dictionary pinyin and senses', () => {
  const { card } = resolve('老师');
  assert.equal(card.cardType, 'word');
  assert.equal(card.simp, '老师');
  assert.equal(card.trad, '老師');
  assert.equal(card.pinyin, 'lǎo shī');
  assert.equal(card.tones, '3,1');
  assert.match(card.defs, /teacher/);
});

test('punctuation stuck to a highlighted word does not hide the word', () => {
  assert.equal(resolve('，老师。').card.simp, '老师');
  assert.equal(resolve('你好。').card.cardType, 'word');
});

// The whole reason a word card is built from the dictionary rather than from
// whatever English the caller had: the same word saved from an HSK vocabulary
// list and from the hover popup has to be one card, not two.
test('a word card matches the key the popup would have saved', () => {
  const { card } = resolve('朋友', 'friend');
  const popupCard = { simp: '朋友', trad: '朋友', pinyin: 'péng you' };
  assert.equal(cardKey(card), cardKey(popupCard));
  assert.doesNotMatch(card.defs, /^friend$/, 'the guide gloss must not replace the dictionary');
});

test('a sentence becomes a sentence card with generated pinyin', () => {
  const { card } = resolve('我是学生。', 'I am a student.');
  assert.equal(card.cardType, 'sentence');
  assert.equal(card.simp, '我是学生。');
  assert.equal(card.trad, card.simp);
  assert.equal(card.pinyin, 'wǒ shì xuésheng。');
  assert.equal(card.defs, 'I am a student.');
});

test('an untranslated phrase still gets a back: a word-by-word gloss', () => {
  const { card } = resolve('今天天气很热');
  assert.equal(card.cardType, 'sentence');
  assert.match(card.defs, /今天 today/);
  assert.match(card.defs, /天气 weather/);
  assert.ok(card.defs.includes(' · '), 'gloss joins its words');
});

test('the gloss drops repeats and trailing CC-CEDICT usage notes', () => {
  const gloss = glossFor(index, entries, '我的书和我的笔');
  assert.equal(gloss.match(/我 /g).length, 1, '我 appears once');
  // "to be (followed by substantives only)" is a note about the sense, not
  // the sense; a gloss wants the sense.
  assert.equal(glossFor(index, entries, '是'), '是 to be');
});

// A guide's example is sometimes two sentences because that is what the
// pattern needs, and it comes with a translation written for both. Curated
// text is one item; a highlight has to earn it.
test('curated text may be more than one sentence, a highlight may not', () => {
  const both = '城市人口不断增加。与此同时，交通的压力也在加大。';
  assert.equal(resolve(both).issue, 'multi-sentence');
  assert.equal(resolve(both, 'The city grows.', true).card.simp, both);
  // The length backstop still applies to curated text.
  assert.equal(resolve('中'.repeat(MAX_CARD_CHARS + 1), 'x', true).issue, 'too-long');
});

test('a refusal comes back as a reason, not a broken card', () => {
  assert.deepEqual(resolve('我是学生。他是老师。'), { issue: 'multi-sentence' });
  assert.deepEqual(resolve('nothing chinese here'), { issue: 'no-chinese' });
});

// Every sentence of every bundled reading passage has to be savable — that is
// the promise the star beside it makes.
test('every HSK passage sentence resolves to a card', () => {
  let checked = 0;
  for (const guide of HSK_GUIDES) {
    for (const para of guide.passage.text.split(/\n{2,}/)) {
      for (const sentence of splitSentences(para.trim())) {
        const out = resolve(sentence);
        assert.ok(out.card, `HSK ${guide.level}: "${sentence}" -> ${out.issue}`);
        assert.ok(out.card.pinyin, `HSK ${guide.level}: "${sentence}" has no reading`);
        assert.ok(out.card.defs, `HSK ${guide.level}: "${sentence}" has no back`);
        checked++;
      }
    }
  }
  assert.ok(checked > 50, `expected many passage sentences, checked ${checked}`);
});

// Same promise for the stars on grammar examples and vocabulary items.
test('every HSK grammar example and vocabulary word resolves to a card', () => {
  for (const guide of HSK_GUIDES) {
    for (const point of guide.grammar) {
      for (const ex of point.examples) {
        const out = resolve(ex.zh, ex.en, true);
        assert.ok(out.card, `HSK ${guide.level}: "${ex.zh}" -> ${out.issue}`);
        // A sentence card carries the guide's own translation. An example that
        // happens to *be* a headword (an idiom quoted whole) becomes that
        // dictionary entry instead, which is the same card the popup saves.
        if (out.card.cardType === 'sentence') {
          assert.equal(out.card.defs, ex.en.replace(/\s+/g, ' ').trim());
        }
      }
    }
    for (const group of guide.vocab) {
      for (const w of group.words) {
        const out = resolve(w.zh, w.en);
        assert.ok(out.card, `HSK ${guide.level}: "${w.zh}" -> ${out.issue}`);
        assert.equal(out.card.cardType, 'word',
          `HSK ${guide.level}: "${w.zh}" is in the guide but not the dictionary`);
      }
    }
  }
});

// A sentence with no translation falls back to a word-by-word gloss, which
// says what the words are and not what the sentence means. It has to be
// recognisable as such, or the service worker cannot know to upgrade it.
test('a glossed sentence card is marked for translation', () => {
  const { card } = resolveCard({ map: index, entries, text: '看了两次电影。' });
  assert.equal(card.cardType, 'sentence');
  assert.equal(card.glossed, true, 'the fallback gloss was not marked');
  assert.ok(card.defs.includes('·'), 'expected a word-by-word gloss');
  assert.equal(isMachineGloss(index, entries, card), true);
});

test('a card that came with a translation is left alone', () => {
  const { card } = resolveCard({
    map: index, entries, text: '看了两次电影。', en: 'I watched the movie twice.',
  });
  assert.equal(card.defs, 'I watched the movie twice.');
  assert.equal(card.glossed, undefined, 'a real translation must not be marked glossed');
  assert.equal(isMachineGloss(index, entries, card), false);
});

// Cards saved before the marker existed still have to be recognised, which
// works because the gloss is deterministic: recompute it and compare.
test('an unmarked card is recognised by recomputing its gloss', () => {
  const { card } = resolveCard({ map: index, entries, text: '看了两次电影。' });
  const legacy = { ...card };
  delete legacy.glossed;
  assert.equal(isMachineGloss(index, entries, legacy), true);
  assert.equal(
    isMachineGloss(index, entries, { ...legacy, defs: 'I watched the movie twice.' }), false);
});

test('word cards and deleted cards are never translated', () => {
  const word = resolveCard({ map: index, entries, text: '老师' }).card;
  assert.equal(word.cardType, 'word');
  assert.equal(isMachineGloss(index, entries, word), false);
  const { card } = resolveCard({ map: index, entries, text: '看了两次电影。' });
  assert.equal(isMachineGloss(index, entries, { ...card, deleted: true }), false);
});

// The back is rewritten in place, so the card must keep its identity or the
// translation would arrive as a second copy of the same sentence.
test('translating a card does not change its key', () => {
  const { card } = resolveCard({ map: index, entries, text: '看了两次电影。' });
  const translated = { ...card, defs: 'I watched the movie twice.', glossed: false };
  assert.equal(cardKey(translated), cardKey(card));
});

console.log(`cards.test.mjs: ${passed} tests passed`);
