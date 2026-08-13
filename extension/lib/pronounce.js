// Pronunciation self-test grading (pure, no DOM). Compares the syllables a
// speech recognizer heard against the syllables the flashcard expects and
// reports, per expected syllable, whether the sound and tone matched.
//
// Grading is by *pinyin*, not by hanzi: Chinese is full of homophones, so a
// recognizer that transcribes 事 when you correctly said 是 (both shì) should
// still count the pronunciation as right. Tones are graded separately so a
// right sound with the wrong tone is distinguishable from a plain miss.

// "xǐ", "lǜ", "ǚ" -> "xi", "lu", "u": drop tone diacritics (via NFD) so two
// readings can be compared on their base sound alone. ü/v both fold to u.
export function stripTone(syllable) {
  return String(syllable || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[üv]/g, 'u')
    .trim();
}

// Keep only entries that carry an actual voiced syllable (drops punctuation
// and any characters the segmenter could not read), tagging each with its
// base sound and original index in the caller's list.
function voiced(items) {
  const out = [];
  items.forEach((item, index) => {
    const base = stripTone(item.syllable);
    if (base) out.push({ base, tone: item.tone || 0, index });
  });
  return out;
}

// Longest common subsequence over base sounds, returned as matched
// (expected-position, heard-position) pairs in order. This tolerates missed
// syllables (a gap on the expected side) and extra/duplicated syllables the
// recognizer inserted (a gap on the heard side).
function alignBySound(expected, heard) {
  const n = expected.length;
  const m = heard.length;
  const dp = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = expected[i].base === heard[j].base
        ? dp[i + 1][j + 1] + 1
        : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const pairs = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (expected[i].base === heard[j].base) {
      pairs.push([i, j]);
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      i++;
    } else {
      j++;
    }
  }
  return pairs;
}

// Grades expected against heard. Both are arrays of { syllable, tone }
// (extra fields ignored). Returns:
//   statuses  — one entry per *voiced* expected syllable, in order:
//               'good' (sound + tone), 'tone' (sound only), or 'miss'.
//   indexStatus — Map from the caller's expected index to that status, so the
//               caller can color the original hanzi/punctuation list.
//   summary   — { good, tone, miss, total } counts over voiced syllables.
export function gradePronunciation(expected, heard) {
  const exp = voiced(expected);
  const herd = voiced(heard);
  const pairs = alignBySound(exp, herd);
  const matchedTone = new Map(); // expected voiced-position -> heard tone
  for (const [ei, hj] of pairs) matchedTone.set(ei, herd[hj].tone);

  const statuses = [];
  const indexStatus = new Map();
  const summary = { good: 0, tone: 0, miss: 0, total: exp.length };
  exp.forEach((item, pos) => {
    let status;
    if (!matchedTone.has(pos)) {
      status = 'miss';
    } else if (matchedTone.get(pos) === item.tone) {
      status = 'good';
    } else {
      status = 'tone';
    }
    statuses.push(status);
    indexStatus.set(item.index, status);
    summary[status]++;
  });
  return { statuses, indexStatus, summary };
}
