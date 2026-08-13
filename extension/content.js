// Zhongwen Explorer content script: finds the Chinese character under the
// cursor on an arbitrary web page and hands it to the universal popup
// (lib/popup.js, loaded ahead of this file in the same isolated world).
//
// Everything page-specific lives here — caret hit-testing, collecting the run
// of text around the cursor across inline elements, and painting the matched
// phrase with the CSS Custom Highlight API. The popup itself, and every
// interaction inside it, is shared with the extension's own pages.

(() => {
  'use strict';

  const MAX_CHARS = 20;      // forward window; keep >= MAX_WORD_LEN in lib/cedict.js
  const MAX_BACK_CHARS = 19; // backward window: a containing word can start at
                             // most MAX_WORD_LEN-1 code points before the cursor
  const { CJK_RE, createPopup } = globalThis.ZhongwenPopup;
  const { createSelectionBar } = globalThis.ZhongwenSaveCard;
  const HIGHLIGHT_NAME = 'zwe-word';

  const popup = createPopup();

  let enabled = true;
  let lastHit = null;  // { node, offset } last processed caret position
  let moveTimer = null;
  let pendingEvent = null;

  // Hovering saves the word the popup looked up; highlighting saves whatever
  // you point at. Any phrase or single sentence on any page can become a card
  // this way — the same control the study guides put beside their own
  // sentences, for text nobody wrote for a learner.
  const selectionBar = createSelectionBar({ popup, getEnabled: () => enabled });

  chrome.storage.local.get('enabled').then(({ enabled: e = true }) => { enabled = e; });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.enabled) {
      enabled = changes.enabled.newValue !== false;
      if (!enabled) {
        popup.hide();
        selectionBar.hide();
      }
    }
  });

  // -------------------------------------------------------------------------
  // Text extraction at a point
  // -------------------------------------------------------------------------

  const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'RT', 'RP', 'TEXTAREA', 'SELECT']);

  function isSkipped(node) {
    for (let el = node.parentElement; el; el = el.parentElement) {
      if (SKIP_TAGS.has(el.tagName)) return true;
    }
    return false;
  }

  function blockAncestor(node) {
    let el = node.parentElement;
    let last = el;
    while (el && el !== document.body && el !== document.documentElement) {
      const d = getComputedStyle(el).display;
      if (d !== 'inline' && d !== 'inline-block' && d !== 'ruby' && d !== 'contents') {
        return el;
      }
      last = el;
      el = el.parentElement;
    }
    return el || last;
  }

  function makeTextWalker(root) {
    return document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: (n) =>
        isSkipped(n) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT,
    });
  }

  // A neighboring text node belongs to the same visual run only if its
  // nearest block ancestor is the hit node's block. This catches both entering
  // a nested block (他说<p>…) and leaving one (<p>甲</p>乙).
  function sameBlock(root, textNode) {
    return blockAncestor(textNode) === root;
  }

  // Collects a window of code points around (node, offset): up to
  // MAX_BACK_CHARS Chinese chars backward (a containing word may start before
  // the cursor) and MAX_CHARS forward, never crossing a block boundary.
  // Returns { text, points: [{node, start, end}], cursorIndex } aligned per
  // code point, where points[cursorIndex] is the hovered character.
  function collectAround(node, offset) {
    const root = blockAncestor(node);
    if (!root) return null;

    // forward, including the hovered char
    const fwd = [];
    {
      const walker = makeTextWalker(root);
      walker.currentNode = node;
      let cur = node;
      let pos = offset;
      while (cur && fwd.length < MAX_CHARS) {
        const data = cur.nodeValue || '';
        while (pos < data.length && fwd.length < MAX_CHARS) {
          let end = pos + 1;
          const code = data.charCodeAt(pos);
          if (code >= 0xd800 && code <= 0xdbff && end < data.length) end = pos + 2;
          fwd.push({ node: cur, start: pos, end });
          pos = end;
        }
        cur = walker.nextNode();
        if (cur && !sameBlock(root, cur)) cur = null;
        pos = 0;
      }
    }
    if (fwd.length === 0) return null;

    // backward: only contiguous Chinese chars matter for word chunking
    const back = [];
    {
      const walker = makeTextWalker(root);
      walker.currentNode = node;
      let cur = node;
      let pos = offset;
      outer: while (cur && back.length < MAX_BACK_CHARS) {
        const data = cur.nodeValue || '';
        while (pos > 0 && back.length < MAX_BACK_CHARS) {
          let start = pos - 1;
          const code = data.charCodeAt(start);
          if (code >= 0xdc00 && code <= 0xdfff && start > 0) start = pos - 2;
          if (!CJK_RE.test(data.slice(start, pos))) break outer;
          back.push({ node: cur, start, end: pos });
          pos = start;
        }
        const prev = walker.previousNode();
        if (!prev || !sameBlock(root, prev)) break;
        cur = prev;
        pos = (cur.nodeValue || '').length;
      }
      back.reverse();
    }

    const points = back.concat(fwd);
    let text = '';
    for (const p of points) text += (p.node.nodeValue || '').slice(p.start, p.end);
    return { text, points, cursorIndex: back.length };
  }

  function charRect(point) {
    const r = document.createRange();
    try {
      r.setStart(point.node, point.start);
      r.setEnd(point.node, point.end);
    } catch {
      return null;
    }
    return r.getBoundingClientRect();
  }

  function rectContains(rect, x, y, slack) {
    return (
      rect &&
      rect.width > 0 &&
      x >= rect.left - slack && x <= rect.right + slack &&
      y >= rect.top - slack && y <= rect.bottom + slack
    );
  }

  // Resolves the exact code point under (x, y), compensating for caret
  // rounding (a point over the right half of a char yields the next offset).
  function hitTest(x, y) {
    let node = null;
    let offset = 0;
    if (document.caretPositionFromPoint) {
      const p = document.caretPositionFromPoint(x, y);
      if (!p) return null;
      node = p.offsetNode;
      offset = p.offset;
    } else if (document.caretRangeFromPoint) {
      const r = document.caretRangeFromPoint(x, y);
      if (!r) return null;
      node = r.startContainer;
      offset = r.startOffset;
    }
    if (!node || node.nodeType !== Node.TEXT_NODE || isSkipped(node)) return null;

    const data = node.nodeValue || '';
    const candidates = [];
    if (offset < data.length) candidates.push(offset);
    if (offset > 0) {
      let prev = offset - 1;
      const code = data.charCodeAt(prev);
      if (code >= 0xdc00 && code <= 0xdfff && prev > 0) prev -= 1;
      candidates.push(prev);
    }
    for (const start of candidates) {
      let end = start + 1;
      const code = data.charCodeAt(start);
      if (code >= 0xd800 && code <= 0xdbff && end < data.length) end = start + 2;
      const rect = charRect({ node, start, end });
      if (rectContains(rect, x, y, 3)) return { node, offset: start, rect };
    }
    return null;
  }

  // -------------------------------------------------------------------------
  // Highlight: paints points[start .. start+length) with one Range per
  // contiguous same-node run, so skipped content between the matched
  // characters (e.g. ruby <rt> annotations) is not painted.
  // -------------------------------------------------------------------------

  function highlighterFor(points) {
    return {
      set(start, length) {
        if (!('highlights' in CSS)) return;
        try {
          const n = Math.min(start + length, points.length);
          const ranges = [];
          let i = Math.max(0, start);
          while (i < n) {
            let j = i;
            while (
              j + 1 < n &&
              points[j + 1].node === points[j].node &&
              points[j + 1].start === points[j].end
            ) j++;
            const r = document.createRange();
            r.setStart(points[i].node, points[i].start);
            r.setEnd(points[j].node, points[j].end);
            ranges.push(r);
            i = j + 1;
          }
          CSS.highlights.set(HIGHLIGHT_NAME, new Highlight(...ranges));
        } catch {
          /* stale nodes; ignore */
        }
      },
      clear() {
        if ('highlights' in CSS) CSS.highlights.delete(HIGHLIGHT_NAME);
      },
    };
  }

  // -------------------------------------------------------------------------
  // Hover flow
  // -------------------------------------------------------------------------

  // Leaving lookup-able text must also abandon any in-flight lookup, or it
  // would arrive a moment later and open a popup over nothing.
  function leaveText() {
    popup.cancelPending();
    popup.scheduleHide();
  }

  async function processPoint(x, y) {
    if (popup.isPointerInside()) return; // reading the popup; leave it alone
    // The bar sits just below the highlighted line, which is exactly where the
    // popup would anchor: travelling to it must not bury it.
    if (selectionBar.isOpen()) return;
    const hit = hitTest(x, y);
    if (!hit) { leaveText(); return; }
    if (lastHit && lastHit.node === hit.node && lastHit.offset === hit.offset &&
        popup.isVisible()) {
      popup.cancelHide();
      return; // same char as before, popup already correct
    }
    const collected = collectAround(hit.node, hit.offset);
    if (!collected || !CJK_RE.test(Array.from(collected.text)[collected.cursorIndex] || '')) {
      leaveText();
      return;
    }
    const shown = await popup.open({
      text: collected.text,
      cursorIndex: collected.cursorIndex,
      rect: hit.rect,
      x,
      highlight: highlighterFor(collected.points),
      stillWanted: () => enabled,
    });
    if (shown) lastHit = hit;
    else popup.scheduleHide();
  }

  function onMouseMove(e) {
    if (!enabled || !e.isTrusted) return;
    if (e.buttons !== 0) return; // dragging/selecting: no lookups, no hides
    if (popup.ownsEvent(e)) {
      popup.cancelHide(); // pointer is over the popup; don't re-lookup
      return;
    }
    if (selectionBar.ownsEvent(e)) return;
    pendingEvent = e;
    if (moveTimer) return;
    moveTimer = setTimeout(() => {
      moveTimer = null;
      const ev = pendingEvent;
      pendingEvent = null;
      if (ev) processPoint(ev.clientX, ev.clientY);
    }, 25);
  }

  document.addEventListener('mousemove', onMouseMove, { passive: true });
  document.addEventListener('mouseleave', () => popup.scheduleHide());
})();
