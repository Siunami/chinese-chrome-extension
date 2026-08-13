// HSK study guides, one per level (HSK 3.0 / 国际中文教育中文水平等级标准, 2021).
//
// The guides are hand-authored English study material wrapped around real
// Chinese. Deliberately NO pinyin is stored here: every Chinese string is
// annotated at display time by the service worker's `sentencePinyin`, the same
// function that annotates the bundled Tatoeba corpus. That keeps one source of
// truth for readings and makes it impossible for the guide text and the hover
// popup to disagree.
//
// Shape of one guide (validated by tests/hsk.test.mjs):
//
//   {
//     level: 1..9,
//     band: 'Beginner' | 'Intermediate' | 'Advanced',
//     name: 'HSK 1',                     // short display label
//     tagline: string,                   // one line, English, <= 90 chars
//     stats: {
//       newWords, totalWords,            // cumulative counts from the standard
//       newChars, totalChars,
//       grammarPoints,                   // new grammar points at this level
//       studyHours,                      // string, e.g. '150-200 hours'
//     },
//     overview: string,                  // 2-4 English sentences
//     canDo: [string],                   // 4-6 English can-do statements
//     grammar: [{
//       point: string,                   // English name of the pattern
//       formula: string,                 // e.g. '主语 + 是 + 名词'
//       explain: string,                 // 1-3 English sentences
//       examples: [{ zh, en }],          // 2-3, zh is Simplified Chinese
//     }],
//     vocab: [{ theme: string, words: [{ zh, en }] }],
//     passage: { title, text, en },      // text: Simplified Chinese, \n\n paragraphs
//     pitfalls: [{ title, detail }],     // 3-4 common mistakes, English
//     tips: [string],                    // 3-5 English study tips
//     exam: { format: string, tips: string },
//   }

import { LEVELS_1_3 } from './hsk-1-3.js';
import { LEVELS_4_6 } from './hsk-4-6.js';
import { LEVELS_7_9 } from './hsk-7-9.js';

export const HSK_GUIDES = [...LEVELS_1_3, ...LEVELS_4_6, ...LEVELS_7_9]
  .sort((a, b) => a.level - b.level);

// HSK 3.0 groups the nine levels into three stages. Levels 7-9 share one
// syllabus and one exam, so they are described as a band even though each
// level gets its own guide here.
export const BANDS = [
  { name: 'Beginner', label: '初等', levels: [1, 2, 3] },
  { name: 'Intermediate', label: '中等', levels: [4, 5, 6] },
  { name: 'Advanced', label: '高等', levels: [7, 8, 9], note: 'examined as a single HSK 7-9 test' },
];

export function guideByLevel(level) {
  return HSK_GUIDES.find((g) => g.level === Number(level)) || null;
}

// Every Chinese string in a guide, in reading order. Used to batch-request
// pinyin from the service worker in one message instead of one per element.
export function chineseStrings(guide) {
  const out = [guide.passage.title, ...guide.passage.text.split(/\n{2,}/).map((p) => p.trim())];
  for (const g of guide.grammar) for (const ex of g.examples) out.push(ex.zh);
  for (const group of guide.vocab) for (const w of group.words) out.push(w.zh);
  return out.filter(Boolean);
}
