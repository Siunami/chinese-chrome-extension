// Hover-to-define for the extension's OWN pages (review, library, news,
// pronunciation practice, the HSK guides).
//
// Content scripts are not injected into chrome-extension:// pages, so these
// pages cannot get the hover popup the normal way. They get it here instead:
// this module wraps text in per-character hoverable spans and hands the
// hovered position to the same lib/popup.js the content script drives, so the
// panel that opens is the universal one — same definitions, examples,
// character breakdown, related words, save/copy/pronounce controls, and
// back/forward exploration history.
//
// The host page must load lib/popup.js as a classic script before its module
// entry point:  <script src="lib/popup.js"></script>

const { CJK_RE, createPopup } = globalThis.ZhongwenPopup;

const HOVER_CSS = `
  .lookup-char { border-radius: 4px; cursor: help; transition: background 80ms ease; }
  .lookup-char:hover { background: rgba(0, 0, 0, 0.06); }
  .lookup-char.lookup-hit { background: #dfeaff; box-shadow: inset 0 -2px #5b8ee5; }
`;

let cssInjected = false;
function injectHoverCss() {
  if (cssInjected) return;
  cssInjected = true;
  const style = document.createElement('style');
  style.textContent = HOVER_CSS;
  document.head.append(style);
}

// Create one hover controller for a page. `getEnabled` gates hovering (the
// review card only defines after the answer is revealed; everywhere else it is
// always on). `hoverTitle` is the tooltip on each hoverable character.
export function createLookup({ getEnabled = () => true, hoverTitle = '' } = {}) {
  injectHoverCss();
  const popup = createPopup();

  // Paints the matched phrase on the page's own spans. One live highlight at a
  // time: the popup clears the previous one before setting a new one.
  function highlighterFor(source) {
    return {
      set(start, length) {
        for (let i = start; i < start + length; i++) {
          source.spans[i]?.classList.add('lookup-hit');
        }
      },
      clear() {
        for (const s of source.spans) s?.classList.remove('lookup-hit');
      },
    };
  }

  function show(source, cursorIndex, anchor) {
    if (!getEnabled()) return;
    // open() cancels any pending hide before it looks the word up; if nothing
    // comes back, the popup that is already showing has to be let go again.
    popup.open({
      text: source.text,
      cursorIndex,
      rect: anchor.getBoundingClientRect(),
      highlight: highlighterFor(source),
      // The gate can flip while the lookup is in flight — e.g. the review card
      // advances to the next question before the definition comes back.
      stillWanted: () => getEnabled() && anchor.isConnected,
    }).then((shown) => { if (!shown) popup.scheduleHide(); });
  }

  // Make an existing set of per-character spans hoverable. `source` is
  // { text, spans } with spans indexed by code point (holes allowed for
  // punctuation). Pages that already build their own spans for other reasons —
  // pronunciation practice colors them by score — pass theirs in rather than
  // having a second set built around them.
  function attach(source) {
    source.spans.forEach((character, index) => {
      if (!character) return;
      character.classList.add('lookup-char');
      if (hoverTitle) character.title = hoverTitle;
      character.addEventListener('mouseenter', (e) => {
        if (e.buttons) return; // mid drag-select: don't pop up over the selection
        show(source, index, character);
      });
      character.addEventListener('mouseleave', () => popup.scheduleHide());
    });
    return source;
  }

  // Wrap `text` so each CJK character is a hoverable span. The returned element
  // carries `.lookupSource` ({text, spans}) so callers can decorate a phrase
  // inside it (e.g. the target word within an example sentence).
  function hoverable(tag, className, text) {
    const wrap = document.createElement(tag);
    if (className) wrap.className = className;
    const source = { text, spans: [] };
    Array.from(text).forEach((char, index) => {
      if (!CJK_RE.test(char)) {
        wrap.append(document.createTextNode(char));
        return;
      }
      const character = document.createElement('span');
      character.textContent = char;
      source.spans[index] = character;
      wrap.append(character);
    });
    attach(source);
    wrap.lookupSource = source;
    return wrap;
  }

  return {
    hoverable,
    attach,
    hide: () => popup.hide(),
  };
}
