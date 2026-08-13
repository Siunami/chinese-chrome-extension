// Saving Chinese as a flashcard, from anywhere — one implementation, every
// surface.
//
// Two shapes of the same thing:
//
//   * inline ☆ controls that a page attaches to text it already renders (an
//     HSK grammar example, a vocabulary item, one sentence of a reading
//     passage). The page says what the text is and, if it has one, what it
//     means; everything else happens here.
//
//   * a floating action bar that appears on any text selection — on the study
//     guides, the news digest, the library, a revealed review card, and on
//     arbitrary web pages through the content script. It is also where the
//     tutor's "Ask about this" lives, so a selection raises one bar with every
//     action rather than a stack of competing bubbles.
//
// Both resolve through the service worker (lib/cards.js), so what may become a
// card — a word, a phrase, or a single sentence, never a paragraph — is
// decided in exactly one place, and a word saved from here is the same card as
// the same word saved from the hover popup.
//
// Deliberately a classic script, for the same reason lib/popup.js is one:
// content scripts cannot be modules. It publishes globalThis.ZhongwenSaveCard;
// extension pages load it with a plain <script> tag before their module entry
// point and read the global.

(() => {
  'use strict';

  if (globalThis.ZhongwenSaveCard) return;

  // Why a selection cannot be a card, in words a learner can act on. The keys
  // are the refusals lib/cards.js returns.
  const ISSUE_TEXT = {
    'too-long': 'Too long for a card — highlight a phrase or one sentence',
    'multi-sentence': 'That is more than one sentence — highlight just one',
    unavailable: 'Could not reach the dictionary',
  };

  // Inline controls live in the host page's DOM (they sit inside its layout),
  // so their styles go into the page rather than a shadow root. Pages that
  // want a control to keep quiet until the row is hovered mark the row
  // .zwe-savable; a saved control stays lit either way, so the guide shows at
  // a glance what is already in the deck.
  const INLINE_CSS = `
  .zwe-save {
    display: inline-flex; align-items: center; margin-left: 6px;
    padding: 1px 8px; border: 1px solid rgba(0, 0, 0, 0.2); border-radius: 999px;
    background: rgba(255, 255, 255, 0.72); color: inherit;
    font: inherit; font-size: 11.5px; line-height: 1.7; font-weight: 600;
    white-space: nowrap; vertical-align: middle; cursor: pointer;
    transition: opacity 120ms ease, background 120ms ease;
  }
  .zwe-save:hover { background: #fff; }
  .zwe-save:disabled { cursor: default; opacity: 0.45; }
  .zwe-save.zwe-on {
    border-color: rgba(10, 122, 47, 0.4); background: rgba(232, 247, 236, 0.92);
    color: #0a7a2f;
  }
  .zwe-savable .zwe-save { opacity: 0; }
  .zwe-savable:hover .zwe-save, .zwe-savable:focus-within .zwe-save,
  .zwe-save:focus-visible, .zwe-save.zwe-on { opacity: 1; }
  .theme-dark .zwe-save { border-color: rgba(255, 255, 255, 0.22);
    background: rgba(255, 255, 255, 0.08); }
  .theme-dark .zwe-save:hover { background: rgba(255, 255, 255, 0.16); }
`;

  // The bar renders into a closed shadow root: on an arbitrary web page it has
  // to be immune to the page's stylesheet, exactly like the popup.
  const BAR_CSS = `
  :host { all: initial; }
  .bar {
    position: fixed; z-index: 2147483646; display: flex; gap: 6px;
    box-sizing: border-box; padding: 5px; border-radius: 999px;
    border: 1px solid #c9b08a; background: #fdf6c7;
    box-shadow: 0 3px 14px rgba(60, 48, 24, 0.24);
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto,
      "Helvetica Neue", Arial, sans-serif;
    font-size: 12.5px; line-height: 1.3;
  }
  .bar[hidden] { display: none; }
  .act {
    padding: 5px 12px; border: 0; border-radius: 999px; background: transparent;
    color: #7f1920; font: inherit; font-weight: 650; white-space: nowrap;
    cursor: pointer;
  }
  .act:hover:not(:disabled) { background: rgba(127, 25, 32, 0.12); }
  .act:disabled { color: #8a7a52; font-weight: 500; cursor: default; }
  .act.on { color: #0a6b2a; }
`;

  // Keep the message under the worker's own cap (MAX_SAVED_STATE_KEYS); a
  // single HSK guide can put more controls on screen than one message holds.
  const SAVED_STATE_BATCH = 200;

  let inlineCssInjected = false;
  function injectInlineCss() {
    if (inlineCssInjected) return;
    inlineCssInjected = true;
    const style = document.createElement('style');
    style.textContent = INLINE_CSS;
    (document.head || document.documentElement).append(style);
  }

  // ---------------------------------------------------------------------------
  // The saver: resolution, saved state, and toggling. One per document, so a
  // card saved from the selection bar immediately lights up its inline star.
  // ---------------------------------------------------------------------------

  function buildSaver() {
    const resolutions = new Map();  // request key -> Promise<resolution>
    const savedKeys = new Set();    // cardKeys currently in the vocab list
    let controls = [];              // { key, el, apply } on screen now
    const togglesInFlight = new Set();
    let queue = [];                 // resolve requests waiting for a batch
    let flushTimer = null;
    let refreshTimer = null;
    let savedSeq = 0;

    const requestKey = (item) =>
      [item.text || '', item.en || '', item.sourceWord || '', item.unit ? '1' : '']
        .join('');

    // One message per render pass rather than one per control: a guide puts a
    // hundred stars on screen at once.
    function flush() {
      flushTimer = null;
      const batch = queue;
      queue = [];
      chrome.runtime.sendMessage({ type: 'resolveCards', items: batch.map((b) => b.item) })
        .then((r) => {
          const cards = r && Array.isArray(r.cards) ? r.cards : [];
          batch.forEach((b, i) => b.settle(cards[i] || { issue: 'unavailable' }));
        })
        .catch(() => batch.forEach((b) => b.settle({ issue: 'unavailable' })));
    }

    function resolve(item) {
      const key = requestKey(item);
      const known = resolutions.get(key);
      if (known) return known;
      const pending = new Promise((settle) => {
        queue.push({ item, settle });
        if (!flushTimer) flushTimer = setTimeout(flush, 0);
      });
      resolutions.set(key, pending);
      return pending;
    }

    // Controls belong to whatever the page last rendered; a guide switching
    // level throws its old stars away without telling us.
    function prune() {
      controls = controls.filter((c) => !c.el || c.el.isConnected);
    }

    function applyAll() {
      prune();
      for (const c of controls) c.apply(savedKeys.has(c.key));
    }

    function setSaved(key, saved) {
      if (saved) savedKeys.add(key);
      else savedKeys.delete(key);
      applyAll();
    }

    function register(key, el, apply) {
      controls.push({ key, el, apply });
      apply(savedKeys.has(key));
      scheduleRefresh();
    }

    function scheduleRefresh() {
      if (refreshTimer) return;
      refreshTimer = setTimeout(() => {
        refreshTimer = null;
        refreshSavedStates();
      }, 150);
    }

    // What we last heard can be wrong: the card may have been saved in another
    // tab, or deleted from the library. Ask about everything on screen.
    async function refreshSavedStates() {
      prune();
      const keys = [...new Set(controls.map((c) => c.key))];
      if (keys.length === 0) return;
      const seq = ++savedSeq;
      const answered = new Map();
      for (let i = 0; i < keys.length; i += SAVED_STATE_BATCH) {
        const chunk = keys.slice(i, i + SAVED_STATE_BATCH);
        let r;
        try {
          r = await chrome.runtime.sendMessage({ type: 'savedStates', keys: chunk });
        } catch {
          return; // extension reloaded; leave the controls as they are
        }
        if (seq !== savedSeq) return;
        if (!r || !Array.isArray(r.saved)) return;
        chunk.forEach((k, j) => answered.set(k, !!r.saved[j]));
      }
      for (const [k, saved] of answered) {
        if (saved) savedKeys.add(k);
        else savedKeys.delete(k);
      }
      applyAll();
    }

    // Save, or take back out a card that is already there. The control flips
    // immediately and flips back if the worker refuses, so a check always
    // means "this is in your vocab list".
    async function toggle(resolution) {
      const card = resolution && resolution.card;
      const key = resolution && resolution.key;
      if (!card || !key || togglesInFlight.has(key)) return null;
      togglesInFlight.add(key);
      const removing = savedKeys.has(key);
      setSaved(key, !removing);
      let ok = false;
      try {
        const r = await chrome.runtime.sendMessage({
          type: removing ? 'unsaveWord' : 'saveWord', entry: card,
        });
        ok = !!(r && r.ok);
      } catch {
        ok = false;
      }
      togglesInFlight.delete(key);
      if (!ok) setSaved(key, removing);
      return { ok, saved: ok ? !removing : removing };
    }

    // A resolution carries the saved state it was resolved with, but the
    // promise is cached — replaying it for a control built later would undo a
    // save made in between. Seed the set once, then trust the set.
    function seed(resolution) {
      if (!resolution || !resolution.key || resolution.seeded) return;
      resolution.seeded = true;
      setSaved(resolution.key, !!resolution.saved);
    }

    // An inline ☆ for text a page renders itself. Text that cannot be a card
    // gets no control at all: a page offers this on things it already knows
    // are card-sized, so a refusal here means "nothing to offer", not "you did
    // something wrong" — that conversation belongs to the selection bar, where
    // the learner chose the text.
    function control(item, options = {}) {
      const {
        label = '☆ save',
        savedLabel = '✓ saved',
        title = 'Save for spaced repetition',
        savedTitle = 'In your vocab list — click to remove',
        describe = item.text,
        className = '',
      } = options;
      injectInlineCss();
      const button = document.createElement('button');
      button.type = 'button';
      button.className = className ? `zwe-save ${className}` : 'zwe-save';
      button.textContent = label;
      button.disabled = true;
      let resolution = null;
      resolve(item).then((r) => {
        if (!r || r.issue || !r.card) { button.remove(); return; }
        resolution = r;
        button.disabled = false;
        register(r.key, button, (saved) => {
          button.textContent = saved ? savedLabel : label;
          button.classList.toggle('zwe-on', saved);
          button.title = saved ? savedTitle : title;
          button.setAttribute('aria-pressed', saved ? 'true' : 'false');
          button.setAttribute('aria-label',
            `${saved ? 'Remove' : 'Save'} ${describe}`);
        });
        seed(r);
      });
      button.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (resolution) toggle(resolution);
      });
      return button;
    }

    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && changes.wordlist) scheduleRefresh();
    });

    return {
      control,
      resolve,
      toggle,
      seed,
      isSaved: (key) => savedKeys.has(key),
      refresh: refreshSavedStates,
    };
  }

  let saverInstance = null;
  function saver() {
    if (!saverInstance) saverInstance = buildSaver();
    return saverInstance;
  }

  // ---------------------------------------------------------------------------
  // The selection bar
  // ---------------------------------------------------------------------------

  // Actions are `{ key, label, title, prepare?, run }`. `prepare(picked)` may
  // return { hidden, disabled, label, title, run } to decide what the action
  // looks like for this particular selection — the save action uses it to ask
  // the worker whether the highlighted text can be a card at all.
  function createSelectionBar(options = {}) {
    const {
      root = null,                  // element, function, or null for the whole page
      lookup = null,                // hidden while the bar is up; it would cover it
      popup = null,                 // the hover popup, when the host has one
      getEnabled = () => true,
      save = true,                  // include the built-in ☆ Save action
      // Past this the bar says nothing at all rather than explaining itself.
      // A selection of a few sentences is a near miss worth a reason; half an
      // article is not a card anyone was reaching for.
      maxChars = 600,
    } = options;

    const actions = [];
    let host = null;
    let shadow = null;
    let barEl = null;
    let picked = null;
    let renderSeq = 0;

    if (save) actions.push(saveAction());

    function ensureBar() {
      if (barEl && host && host.isConnected) return barEl;
      host = document.createElement('div');
      host.style.all = 'initial';
      shadow = host.attachShadow({ mode: 'closed' });
      const style = document.createElement('style');
      style.textContent = BAR_CSS;
      barEl = document.createElement('div');
      barEl.className = 'bar';
      barEl.hidden = true;
      // A plain click anywhere in the bar would collapse the selection before
      // the click handler ran, and the action would find nothing highlighted.
      barEl.addEventListener('mousedown', (e) => e.preventDefault());
      shadow.append(style, barEl);
      (document.documentElement || document.body).append(host);
      return barEl;
    }

    const rootFor = () => (typeof root === 'function' ? root() : root);

    function ownsEvent(e) {
      return !!host && (e.target === host || host.contains(e.target));
    }

    function hide() {
      renderSeq++;
      picked = null;
      if (barEl) {
        barEl.hidden = true;
        barEl.replaceChildren();
      }
    }

    function takeSelection() {
      if (!getEnabled()) return null;
      const selection = window.getSelection();
      if (!selection || selection.isCollapsed || selection.rangeCount === 0) return null;
      const range = selection.getRangeAt(0);
      const within = rootFor();
      if (within && !within.contains(range.commonAncestorContainer)) return null;
      const text = selection.toString().replace(/\s+/g, ' ').trim();
      if (!text || text.length > maxChars) return null;
      return { range, text };
    }

    function position() {
      const rects = picked ? picked.range.getClientRects() : null;
      const rect = (rects && rects[rects.length - 1])
        || (picked && picked.range.getBoundingClientRect());
      if (!rect) return;
      const width = barEl.offsetWidth;
      const height = barEl.offsetHeight;
      const left = Math.max(8,
        Math.min(rect.right - width / 2, window.innerWidth - width - 8));
      const below = rect.bottom + 8;
      const top = below + height < window.innerHeight
        ? below
        : Math.max(8, rect.top - height - 8);
      barEl.style.left = `${left}px`;
      barEl.style.top = `${top}px`;
    }

    function actionButton(action, current, seq, settled) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'act';
      button.dataset.action = action.key;
      button.textContent = action.label;
      if (action.title) button.title = action.title;
      let run = action.run;
      button.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (run) run(current, { button, bar: api });
      });
      if (!action.prepare) return button;
      button.disabled = true;
      action.prepare(current).then((patch) => {
        if (seq !== renderSeq) return;
        if (!patch || patch.hidden) { button.remove(); settled(); return; }
        if (patch.label !== undefined) button.textContent = patch.label;
        if (patch.title !== undefined) button.title = patch.title;
        if (patch.run) run = patch.run;
        button.disabled = !!patch.disabled;
        button.classList.toggle('on', !!patch.on);
        settled();
      }).catch(() => { button.remove(); settled(); });
      return button;
    }

    // The bar stays hidden until it has something to say. Most selections on a
    // web page are English, and an empty pill floating under every one of them
    // would be the extension shouting about nothing.
    function show(next) {
      picked = next;
      const seq = ++renderSeq;
      const bar = ensureBar();
      lookup?.hide();  // it anchors under the same line the bar wants
      bar.replaceChildren();
      bar.hidden = true;
      let pending = actions.length;
      const settled = () => {
        if (seq !== renderSeq) return;
        pending--;
        if (bar.childElementCount > 0) {
          bar.hidden = false;
          position();
        } else if (pending === 0) {
          bar.hidden = true;
        }
      };
      // Append everything before settling any of it: an action with nothing to
      // prepare is ready the moment it is on screen, and "on screen" is what
      // settling looks at.
      let ready = 0;
      for (const action of actions) {
        bar.append(actionButton(action, next, seq, settled));
        if (!action.prepare) ready++;
      }
      for (let i = 0; i < ready; i++) settled();
    }

    function refresh() {
      const next = takeSelection();
      if (next) show(next);
      else hide();
    }

    // A selection made with the mouse settles a tick after mouseup; one made
    // with shift+arrows settles on keyup.
    document.addEventListener('mouseup', (e) => {
      if (ownsEvent(e) || (popup && popup.ownsEvent(e))) return;
      setTimeout(refresh, 0);
    });
    document.addEventListener('keyup', (e) => {
      if (e.key === 'Shift' || e.shiftKey) setTimeout(refresh, 0);
    });
    document.addEventListener('selectionchange', () => {
      const selection = window.getSelection();
      if (!selection || selection.isCollapsed) hide();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && barEl && !barEl.hidden) hide();
    });
    window.addEventListener('scroll', () => { if (picked) position(); }, true);
    window.addEventListener('resize', () => { if (picked) position(); });

    const api = {
      // Contribute an action. Order on screen is the order registered, so the
      // built-in save sits first and the tutor's "Ask" follows it.
      addAction(action) { actions.push(action); return api; },
      isOpen: () => !!barEl && !barEl.hidden,
      hide,
      ownsEvent,
    };
    return api;
  }

  // The built-in action. Everything it needs to know about the highlighted
  // text — can this be a card, which card, is it already saved — comes back
  // from one resolveCards round trip.
  function saveAction() {
    return {
      key: 'save',
      label: '☆ Save',
      title: 'Save this for spaced repetition',
      async prepare(current) {
        const store = saver();
        const resolved = await store.resolve({ text: current.text });
        if (!resolved || resolved.issue === 'no-chinese' || resolved.issue === 'empty') {
          return { hidden: true };
        }
        if (resolved.issue || !resolved.card) {
          return {
            disabled: true,
            label: ISSUE_TEXT[resolved.issue] || 'Cannot save this',
            title: '',
          };
        }
        store.seed(resolved);
        const kind = resolved.card.cardType === 'sentence' ? 'sentence' : 'word';
        const label = (saved) => (saved ? '✓ Saved' : '☆ Save');
        const title = (saved) => (saved
          ? 'In your vocab list — click to remove'
          : `Save this ${kind} for spaced repetition`);
        const saved = store.isSaved(resolved.key);
        return {
          label: label(saved),
          title: title(saved),
          on: saved,
          async run(_picked, { button }) {
            button.disabled = true;
            const outcome = await store.toggle(resolved);
            button.disabled = false;
            if (!outcome) return;
            if (!outcome.ok) {
              button.textContent = 'Save failed';
              return;
            }
            button.textContent = label(outcome.saved);
            button.title = title(outcome.saved);
            button.classList.toggle('on', outcome.saved);
            button.setAttribute('aria-pressed', outcome.saved ? 'true' : 'false');
          },
        };
      },
      run() {},
    };
  }

  globalThis.ZhongwenSaveCard = {
    saver,
    createSelectionBar,
  };
})();
