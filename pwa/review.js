// Flashcard review view. All real SRS logic comes from the shared lib/srs.js
// (same module the extension runs); this file is just the mobile UI around
// it. Grades persist to IndexedDB immediately and sync at session end.

import {
  GRADES, DEFAULT_LIMITS, schedule, intervalPreview, buildQueue, planSession,
  cardSeed, dueLaterToday, nextDueText,
} from './lib/srs.js';
import { cardKey } from './lib/merge.js';
import { forecastChart, stageBar } from './lib/progress.js';
import * as db from './db.js';
import { speak } from './speech.js';
import { tappableChinese, closeDetails } from './details.js';
import { examplesFor } from './lib/dict.js';

function el(tag, cls, text) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined) node.textContent = text;
  return node;
}

// Saved words carry display pinyin ("shì fǒu") plus the tone list ("4,3")
// captured at save time; entries without tones render uncolored — same rule
// as the extension's review page.
export function pinyinEl(word, cls = 'pinyin') {
  const wrap = el('div', cls);
  const syls = (word.pinyin || '').split(' ');
  const tones = (word.tones || '').split(',').map(Number);
  if (tones.length === syls.length && tones.every((t) => t >= 0 && t <= 5)) {
    syls.forEach((s, i) => {
      wrap.append(el('span', `tone${tones[i]}`, s), ' ');
    });
  } else {
    wrap.textContent = word.pinyin || '';
  }
  return wrap;
}

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

