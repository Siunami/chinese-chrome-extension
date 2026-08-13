// The universal hover popup — one implementation, every surface.
//
// This is the panel you get hovering Chinese anywhere: definitions for the
// containing phrase, example sentences, a per-character breakdown, related
// words, save/copy/pronounce controls, and flat back/forward history for
// exploring nested definitions.
//
// It renders into a closed shadow root attached to the document, so it looks
// and behaves identically whether the host is an arbitrary web page (loaded
// by content.js) or one of the extension's own pages (loaded by lib/lookup.js,
// which wraps hanzi in hoverable spans). The only thing callers supply is
// WHERE the text is: a string plus a cursor index, an anchor rect, and an
// optional highlighter for painting the matched phrase in their own DOM.
//
// Deliberately a classic script rather than an ES module: content scripts
// cannot be modules, and dynamic import() inside a content script is subject
// to the page's CSP. Loading it as the first entry of the content_scripts
// list (and as a plain <script> on extension pages) works everywhere and
// keeps a single copy of the UI.

(() => {
  'use strict';

  if (globalThis.ZhongwenPopup) return;

  const CJK_RE = /[㐀-鿿豈-﫿]|[\ud840-\ud87f][\udc00-\udfff]/;

  const DEFAULTS = {
    theme: 'yellow', // yellow | light | dark
    toneColors: true,
    exampleCount: 8,
    examplePinyin: true,
    hanziPref: 'simp-first', // simp-first | trad-first
    showHints: true,
  };

  const POPUP_CSS = `
    :host { all: initial; }
    .popup {
      position: fixed;
      z-index: 2147483647;
      max-width: 440px;
      min-width: 260px;
      max-height: 66vh;
      overflow-y: auto;
      overscroll-behavior: contain;
      box-sizing: border-box;
      padding: 10px 14px;
      border-radius: 8px;
      box-shadow: 0 4px 18px rgba(0, 0, 0, 0.28);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto,
        "Helvetica Neue", Arial, "PingFang SC", "Hiragino Sans GB",
        "Microsoft YaHei", sans-serif;
      font-size: 14px;
      line-height: 1.45;
      pointer-events: auto;
      user-select: text;
      cursor: default;
      text-align: left;
    }
    .popup::-webkit-scrollbar { width: 8px; }
    .popup::-webkit-scrollbar-thumb {
      background: rgba(0, 0, 0, 0.25); border-radius: 4px;
    }
    .theme-dark.popup::-webkit-scrollbar-thumb { background: rgba(255, 255, 255, 0.25); }
    .popup.theme-yellow { background: #fdf6c7; border: 1px solid #d6c982; color: #1c1c1c; }
    .popup.theme-light { background: #ffffff; border: 1px solid #c9c9c9; color: #1c1c1c; }
    .popup.theme-dark { background: #26262b; border: 1px solid #4a4a52; color: #ececec; }
    .navbar { position: sticky; top: -10px; z-index: 2; display: flex;
      align-items: center; gap: 6px; margin-bottom: 6px; padding: 8px 0 6px;
      background: inherit; user-select: none; }
    .navspacer { flex: 1; min-width: 4px; }
    .navbar .btn { padding: 1px 7px; font-size: 11px; white-space: nowrap; }
    .navbar .flash { font-size: 10px; white-space: nowrap; }
    .navbtn { cursor: pointer; padding: 0 9px; border-radius: 5px; font-size: 15px;
      line-height: 1.5; border: 1px solid rgba(0, 0, 0, 0.22);
      background: rgba(255, 255, 255, 0.35); }
    .navbtn:hover { background: rgba(255, 255, 255, 0.7); }
    .navbtn.disabled { opacity: 0.3; cursor: default; pointer-events: none; }
    .theme-dark .navbtn { border-color: rgba(255, 255, 255, 0.28);
      background: rgba(255, 255, 255, 0.08); }
    .theme-dark .navbtn:hover { background: rgba(255, 255, 255, 0.18); }
    .navpos { font-size: 11px; opacity: 0.5; }
    .ch { cursor: pointer; }
    .ch:hover { text-decoration: underline; text-underline-offset: 3px; }
    .chars { margin: 2px 0 4px; }
    .charrow { display: flex; gap: 10px; align-items: baseline; margin: 4px 0;
      cursor: pointer; }
    .charrow .hanzi { font-size: 17px; }
    .charrow .pinyin { font-size: 13px; }
    .chardefs { font-size: 12.5px; opacity: 0.8; }
    .section-label { margin: 1px 0 4px; font-size: 11px; font-weight: 650;
      letter-spacing: 0.04em; text-transform: uppercase; opacity: 0.52; }
    .sense { display: flex; align-items: baseline; gap: 6px; margin: 1px 0; }
    .sense-num { min-width: 14px; font-size: 10px; opacity: 0.42;
      user-select: none; }
    .sense-text { min-width: 0; }
    .related { margin: 2px 0 5px; }
    .related-row { margin: 3px 0; padding: 5px 7px; border-radius: 6px;
      cursor: pointer; }
    .related-row:hover { background: rgba(31, 117, 255, 0.1); }
    .theme-dark .related-row:hover { background: rgba(100, 159, 255, 0.14); }
    .related-head { display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; }
    .related-word { font-size: 17px; font-weight: 620;
      font-family: "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei",
        "Noto Sans CJK SC", sans-serif; }
    .related-row .pinyin { font-size: 12.5px; }
    .related-reason { margin-left: auto; padding: 1px 5px; border-radius: 8px;
      background: rgba(0, 0, 0, 0.07); font-size: 9.5px; opacity: 0.62;
      user-select: none; }
    .theme-dark .related-reason { background: rgba(255, 255, 255, 0.1); }
    .related-defs { margin-top: 1px; font-size: 12px; opacity: 0.78; }
    .entry { margin: 6px 0 8px; }
    .entry:first-child { margin-top: 2px; }
    .headline { display: flex; align-items: baseline; gap: 12px; flex-wrap: wrap; }
    .hanzi { font-size: 22px; font-weight: 600;
      font-family: "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei",
        "Noto Sans CJK SC", sans-serif; }
    .hanzi.alt { opacity: 0.62; font-weight: 500; }
    .pinyin { font-size: 16px; font-weight: 500; }
    .speakbtn { display: inline-flex; align-items: center; justify-content: center;
      width: 23px; height: 23px; padding: 0; border: 0; border-radius: 50%;
      background: transparent; font-size: 13px; line-height: 1; cursor: pointer;
      opacity: 0.58; user-select: none; }
    .speakbtn:hover { background: rgba(31, 117, 255, 0.12); opacity: 1; }
    .theme-dark .speakbtn:hover { background: rgba(100, 159, 255, 0.18); }
    .entry-save { display: inline-flex; align-items: center; justify-content: center;
      width: 23px; height: 23px; border-radius: 50%; cursor: pointer;
      font-size: 16px; line-height: 1; opacity: 0.55; user-select: none; }
    .entry-save:hover { background: rgba(31, 117, 255, 0.12); opacity: 1; }
    .theme-dark .entry-save:hover { background: rgba(100, 159, 255, 0.18); }
    .entry-save.on { color: #0a7a2f; opacity: 1; }
    .theme-dark .entry-save.on { color: #6fdc8f; }
    .defs { margin-top: 1px; font-size: 13.5px; }
    .theme-dark .defs { color: #d8d8d8; }
    .divider { border: 0; border-top: 1px solid rgba(0, 0, 0, 0.14); margin: 8px 0; }
    .theme-dark .divider { border-top-color: rgba(255, 255, 255, 0.16); }
    .examples { margin-top: 2px; }
    .example { margin: 7px 0; }
    .ex-zh { font-size: 15px;
      font-family: "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei",
        "Noto Sans CJK SC", sans-serif; }
    .ex-zh .hl { font-weight: 700; color: #b5232b; }
    .theme-dark .ex-zh .hl { color: #ff8080; }
    .ex-py { font-size: 12px; opacity: 0.62; }
    .ex-en { font-size: 13px; opacity: 0.85; }
    .sentence-save { display: inline-flex; align-items: center; margin-left: 6px;
      padding: 2px 7px; border: 1px solid rgba(181, 35, 43, 0.38);
      border-radius: 9px; background: rgba(255, 255, 255, 0.55); color: #8f1c23;
      font-size: 10px; font-weight: 650; vertical-align: middle; cursor: pointer;
      user-select: none; }
    .sentence-save:hover, .sentence-save:focus { background: #fff; outline: 1px solid
      rgba(181, 35, 43, 0.35); }
    .sentence-save.saved { border-color: rgba(10, 122, 47, 0.35); color: #0a7a2f; }
    .theme-dark .sentence-save { border-color: rgba(255, 255, 255, 0.2);
      background: rgba(255, 255, 255, 0.06); }
    .footer { margin-top: 8px; font-size: 12px; display: flex;
      align-items: center; gap: 10px; user-select: none; }
    .btn {
      opacity: 0.75; cursor: pointer; padding: 2px 8px; border-radius: 5px;
      border: 1px solid rgba(0, 0, 0, 0.22); background: rgba(255, 255, 255, 0.35);
    }
    .btn:hover { opacity: 1; background: rgba(255, 255, 255, 0.7); }
    .theme-dark .btn { border-color: rgba(255, 255, 255, 0.28);
      background: rgba(255, 255, 255, 0.08); }
    .theme-dark .btn:hover { background: rgba(255, 255, 255, 0.18); }
    .btn.on { opacity: 1; border-color: rgba(10, 122, 47, 0.45);
      background: rgba(10, 122, 47, 0.13); color: #0a7a2f; }
    .btn.on:hover { background: rgba(10, 122, 47, 0.2); }
    .theme-dark .btn.on { border-color: rgba(111, 220, 143, 0.45);
      background: rgba(111, 220, 143, 0.16); color: #6fdc8f; }
    .theme-dark .btn.on:hover { background: rgba(111, 220, 143, 0.24); }
    .hint { margin-left: auto; font-size: 11px; opacity: 0.5; }
    .flash { color: #0a7a2f; font-weight: 600; }
    .theme-dark .flash { color: #6fdc8f; }
    .tone0 { }
    .tone1 { color: #d02c1f; }
    .tone2 { color: #0f8b1f; }
    .tone3 { color: #1b3ddb; }
    .tone4 { color: #8615bd; }
    .tone5 { color: #767676; }
    .theme-dark .tone1 { color: #ff6d5e; }
    .theme-dark .tone2 { color: #55d46a; }
    .theme-dark .tone3 { color: #7d9dff; }
    .theme-dark .tone4 { color: #d986ff; }
    .theme-dark .tone5 { color: #a8a8a8; }
    .nested-hit {
      background: rgba(31, 117, 255, 0.2);
      box-shadow: inset 0 -2px rgba(31, 117, 255, 0.8);
    }
    .theme-dark .nested-hit {
      background: rgba(100, 159, 255, 0.25);
      box-shadow: inset 0 -2px rgba(126, 173, 255, 0.9);
    }
    .mini-popup {
      position: fixed;
      z-index: 2147483647;
      display: none;
      width: max-content;
      min-width: 170px;
      max-width: min(300px, calc(100vw - 16px));
      max-height: 170px;
      overflow: hidden;
      box-sizing: border-box;
      padding: 7px 10px 6px;
      border-radius: 6px;
      box-shadow: 0 3px 12px rgba(0, 0, 0, 0.3);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto,
        "Helvetica Neue", Arial, "PingFang SC", "Hiragino Sans GB",
        "Microsoft YaHei", sans-serif;
      font-size: 12px;
      line-height: 1.35;
      text-align: left;
      user-select: text;
      cursor: pointer;
    }
    .mini-popup.theme-yellow { background: #fff9d9; border: 1px solid #cfc27a; color: #1c1c1c; }
    .mini-popup.theme-light { background: #fff; border: 1px solid #bdbdbd; color: #1c1c1c; }
    .mini-popup.theme-dark { background: #303036; border: 1px solid #5a5a64; color: #ececec; }
    .mini-head { display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; }
    .mini-word { font-size: 17px; font-weight: 650;
      font-family: "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei",
        "Noto Sans CJK SC", sans-serif; }
    .mini-popup .pinyin { font-size: 12px; }
    .mini-defs { display: -webkit-box; margin-top: 2px; overflow: hidden;
      opacity: 0.86; -webkit-box-orient: vertical; -webkit-line-clamp: 4; }
    .mini-open { margin-top: 4px; font-size: 10px; opacity: 0.5; user-select: none; }
  `;

  function build() {
    let settings = { ...DEFAULTS };
    let host = null;
    let shadow = null;
    let popupEl = null;
    let miniEl = null;
    let flashEl = null;
    let visible = false;
    let currentWord = null; // top entry of the current page, for save/copy
    let lookupSeq = 0;
    let miniSeq = 0;
    let hideTimer = null;
    let miniHideTimer = null;
    let pointerOverPopup = false;
    let pointerOverMini = false;
    let nestedSourceHover = false;
    let miniActive = null; // { source, page, start, length, word }

    // Flat, single-dimension exploration history. Each page is
    // {text, cursorIndex}; a fresh open restarts it, and going back then
    // choosing something new truncates the forward tail (browser-style).
    let navHistory = [];
    let navIndex = -1;

    let anchor = null;      // { x, rect } of the hover that opened the popup
    let highlighter = null; // caller-supplied { set(start, length), clear() }
    let openRange = null;   // { text, start, length } currently displayed

    // Every save control is a toggle: cards already in the vocab list show a
    // check and take themselves back out when clicked. `savedKeys` is what we
    // last heard from the worker, `savedControls` the buttons on screen that
    // repaint when it changes.
    let savedKeys = new Set();
    let savedControls = [];
    let savedSeq = 0;
    const togglesInFlight = new Set();

    chrome.storage.sync.get(DEFAULTS).then((s) => { settings = { ...DEFAULTS, ...s }; });
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'local') {
        // A save or delete on another surface (the library, a second tab)
        // must not leave this popup claiming the opposite.
        if (changes.wordlist && visible) refreshSavedStates();
        return;
      }
      if (area !== 'sync') return;
      for (const [k, { newValue }] of Object.entries(changes)) {
        if (k in settings) settings[k] = newValue;
      }
      if (visible) hide();
    });

    // -----------------------------------------------------------------------
    // Element helpers
    // -----------------------------------------------------------------------

    function span(className, text) {
      const el = document.createElement('span');
      if (className) el.className = className;
      el.textContent = text;
      return el;
    }

    function div(className) {
      const el = document.createElement('div');
      el.className = className;
      return el;
    }

    function ensurePopup() {
      if (popupEl && host && host.isConnected) return popupEl;
      host = document.createElement('div');
      host.style.all = 'initial';
      shadow = host.attachShadow({ mode: 'closed' });
      const style = document.createElement('style');
      style.textContent = POPUP_CSS;
      shadow.append(style);
      popupEl = document.createElement('div');
      popupEl.className = 'popup';
      popupEl.style.display = 'none';
      popupEl.addEventListener('mouseenter', () => {
        pointerOverPopup = true;
        cancelHide();
      });
      popupEl.addEventListener('mouseleave', (e) => {
        if (e.buttons) {
          // mid-drag (selecting popup text); decide once the button is released
          document.addEventListener('mouseup', (up) => {
            if (!ownsEvent(up)) {
              pointerOverPopup = false;
              scheduleHide();
            }
          }, { once: true });
          return;
        }
        pointerOverPopup = false;
        scheduleHide();
      });
      shadow.append(popupEl);
      (document.documentElement || document.body).append(host);
      return popupEl;
    }

    function ensureMiniPopup() {
      ensurePopup();
      if (miniEl && miniEl.isConnected) return miniEl;
      miniEl = div('mini-popup');
      miniEl.addEventListener('mouseenter', () => {
        pointerOverMini = true;
        pointerOverPopup = true;
        cancelHide();
        cancelMiniHide();
      });
      miniEl.addEventListener('mouseleave', () => {
        pointerOverMini = false;
        pointerOverPopup = false;
        scheduleMiniHide();
        scheduleHide();
      });
      miniEl.addEventListener('click', (e) => {
        e.stopPropagation();
        if (miniActive) openNestedPage(miniActive.page);
      });
      shadow.append(miniEl);
      return miniEl;
    }

    // -----------------------------------------------------------------------
    // Hide scheduling. The grace period gives the user time to move the mouse
    // from the text into the (interactive) popup without it vanishing en route.
    // -----------------------------------------------------------------------

    function scheduleHide(delay = 260) {
      if (hideTimer || !visible) return;
      hideTimer = setTimeout(() => {
        hideTimer = null;
        if (!pointerOverPopup) hide();
      }, delay);
    }

    function cancelHide() {
      if (hideTimer) {
        clearTimeout(hideTimer);
        hideTimer = null;
      }
    }

    function cancelMiniHide() {
      if (miniHideTimer) {
        clearTimeout(miniHideTimer);
        miniHideTimer = null;
      }
    }

    function scheduleMiniHide(delay = 180) {
      if (miniHideTimer) return;
      miniHideTimer = setTimeout(() => {
        miniHideTimer = null;
        if (!nestedSourceHover && !pointerOverMini) hideMiniPopup();
      }, delay);
    }

    // -----------------------------------------------------------------------
    // Nested definitions: hovering Chinese inside the popup previews the
    // containing phrase; clicking promotes it into the main panel.
    // -----------------------------------------------------------------------

    function clearNestedHighlight() {
      if (!miniActive) return;
      for (const s of miniActive.source.spans) {
        if (s) s.classList.remove('nested-hit');
      }
    }

    function hideMiniPopup() {
      miniSeq++;
      cancelMiniHide();
      clearNestedHighlight();
      miniActive = null;
      nestedSourceHover = false;
      pointerOverMini = false;
      if (miniEl) miniEl.style.display = 'none';
    }

    function positionMiniPopup(mini, target) {
      mini.style.display = 'block';
      mini.style.left = '-9999px';
      mini.style.top = '0px';
      const rect = target.getBoundingClientRect();
      const w = mini.offsetWidth;
      const h = mini.offsetHeight;
      const gap = 7;
      let px = rect.right + gap;
      if (px + w > window.innerWidth - 8) px = rect.left - gap - w;
      if (px < 8) px = Math.max(8, Math.min(rect.left, window.innerWidth - 8 - w));
      let py = rect.bottom + gap;
      if (py + h > window.innerHeight - 8) py = rect.top - gap - h;
      py = Math.max(8, Math.min(py, window.innerHeight - 8 - h));
      mini.style.left = `${px}px`;
      mini.style.top = `${py}px`;
    }

    // For a single character the first CEDICT entry is often a surname or a
    // "variant of" note; prefer the everyday sense in the one-line preview.
    function bestMiniEntry(entries, singleCharacter) {
      if (!singleCharacter || entries.length < 2) return entries[0];
      const bad = /^(variant of|old variant of|surname |used in |see |archaic|\(archaic\)|\(bound form\))/i;
      return entries
        .map((entry, order) => {
          const startsUpper = /^[A-Z]/.test(entry.pinyin[0]?.text || '');
          let score = startsUpper ? 0 : 20;
          if (entry.defs.length > 0 && entry.defs.every((d) => bad.test(d))) score -= 30;
          else score += 10;
          return { entry, order, score: score + Math.min(entry.defs.length, 5) };
        })
        .sort((a, b) => b.score - a.score || a.order - b.order)[0].entry;
    }

    function renderMiniPopup(result, source, page, target) {
      const match = result.matches[0];
      const start = result.highlight.start;
      const length = result.highlight.length;
      const word = Array.from(source.text).slice(start, start + length).join('');
      const entry = bestMiniEntry(match.entries, Array.from(word).length === 1);
      clearNestedHighlight();
      miniActive = { source, page, start, length, word };
      for (let i = start; i < start + length; i++) {
        if (source.spans[i]) source.spans[i].classList.add('nested-hit');
      }

      const mini = ensureMiniPopup();
      mini.className = `mini-popup theme-${settings.theme}`;
      mini.replaceChildren();
      const head = div('mini-head');
      head.append(span('mini-word', word), pinyinSpans(entry.pinyin), speakerButton(word));
      mini.append(head);
      const defs = div('mini-defs');
      defs.textContent = entry.defs.slice(0, 3).join(' ◆ ');
      mini.append(defs, span('mini-open', 'click to open in main panel ›'));
      positionMiniPopup(mini, target);
    }

    async function showNestedPreview(source, cursorIndex, target) {
      nestedSourceHover = true;
      cancelMiniHide();
      if (
        miniActive && miniActive.source === source &&
        cursorIndex >= miniActive.start &&
        cursorIndex < miniActive.start + miniActive.length
      ) return;

      clearNestedHighlight();
      miniActive = null;
      if (miniEl) miniEl.style.display = 'none';
      const seq = ++miniSeq;
      let result;
      try {
        result = await chrome.runtime.sendMessage({
          type: 'lookup',
          text: source.text,
          cursorIndex,
          exampleCount: 0,
          includeRelated: false,
        });
      } catch {
        return;
      }
      if (
        seq !== miniSeq || !visible || !nestedSourceHover ||
        !result || result.error || !result.highlight ||
        !result.matches || result.matches.length === 0
      ) return;
      renderMiniPopup(result, source, { text: source.text, cursorIndex }, target);
    }

    function openNestedPage(page) {
      hideMiniPopup();
      showPage(page, true);
    }

    function wireNestedCharacter(s, source, cursorIndex) {
      source.spans[cursorIndex] = s;
      s.addEventListener('mouseenter', () => showNestedPreview(source, cursorIndex, s));
      s.addEventListener('mouseleave', () => {
        nestedSourceHover = false;
        scheduleMiniHide();
      });
      s.addEventListener('click', (e) => {
        e.stopPropagation();
        const page = miniActive && miniActive.source === source &&
          cursorIndex >= miniActive.start &&
          cursorIndex < miniActive.start + miniActive.length
          ? miniActive.page
          : { text: source.text, cursorIndex };
        openNestedPage(page);
      });
    }

    // Make Chinese embedded in definitions explorable as phrase-aware words.
    function appendExplorableText(el, text) {
      const source = { text, spans: [] };
      Array.from(text).forEach((ch, i) => {
        if (CJK_RE.test(ch)) {
          const s = span('ch', ch);
          wireNestedCharacter(s, source, i);
          el.append(s);
        } else {
          el.append(document.createTextNode(ch));
        }
      });
    }

    // -----------------------------------------------------------------------
    // Content rendering
    // -----------------------------------------------------------------------

    // Navigate the popup to a character's own definition page.
    function explore(ch) {
      if (!CJK_RE.test(ch)) return;
      const cur = navHistory[navIndex];
      if (cur && cur.text === ch) return; // already on this page
      showPage({ text: ch, cursorIndex: 0 }, true);
    }

    // Hanzi colored per-syllable tone when the counts align; every character
    // is clickable and navigates the popup to that character.
    function hanziSpans(word, pinyin, extraClass) {
      const wrap = span(`hanzi${extraClass ? ' ' + extraClass : ''}`, '');
      const chars = Array.from(word);
      const toned = pinyin.filter((s) => s.tone > 0);
      const usable = settings.toneColors && toned.length === chars.length;
      chars.forEach((ch, i) => {
        const s = span(`ch${usable ? ` tone${toned[i].tone}` : ''}`, ch);
        s.addEventListener('click', (e) => {
          // Character rows are also clickable; do not issue two lookups when
          // the user clicks directly on their hanzi.
          e.stopPropagation();
          explore(ch);
        });
        wrap.append(s);
      });
      return wrap;
    }

    function pinyinSpans(pinyin) {
      const wrap = span('pinyin', '');
      pinyin.forEach((s, i) => {
        if (i > 0) wrap.append(document.createTextNode(' '));
        wrap.append(span(settings.toneColors ? `tone${s.tone}` : '', s.text));
      });
      return wrap;
    }

    function speakText(text, slow) {
      chrome.runtime.sendMessage({ type: 'speak', text, slow: !!slow })
        .then((result) => { if (!result?.ok) flash('voice unavailable'); })
        .catch(() => flash('voice unavailable'));
    }

    function speakerButton(text, extraClass = '') {
      const button = span(`speakbtn${extraClass ? ` ${extraClass}` : ''}`, '🔊');
      button.title = 'Play Mandarin pronunciation (Shift-click: extra slow)';
      button.setAttribute('role', 'button');
      button.setAttribute('aria-label', `Play pronunciation for ${text}`);
      button.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        speakText(text, e.shiftKey);
      });
      return button;
    }

    function displayEntryToSavedWord(entry) {
      return {
        simp: entry.simp,
        trad: entry.trad,
        pinyin: entry.pinyin.map((s) => s.text).join(' '),
        tones: entry.pinyin.map((s) => s.tone).join(','),
        defs: entry.defs.join('; '),
      };
    }

    // Mirrors cardKey() in lib/merge.js, U+0001 separator included — the
    // worker compares these strings against its own. Duplicated rather than
    // imported because this file is a classic script (see the header note).
    function cardKeyOf(card) {
      return [
        card.cardType || 'word', card.simp || '', card.trad || card.simp || '',
        card.pinyin || '',
      ].join('');
    }

    // Register a save control for the current render. `apply(saved)` paints it
    // in both directions; it runs now with what we already know and again
    // whenever the vocab list answers.
    function trackSaved(key, apply) {
      savedControls.push({ key, apply });
      apply(savedKeys.has(key));
    }

    function applySavedStates() {
      for (const control of savedControls) control.apply(savedKeys.has(control.key));
    }

    // One round trip per render for every card on screen, rather than shipping
    // the whole vocab list into every page the popup lives on.
    async function refreshSavedStates() {
      const keys = [...new Set(savedControls.map((c) => c.key))];
      if (keys.length === 0) return;
      const seq = ++savedSeq;
      let result;
      try {
        result = await chrome.runtime.sendMessage({ type: 'savedStates', keys });
      } catch {
        return; // extension reloaded; leave the controls as they are
      }
      if (seq !== savedSeq || !result || !Array.isArray(result.saved)) return;
      keys.forEach((key, i) => {
        if (result.saved[i]) savedKeys.add(key);
        else savedKeys.delete(key);
      });
      applySavedStates();
    }

    function setSaved(key, saved) {
      if (saved) savedKeys.add(key);
      else savedKeys.delete(key);
      applySavedStates();
    }

    // Save, or un-save a card that is already there. The control flips
    // immediately and flips back if the worker refuses, so the check always
    // means "this is in your vocab list".
    async function toggleSaved(card) {
      const key = cardKeyOf(card);
      if (togglesInFlight.has(key)) return false;
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
      if (removing) flash(ok ? 'removed' : 'remove failed');
      else flash(ok ? 'saved ✓' : 'save failed');
      return ok;
    }

    function entrySaveButton(entry) {
      const card = displayEntryToSavedWord(entry);
      const button = span('entry-save', '☆');
      const reading = entry.pinyin.map((s) => s.text).join(' ');
      button.setAttribute('role', 'button');
      trackSaved(cardKeyOf(card), (saved) => {
        button.textContent = saved ? '✓' : '☆';
        button.classList.toggle('on', saved);
        button.title = saved
          ? `In your vocab list: ${reading} — click to remove`
          : `Save this exact sense: ${reading} — ${entry.defs.join('; ')}`;
        button.setAttribute('aria-label',
          `${saved ? 'Remove' : 'Save'} ${entry.simp}, ${reading}`);
        button.setAttribute('aria-pressed', saved ? 'true' : 'false');
      });
      button.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        toggleSaved(card);
      });
      return button;
    }

    function renderEntry(entry) {
      const box = div('entry');
      const head = div('headline');
      const tradFirst = settings.hanziPref === 'trad-first';
      const primary = tradFirst ? entry.trad : entry.simp;
      const secondary = tradFirst ? entry.simp : entry.trad;
      head.append(hanziSpans(primary, entry.pinyin, ''));
      if (secondary !== primary) head.append(hanziSpans(secondary, entry.pinyin, 'alt'));
      head.append(pinyinSpans(entry.pinyin), speakerButton(primary), entrySaveButton(entry));
      box.append(head);
      const defs = div('defs');
      entry.defs.forEach((definition, i) => {
        const sense = div('sense');
        if (entry.defs.length > 1) sense.append(span('sense-num', `${i + 1}`));
        const text = span('sense-text', '');
        appendExplorableText(text, definition);
        sense.append(text);
        defs.append(sense);
      });
      box.append(defs);
      return box;
    }

    function relatedHanzi(entry) {
      const word = settings.hanziPref === 'trad-first' ? entry.trad : entry.simp;
      const wrap = span('related-word', '');
      const chars = Array.from(word);
      const toned = entry.pinyin.filter((s) => s.tone > 0);
      const usable = settings.toneColors && toned.length === chars.length;
      chars.forEach((ch, i) => wrap.append(
        span(usable ? `tone${toned[i].tone}` : '', ch),
      ));
      return { word, el: wrap };
    }

    function renderRelated(entry) {
      const row = div('related-row');
      const head = div('related-head');
      const hanzi = relatedHanzi(entry);
      head.append(
        hanzi.el, pinyinSpans(entry.pinyin), speakerButton(hanzi.word),
        span('related-reason', entry.reason),
      );
      row.append(head);
      const defs = div('related-defs');
      const shown = entry.defs.slice(0, 3);
      appendExplorableText(defs, shown.join(' ◆ '));
      if (entry.defs.length > shown.length) {
        defs.append(document.createTextNode(`  (+${entry.defs.length - shown.length} more senses)`));
      }
      row.append(defs);
      row.addEventListener('click', () => {
        hideMiniPopup();
        showPage({ text: hanzi.word, cursorIndex: 0 }, true);
      });
      return row;
    }

    function renderExample(ex, wordForms) {
      const box = div('example');
      const zh = div('ex-zh');
      const source = { text: ex.zh, spans: [] };
      let found = -1;
      let form = '';
      for (const f of wordForms) {
        const i = f ? ex.zh.indexOf(f) : -1;
        if (i !== -1 && (found === -1 || i < found)) { found = i; form = f; }
      }
      // per-character spans: the matched word is highlighted, and every hanzi
      // is clickable for exploration
      let unit = 0;
      let codePointIndex = 0;
      for (const ch of Array.from(ex.zh)) {
        const inHl = found !== -1 && unit >= found && unit < found + form.length;
        if (CJK_RE.test(ch)) {
          const s = span(inHl ? 'ch hl' : 'ch', ch);
          wireNestedCharacter(s, source, codePointIndex);
          zh.append(s);
        } else {
          zh.append(span(inHl ? 'hl' : '', ch));
        }
        unit += ch.length;
        codePointIndex++;
      }
      zh.append(speakerButton(ex.zh));
      const sentenceCard = {
        cardType: 'sentence',
        simp: ex.zh,
        trad: ex.zh,
        pinyin: ex.py || '',
        tones: '',
        defs: ex.en,
        sourceWord: currentWord?.simp || '',
      };
      const saveSentence = span('sentence-save', '☆ save sentence');
      saveSentence.setAttribute('role', 'button');
      saveSentence.tabIndex = 0;
      trackSaved(cardKeyOf(sentenceCard), (saved) => {
        saveSentence.textContent = saved ? '✓ sentence saved' : '☆ save sentence';
        saveSentence.classList.toggle('saved', saved);
        saveSentence.title = saved
          ? 'In your vocab list — click to remove this sentence'
          : 'Save this full example sentence for spaced repetition';
        saveSentence.setAttribute('aria-pressed', saved ? 'true' : 'false');
      });
      const activateSave = (e) => {
        e.preventDefault();
        e.stopPropagation();
        toggleSaved(sentenceCard);
      };
      saveSentence.addEventListener('click', activateSave);
      saveSentence.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') activateSave(e);
      });
      zh.append(saveSentence);
      box.append(zh);
      if (settings.examplePinyin && ex.py) {
        const py = div('ex-py');
        py.textContent = ex.py;
        box.append(py);
      }
      const en = div('ex-en');
      en.textContent = ex.en;
      box.append(en);
      return box;
    }

    function renderCharRow(c) {
      const row = div('charrow');
      const first = c.entries[0];
      row.append(hanziSpans(c.char, first ? first.pinyin : [], ''));
      if (first) {
        row.append(pinyinSpans(first.pinyin), speakerButton(c.char));
        const more = c.entryCount > 1 ? `  (+${c.entryCount - 1} more)` : '';
        const defs = span('chardefs', '');
        appendExplorableText(defs, first.defs.join(' ◆ ') + more);
        row.append(defs);
      }
      row.addEventListener('click', () => explore(c.char));
      return row;
    }

    function divider() {
      const hr = document.createElement('hr');
      hr.className = 'divider';
      return hr;
    }

    // keepSize: during in-popup navigation, never let the popup shrink — if it
    // shrank out from under the pointer, mouseleave would schedule a hide.
    function renderPopup(result, keepSize) {
      const popup = ensurePopup();
      hideMiniPopup();
      if (keepSize && visible) {
        popup.style.minWidth = `${popup.offsetWidth}px`;
        popup.style.minHeight = `${Math.min(popup.offsetHeight, window.innerHeight * 0.6)}px`;
      } else {
        popup.style.minWidth = '';
        popup.style.minHeight = '';
      }
      popup.className = `popup theme-${settings.theme}`;
      popup.replaceChildren();
      flashEl = null;
      savedControls = [];

      const bar = div('navbar');
      const back = span(`navbtn${navIndex > 0 ? '' : ' disabled'}`, '‹');
      back.title = 'Back (←)';
      back.setAttribute('aria-label', 'Back');
      back.addEventListener('click', () => navStep(-1));
      const fwd = span(`navbtn${navIndex < navHistory.length - 1 ? '' : ' disabled'}`, '›');
      fwd.title = 'Forward (→)';
      fwd.setAttribute('aria-label', 'Forward');
      fwd.addEventListener('click', () => navStep(1));
      const saveBtn = span('btn', '☆ save');
      saveBtn.setAttribute('role', 'button');
      if (currentWord) {
        trackSaved(cardKeyOf(currentWord), (saved) => {
          saveBtn.textContent = saved ? '✓ saved' : '☆ save';
          saveBtn.classList.toggle('on', saved);
          saveBtn.title = saved
            ? 'In your vocab list — click to remove (s)'
            : 'Save word (s)';
          saveBtn.setAttribute('aria-pressed', saved ? 'true' : 'false');
        });
      }
      saveBtn.addEventListener('click', saveCurrentWord);
      const copyBtn = span('btn', '⧉');
      copyBtn.title = 'Copy word (c)';
      copyBtn.setAttribute('aria-label', 'Copy word');
      copyBtn.addEventListener('click', copyCurrentWord);
      flashEl = span('flash', '');
      bar.append(
        back, fwd, span('navpos', `${navIndex + 1}/${navHistory.length}`),
        span('navspacer', ''), saveBtn, copyBtn, flashEl,
      );
      popup.append(bar);

      const entriesBox = div('entries');
      for (const match of result.matches) {
        for (const entry of match.entries) {
          entriesBox.append(renderEntry(entry));
        }
      }
      popup.append(entriesBox);

      if (result.examples && result.examples.length > 0) {
        popup.append(divider());
        const wrap = div('examples-wrap');
        const label = div('section-label');
        label.textContent = 'Example sentences';
        wrap.append(label);
        const exBox = div('examples');
        const forms = [result.exampleWord.simp, result.exampleWord.trad];
        for (const ex of result.examples) exBox.append(renderExample(ex, forms));
        wrap.append(exBox);
        popup.append(wrap);
      }

      if (result.chars && result.chars.length > 0) {
        popup.append(divider());
        const charsBox = div('chars');
        const label = div('section-label');
        label.textContent = 'Characters';
        charsBox.append(label);
        for (const c of result.chars) charsBox.append(renderCharRow(c));
        popup.append(charsBox);
      }

      if (result.related && result.related.length > 0) {
        popup.append(divider());
        const relatedBox = div('related');
        const label = div('section-label');
        label.textContent = 'Related words';
        relatedBox.append(label);
        for (const entry of result.related) relatedBox.append(renderRelated(entry));
        popup.append(relatedBox);
      }

      if (settings.showHints) {
        const footer = div('footer');
        footer.append(span('hint',
          'hover to peek · p pronounce · s save/remove · c copy · ←→ history'));
        popup.append(footer);
      }
      popup.scrollTop = 0;
      refreshSavedStates();
      return popup;
    }

    // Anchors the popup BELOW the hovered line of text, so moving the cursor
    // left/right along the line never runs into it. When space is tight,
    // reduce its scrollable height instead of ever flipping it above or across
    // the active line. `x` (the pointer position, when the caller knows it)
    // places the popup beside the cursor; without one it centers on the rect.
    // Below the hovered line by preference: sweeping left and right along a
    // line of text then never runs the cursor into the panel. But "below,
    // always" degrades badly near the bottom of the viewport — it used to
    // leave a 48px sliver, or place the panel off-screen entirely when the
    // anchor itself was out of view, which reads as "hovering does nothing".
    // So flip above when there is not a readable amount of room below; above
    // still never covers the line being read. The final clamp is the backstop
    // for geometry neither branch can satisfy.
    const MARGIN = 8;
    const GAP = 10;
    const MIN_USABLE = 160; // below this the panel is not worth showing there

    function positionPopup(popup, x, rect) {
      popup.style.display = 'block';
      popup.style.left = '-9999px';
      popup.style.top = '0px';
      popup.style.maxHeight = '';
      const vw = window.innerWidth;
      const vh = window.innerHeight;

      const onLine = !!(rect && rect.height > 0);
      const below = onLine ? rect.bottom + GAP : (x != null ? 22 : MARGIN);
      const roomBelow = vh - MARGIN - below;
      const roomAbove = onLine ? rect.top - GAP - MARGIN : 0;
      const flip = onLine && roomBelow < MIN_USABLE && roomAbove > roomBelow;

      popup.style.maxHeight =
        `${Math.max(48, Math.min(vh * 0.66, flip ? roomAbove : roomBelow))}px`;

      const w = popup.offsetWidth;
      let px = x != null ? x + 10 : (rect ? rect.left + rect.width / 2 - w / 2 : MARGIN);
      px = Math.max(MARGIN, Math.min(px, vw - MARGIN - w));

      const h = popup.offsetHeight;
      let py = flip ? rect.top - GAP - h : below;
      py = Math.max(MARGIN, Math.min(py, vh - MARGIN - h));

      popup.style.left = `${px}px`;
      popup.style.top = `${py}px`;
    }

    function flash(text) {
      if (!flashEl) return;
      flashEl.textContent = text;
      setTimeout(() => { if (flashEl) flashEl.textContent = ''; }, 1200);
    }

    // -----------------------------------------------------------------------
    // Navigation
    // -----------------------------------------------------------------------

    function applyResult(result, keepSize) {
      const top = result.matches[0].entries[0];
      currentWord = displayEntryToSavedWord(top);
      const popup = renderPopup(result, keepSize);
      // in-popup navigation keeps the popup where it is; fresh hovers anchor
      // below the hovered line
      if (!keepSize && anchor) positionPopup(popup, anchor.x, anchor.rect);
      visible = true;
    }

    async function showPage(page, push) {
      const seq = ++lookupSeq;
      let result;
      try {
        result = await chrome.runtime.sendMessage({
          type: 'lookup',
          text: page.text,
          cursorIndex: page.cursorIndex,
          exampleCount: settings.exampleCount,
        });
      } catch {
        return;
      }
      if (seq !== lookupSeq || !visible) return;
      if (!result || result.error || !result.matches || result.matches.length === 0) return;
      if (push) {
        // back + new selection = new history line (flat, browser-style)
        navHistory = navHistory.slice(0, navIndex + 1);
        navHistory.push(page);
        navIndex = navHistory.length - 1;
      }
      applyResult(result, true);
    }

    function navStep(delta) {
      const target = navIndex + delta;
      if (target < 0 || target >= navHistory.length) return;
      navIndex = target;
      showPage(navHistory[navIndex], false);
    }

    // -----------------------------------------------------------------------
    // Public entry points
    // -----------------------------------------------------------------------

    function clearPageHighlight() {
      if (highlighter) highlighter.clear();
      highlighter = null;
      openRange = null;
    }

    function hide() {
      lookupSeq++; // discard any in-flight lookup so it cannot resurrect the popup
      cancelHide();
      pointerOverPopup = false;
      hideMiniPopup();
      if (popupEl) {
        popupEl.style.display = 'none';
        popupEl.style.minWidth = '';
        popupEl.style.minHeight = '';
        popupEl.style.maxHeight = '';
      }
      visible = false;
      currentWord = null;
      savedControls = [];
      savedSeq++; // an in-flight savedStates reply must not paint the next popup
      navHistory = [];
      navIndex = -1;
      anchor = null;
      clearPageHighlight();
    }

    // Show the phrase containing `text[cursorIndex]`, starting a fresh
    // exploration history. Resolves true when the popup is showing a result.
    //
    //   text        the surrounding run of text
    //   cursorIndex code-point index of the hovered character within it
    //   rect        client rect of that character (the popup sits below it)
    //   x           pointer x, when known — places the popup beside the cursor
    //   highlight   optional { set(start, length), clear() } to paint the
    //               matched phrase in the caller's own DOM
    //   stillWanted optional predicate re-checked after the async lookup
    async function open({ text, cursorIndex, rect, x, highlight, stillWanted }) {
      cancelHide();
      // Already showing the phrase that contains this character: leave it be,
      // so tracking the mouse across a word does not re-render mid-read.
      if (visible && openRange && openRange.text === text &&
          cursorIndex >= openRange.start && cursorIndex < openRange.start + openRange.length) {
        return true;
      }
      if (pointerOverPopup) return false; // user is reading the popup; leave it alone

      const seq = ++lookupSeq;
      let result;
      try {
        result = await chrome.runtime.sendMessage({
          type: 'lookup', text, cursorIndex, exampleCount: settings.exampleCount,
        });
      } catch {
        return false; // extension reloaded / worker unavailable
      }
      if (seq !== lookupSeq || pointerOverPopup) return false;
      if (stillWanted && !stillWanted()) return false;
      if (!result || result.error || !result.matches || result.matches.length === 0) return false;

      clearPageHighlight();
      cancelHide();
      highlighter = highlight || null;
      anchor = { x, rect };
      navHistory = [{ text, cursorIndex }];
      navIndex = 0;
      if (result.highlight) {
        openRange = { text, start: result.highlight.start, length: result.highlight.length };
        if (highlighter) highlighter.set(result.highlight.start, result.highlight.length);
      } else {
        openRange = null;
      }
      visible = true; // before applyResult so positioning runs on the fresh anchor
      applyResult(result, false);
      return true;
    }

    function ownsEvent(e) {
      return !!host && (e.target === host || host.contains(e.target));
    }

    // -----------------------------------------------------------------------
    // Keyboard + global dismissal
    // -----------------------------------------------------------------------

    async function copyText(text) {
      try {
        await navigator.clipboard.writeText(text);
        return true;
      } catch {
        try {
          const ta = document.createElement('textarea');
          ta.value = text;
          ta.style.position = 'fixed';
          ta.style.opacity = '0';
          document.body.append(ta);
          ta.select();
          const ok = document.execCommand('copy');
          ta.remove();
          return ok;
        } catch {
          return false;
        }
      }
    }

    function saveCurrentWord() {
      if (currentWord) toggleSaved(currentWord);
    }

    function copyCurrentWord() {
      if (!currentWord) return;
      const t = `${currentWord.simp}\t${currentWord.trad}\t${currentWord.pinyin}\t${currentWord.defs}`;
      copyText(t).then((ok) => flash(ok ? 'copied ✓' : 'copy failed'));
    }

    function isEditable(target) {
      if (!target) return false;
      const tag = target.tagName;
      return (
        tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' ||
        target.isContentEditable
      );
    }

    function onKeyDown(e) {
      if (!visible || !e.isTrusted) return;
      if (e.key === 'Escape') {
        e.stopPropagation();
        hide();
        return;
      }
      if (isEditable(e.target) || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        const delta = e.key === 'ArrowLeft' ? -1 : 1;
        const target = navIndex + delta;
        if (target >= 0 && target < navHistory.length) {
          e.preventDefault();
          e.stopPropagation();
          navStep(delta);
        }
        return;
      }
      if (!currentWord) return;
      const key = e.key.toLowerCase();
      if (key === 's') {
        e.preventDefault();
        e.stopPropagation();
        saveCurrentWord();
      } else if (key === 'c') {
        e.preventDefault();
        e.stopPropagation();
        copyCurrentWord();
      } else if (key === 'p') {
        e.preventDefault();
        e.stopPropagation();
        speakText(settings.hanziPref === 'trad-first' ? currentWord.trad : currentWord.simp, e.shiftKey);
      }
    }

    function onScroll(e) {
      if (ownsEvent(e)) {
        hideMiniPopup(); // its fixed anchor moved with the popup's content
        return;
      }
      if (pointerOverPopup) return; // wheel over the popup chained to the page
      hide();
    }

    document.addEventListener('keydown', onKeyDown, true);
    document.addEventListener('scroll', onScroll, { passive: true, capture: true });
    window.addEventListener('blur', () => hide());
    document.addEventListener('mousedown', (e) => {
      if (!ownsEvent(e)) hide(); // clicks inside the popup keep it open
    });

    return {
      open,
      hide,
      cancelHide,
      scheduleHide,
      ownsEvent,
      // Abandon an in-flight lookup without closing what is already showing.
      // Callers use this when the pointer leaves lookup-able text: the pending
      // result must not arrive later and open a popup nobody asked for.
      cancelPending: () => { lookupSeq++; },
      isVisible: () => visible,
      isPointerInside: () => pointerOverPopup,
    };
  }

  let instance = null;

  globalThis.ZhongwenPopup = {
    CJK_RE,
    // One popup per document: a second host would mean two panels fighting
    // over the same hover.
    createPopup() {
      if (!instance) instance = build();
      return instance;
    },
  };
})();
