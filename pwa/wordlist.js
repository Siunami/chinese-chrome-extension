// Browsable word list: search, per-card status, delete (tombstoned so the
// deletion syncs to the extension too).

import { DAY_MS, srsStatus, cardStage, formatDelay } from './lib/srs.js';
import { STAGE_LABELS, STAGE_NOTES, stageBar, strengthMeter } from './lib/progress.js';
import { tombstoneFor } from './lib/merge.js';
import * as db from './db.js';
import { pinyinEl } from './review.js';
import { openDetailsAt } from './details.js';

function el(tag, cls, text) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined) node.textContent = text;
  return node;
}

export function renderWords(root, { requestSync }) {
  let all = [];
  let query = '';

  function matches(card) {
    if (!query) return true;
    const q = query.toLowerCase();
    return card.simp.includes(query) || (card.trad || '').includes(query) ||
      (card.pinyin || '').toLowerCase().includes(q) ||
      (card.defs || '').toLowerCase().includes(q);
  }

  function render() {
    root.replaceChildren();
    const search = el('input', 'search');
    search.type = 'search';
    search.placeholder = 'Search hanzi, pinyin, or definition';
    search.value = query;
    search.addEventListener('input', () => {
      query = search.value.trim();
      renderList();
    });
    root.append(search);
    root.append(el('div', 'curve'));
    root.append(el('div', 'word-list'));
    renderList();
  }

  function renderList() {
    const listEl = root.querySelector('.word-list');
    listEl.replaceChildren();
    const curveEl = root.querySelector('.curve');
    curveEl.replaceChildren();
    if (all.length) curveEl.append(stageBar(all));
    const now = Date.now();
    const shown = all.filter(matches);
    listEl.append(el('p', 'count',
      `${shown.length} card${shown.length === 1 ? '' : 's'}${query ? ` matching “${query}”` : ''}`));
    if (shown.length === 0 && !query) {
      listEl.append(el('p', 'empty',
        'No cards yet. Save words in the extension — they sync here automatically.'));
      return;
    }
    for (const card of shown) {
      const row = el('div', 'word-row');
      const main = el('div', 'word-main');
      const head = el('div', 'word-head');
      head.append(el('span', 'hanzi', card.simp));
      if (card.trad && card.trad !== card.simp) {
        head.append(el('span', 'trad', card.trad));
      }
      head.append(pinyinEl(card, 'pinyin'));
      main.append(head);
      main.append(el('div', 'word-defs', card.defs || ''));
      main.classList.add('tappable');
      main.addEventListener('click', () => openDetailsAt(card.simp, 0));
      row.append(main);

      const side = el('div', 'word-side');
      const status = srsStatus(card, now);
      side.append(el('span',
        `status ${status === 'new' ? 'st-new' : status.startsWith('due') ? 'st-due' : 'st-later'}`,
        status));
      // Where this one card sits on the curve: a strength meter plus the
      // interval it has reached.
      const curve = el('div', 'word-curve');
      curve.append(strengthMeter(card));
      const stage = cardStage(card);
      curve.title = `${STAGE_LABELS[stage]} — ${STAGE_NOTES[stage]}`;
      curve.append(el('span', 'word-ivl', card.srs && card.srs.ivl >= 1
        ? formatDelay(card.srs.ivl * DAY_MS)
        : STAGE_LABELS[stage].toLowerCase()));
      side.append(curve);
      const del = el('button', 'del', '✕');
      del.addEventListener('click', async () => {
        if (!confirm(`Delete ${card.simp}? This removes it everywhere on next sync.`)) return;
        await db.putDocs([tombstoneFor(card, Date.now())]);
        all = all.filter((c) => c !== card);
        renderList();
        requestSync();
      });
      side.append(del);
      row.append(side);
      listEl.append(row);
    }
  }

  return {
    async refresh() {
      all = (await db.allDocs()).filter((d) => !d.deleted);
      render();
    },
  };
}