export function renderReview(root, { onSessionEnd, onGrade = () => {} }) {
  let queue = [];
  let sessionAgain = [];
  let current = null;
  let revealed = false;
  let grading = false;
  let cards = [];        // every live card, for the end-of-session panel
  let extraNew = 0;      // pulled forward past today's limit on request
  const seen = new Set(); // card keys graded this session
  let newStarted = 0;

  function advance() {
    current = queue.shift() || sessionAgain.shift() || null;
    revealed = false; // the next card always starts face-down
  }

  async function grade(g) {
    if (!current || !revealed || grading) return;
    grading = true;
    const graded = current;
    if (!graded.srs) newStarted += 1;
    graded.srs = schedule(graded.srs, g, Date.now(), { seed: cardSeed(graded) });
    await db.putDocs([graded]);
    seen.add(cardKey(graded));
    if (g === 'again') sessionAgain.push(graded);
    onGrade();
    advance();
    render();
  }

  function reveal() {
    revealed = true;
    render();
  }

  // A real example sentence under the answer, like the extension's review
  // card. Fills in asynchronously (the dictionary may still be downloading on
  // the very first reveal); the card stays usable either way.
  function appendExample(answer, word) {
    examplesFor(word.simp, word.trad, 1).then(([ex]) => {
      if (!ex || current !== word || !revealed || !answer.isConnected) return;
      const box = el('div', 'example');
      const zh = tappableChinese('div', 'ex-zh', ex.zh);
      const form = ex.zh.includes(word.simp) ? word.simp
        : word.trad && ex.zh.includes(word.trad) ? word.trad : null;
      if (form) {
        const start = Array.from(ex.zh.slice(0, ex.zh.indexOf(form))).length;
        const length = Array.from(form).length;
        let unit = 0;
        for (const node of zh.childNodes) {
          if (node.nodeType === 1 && unit >= start && unit < start + length) {
            node.classList.add('hl');
          }
          unit += 1;
        }
      }
      const speakBtn = el('button', 'speak ex-speak', '🔊');
      speakBtn.addEventListener('click', () => speak(ex.zh));
      zh.append(speakBtn);
      box.append(zh);
      if (ex.py) box.append(el('div', 'ex-py', ex.py));
      box.append(el('div', 'ex-en', ex.en));
      answer.append(box);
    }).catch(() => {});
  }

  // Pull tomorrow's new cards forward when asked. Cards already answered this
  // session stay out: their schedule has moved on.
  async function studyMore(addNew) {
    extraNew += addNew;
    const more = buildQueue(cards, Date.now(), { ...DEFAULT_LIMITS, extraNew })
      .filter((c) => !seen.has(cardKey(c)));
    if (!more.length) return;
    queue = more;
    advance();
    render();
  }

  // The end-of-session panel. "Done for today" is a claim about the schedule,
  // so it says what it means: what was finished, what is deliberately held
  // back, and when the next card arrives.
  function renderSummary() {
    const now = Date.now();
    const plan = planSession(cards, now, { ...DEFAULT_LIMITS, extraNew });
    const finished = seen.size > 0;
    const panel = el('div', 'summary');

    if (!cards.length) {
      panel.append(el('p', 'empty',
        'No cards yet. Save words in the extension while reading — they sync here automatically.'));
      root.append(panel);
      return;
    }

    panel.append(el('div', 'summary-head',
      finished ? 'Done for today ✓' : 'Nothing is due right now'));
    panel.append(el('p', 'summary-sub', finished
      ? 'Every card today’s schedule had for you is reviewed. It stops here on purpose — a card you just saw teaches you almost nothing, so each one waits until you are close to forgetting it.'
      : 'Cards come back on a widening schedule, so an empty queue means everything is still fresh rather than finished.'));

    if (finished) {
      const tiles = el('div', 'tiles');
      const tile = (n, label) => {
        const box = el('div', 'tile');
        box.append(el('div', 'tile-n', String(n)), el('div', 'tile-l', label));
        return box;
      };
      tiles.append(tile(seen.size, seen.size === 1 ? 'card' : 'cards'));
      if (newStarted) tiles.append(tile(newStarted, 'new'));
      panel.append(tiles);
    }

    if (plan.newHeld > 0 && plan.newAllowed <= 0) {
      const row = el('p', 'held-row');
      row.append(`${plural(plan.newHeld, 'new word')} are waiting. Today's limit of ${DEFAULT_LIMITS.newPerDay} new cards is used up — meeting a batch again tomorrow is what makes it stick.`);
      const btn = el('button', 'more-btn', `Start ${Math.min(5, plan.newHeld)} more`);
      btn.addEventListener('click', () => studyMore(Math.min(5, plan.newHeld)));
      row.append(btn);
      panel.append(row);
    }

    const later = dueLaterToday(cards, now);
    const next = el('p', 'next-up');
    if (later) {
      next.append(`${plural(later, 'card')} come back later today — the ones you rated Again or Hard.`);
    } else if (plan.nextDue) {
      next.append('Next card due ', el('b', '', nextDueText(plan.nextDue, now)), '.');
    }
    if (next.childNodes.length) panel.append(next);

    panel.append(forecastChart(cards, now, {
      days: 14, newToday: plan.newSelected.length,
    }));
    panel.append(stageBar(cards));
    root.append(panel);
    if (finished) onSessionEnd();
  }

  function render() {
    grading = false;
    closeDetails(); // never leave a stale definition sheet over a new card
    root.replaceChildren();
    if (!current) {
      renderSummary();
      return;
    }

    const card = el('div', 'card');
    const sentenceCard = current.cardType === 'sentence';
    if (sentenceCard) card.append(el('div', 'card-type', 'Sentence'));
    // Tap-to-define only once the answer is showing, so peeking at a
    // character cannot spoil the card (same rule as the extension).
    const hanziCls = `hanzi${sentenceCard ? ' sentence' : ''}`;
    card.append(revealed
      ? tappableChinese('div', hanziCls, current.simp)
      : el('div', hanziCls, current.simp));
    if (!sentenceCard && current.trad && current.trad !== current.simp) {
      card.append(revealed
        ? tappableChinese('div', 'trad', current.trad)
        : el('div', 'trad', current.trad));
    }

    if (revealed) {
      const answer = el('div', 'answer');
      const line = el('div', 'answer-line');
      line.append(pinyinEl(current));
      const speakBtn = el('button', 'speak', '🔊');
      speakBtn.addEventListener('click', () => speak(current.simp));
      line.append(speakBtn);
      answer.append(line);
      answer.append(el('div', 'defs', current.defs || ''));
      if (!sentenceCard) appendExample(answer, current);
      card.append(answer);

      const controls = el('div', 'controls');
      const labels = { again: 'Again', hard: 'Hard', good: 'Good', easy: 'Easy' };
      for (const g of GRADES) {
        const btn = el('button', `grade g-${g}`);
        btn.append(el('span', '', labels[g]));
        btn.append(el('small', '',
          intervalPreview(current.srs, g, Date.now(), { seed: cardSeed(current) })));
        btn.addEventListener('click', () => grade(g));
        controls.append(btn);
      }
      card.append(controls);
    } else {
      const controls = el('div', 'controls');
      const revealBtn = el('button', 'reveal', 'Show answer');
      revealBtn.addEventListener('click', reveal);
      controls.append(revealBtn);
      card.append(controls);
    }

    root.append(card);
    const left = queue.length + (current ? 1 : 0) + sessionAgain.length;
    const total = seen.size + left;
    const progress = el('div', 'progress');
    const fill = el('i');
    fill.style.width = `${total ? Math.round((seen.size / total) * 100) : 0}%`;
    progress.append(fill);
    root.append(progress);
    root.append(el('div', 'queue-count', `${seen.size} of ${total} · ${left} to go`));
  }

  return {
    async refresh() {
      // Syncs and tab switches repaint mid-session; never rebuild the queue
      // out from under an active card.
      if (current) {
        render();
        return;
      }
      cards = (await db.allDocs()).filter((d) => !d.deleted);
      const fresh = buildQueue(cards, Date.now(), { ...DEFAULT_LIMITS, extraNew })
        .filter((c) => !seen.has(cardKey(c)));
      // Keep the summary up rather than flipping to "nothing to review";
      // only start over when new due cards actually arrived.
      if (seen.size > 0 && fresh.length === 0) {
        render();
        return;
      }
      queue = fresh;
      sessionAgain = [];
      seen.clear();
      newStarted = 0;
      extraNew = 0;
      revealed = false;
      advance();
      render();
    },
  };
}
