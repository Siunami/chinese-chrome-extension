import assert from 'node:assert/strict';
import { stripTone, gradePronunciation } from '../extension/lib/pronounce.js';

// Tone diacritics and ü/v folding are stripped down to the base sound.
assert.equal(stripTone('xǐ'), 'xi');
assert.equal(stripTone('lǜ'), 'lu');
assert.equal(stripTone('lv3'.replace(/[0-9]/g, '')), 'lu'); // v spelling of ü
assert.equal(stripTone('HUÁN'), 'huan');
assert.equal(stripTone(''), ''); // empty syllables (punctuation) fold to nothing

const expected = [
  { char: '喜', syllable: 'xǐ', tone: 3 },
  { char: '欢', syllable: 'huān', tone: 1 },
  { char: '你', syllable: 'nǐ', tone: 3 },
];

// Perfect read: every syllable green.
{
  const { statuses, summary } = gradePronunciation(expected, [
    { syllable: 'xǐ', tone: 3 }, { syllable: 'huān', tone: 1 }, { syllable: 'nǐ', tone: 3 },
  ]);
  assert.deepEqual(statuses, ['good', 'good', 'good']);
  assert.deepEqual(summary, { good: 3, tone: 0, miss: 0, total: 3 });
}

// Homophone with the right tone still counts as good (是/事 both shì); a wrong
// tone on the same base sound is 'tone', a dropped syllable is 'miss'.
{
  const { statuses, summary } = gradePronunciation(expected, [
    { syllable: 'xī', tone: 1 }, // right sound, wrong tone
    { syllable: 'huān', tone: 1 }, // right
    // 你 omitted
  ]);
  assert.deepEqual(statuses, ['tone', 'good', 'miss']);
  assert.deepEqual(summary, { good: 1, tone: 1, miss: 1, total: 3 });
}

// Punctuation and unreadable chars carry no syllable and are excluded from the
// graded total; indexStatus keys the original positions for coloring.
{
  const withPunct = [
    { char: '你', syllable: 'nǐ', tone: 3 },
    { char: '好', syllable: 'hǎo', tone: 3 },
    { char: '！', syllable: '', tone: 0 },
  ];
  const { indexStatus, summary } = gradePronunciation(withPunct, [
    { syllable: 'nǐ', tone: 3 }, { syllable: 'hǎo', tone: 3 },
  ]);
  assert.equal(summary.total, 2);
  assert.equal(indexStatus.get(0), 'good');
  assert.equal(indexStatus.get(1), 'good');
  assert.equal(indexStatus.has(2), false); // punctuation not graded
}

// Extra syllables the recognizer inserted don't break alignment of the rest.
{
  const { statuses } = gradePronunciation(expected, [
    { syllable: 'xǐ', tone: 3 }, { syllable: 'de', tone: 5 },
    { syllable: 'huān', tone: 1 }, { syllable: 'nǐ', tone: 3 },
  ]);
  assert.deepEqual(statuses, ['good', 'good', 'good']);
}

console.log('OK — pronunciation grading tests passed');
