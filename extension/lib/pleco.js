// Reading a Pleco flashcard export.
//
// Pleco is where a lot of people's Chinese already lives, and its cards are
// the words they have actually looked up — a far better starting deck than
// anything this extension could guess. It exports two ways and this reads
// both, because which one you get depends on a menu most people click through
// without reading:
//
//   XML  — "Export Cards" -> Pleco Flashcard File. One <card> per card, with
//          separate <headword> elements for the simplified and traditional
//          forms, numbered pinyin in <pron>, and <defn> for the definition.
//   Text — "Export Cards" -> Text File. One card per line, tab separated:
//          `headword <tab> pinyin <tab> definition`, with the traditional form
//          folded into the headword as 简[繁]. This is the same shape the
//          library's own TSV export writes, so a deck can round-trip.
//
// Parsing only. Nothing here touches the dictionary or builds a card: the
// caller hands each headword to the background worker, which resolves it
// against CC-CEDICT exactly as it would a word saved from a page, and falls
// back to these fields when the dictionary has never heard of it.
//
// The XML is read with regexes rather than DOMParser so this module stays a
// plain function testable in Node — the same trade the Worker makes for RSS.
// A Pleco export is machine-written and flat, so there is no nesting to lose.

const CJK = /[㐀-鿿豈-﫿]/;

// `dian4nao3` -> `dian4 nao3`. Pleco writes numbered pinyin unspaced; CC-CEDICT
// (and parsePinyin, which turns it into tone marks) wants one syllable per
// token. Text that is already tone-marked has no digits and passes through.
export function spacePlecoPinyin(pinyin) {
  return String(pinyin || '')
    .replace(/([1-5])(?=[a-zA-ZüÜ])/g, '$1 ')
    .replace(/\s+/g, ' ')
    .trim();
}

// `电脑[電腦]` -> { simp: '电脑', trad: '電腦' }. A headword with no bracket has
// the same form in both scripts as far as we can tell from the file.
export function splitHeadword(raw) {
  const text = String(raw || '').trim();
  const m = /^(.+?)\s*[[［]\s*(.+?)\s*[\]］]$/.exec(text);
  if (m) return { simp: m[1].trim(), trad: m[2].trim() };
  return { simp: text, trad: text };
}

const tagContent = (block, tag, attrs = '') => {
  const re = new RegExp(`<${tag}\\b${attrs}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i');
  const m = block.match(re);
  return m ? decodeEntities(m[1]).replace(/\s+/g, ' ').trim() : '';
};

function decodeEntities(s) {
  return String(s)
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&amp;/g, '&'); // last, or &amp;lt; decodes twice
}

function parseXml(text) {
  const items = [];
  for (const [, block] of text.matchAll(/<card\b[^>]*>([\s\S]*?)<\/card>/gi)) {
    const simp = tagContent(block, 'headword', '[^>]*charset="sc"');
    const trad = tagContent(block, 'headword', '[^>]*charset="tc"');
    // A card with one <headword> and no charset attribute is still a card.
    const only = simp || trad ? '' : tagContent(block, 'headword');
    items.push({
      simp: simp || only || trad,
      trad: trad || only || simp,
      pinyin: spacePlecoPinyin(tagContent(block, 'pron')),
      defs: tagContent(block, 'defn'),
    });
  }
  return items;
}

function parseText(text) {
  const items = [];
  for (const line of String(text).split(/\r?\n/)) {
    const row = line.trim();
    if (!row || row.startsWith('//') || row.startsWith('#')) continue;
    const [head = '', pinyin = '', ...rest] = row.split('\t');
    const { simp, trad } = splitHeadword(head);
    items.push({
      simp,
      trad,
      pinyin: spacePlecoPinyin(pinyin),
      // Pleco puts the whole definition in one field, but a stray tab inside it
      // would otherwise truncate the card silently.
      defs: rest.join(' ').replace(/\s+/g, ' ').trim(),
    });
  }
  return items;
}

/**
 * Parse an export into card candidates.
 *
 * Returns { items, format, skipped } — `skipped` counts rows that carried no
 * Chinese at all (a header line, a category name, an English-only note), which
 * are dropped rather than turned into cards nobody can review.
 */
export function parsePlecoExport(text) {
  const raw = String(text || '');
  const format = /^\s*(<\?xml|<plecoflash|<cards\b)/i.test(raw) ? 'xml' : 'text';
  const parsed = format === 'xml' ? parseXml(raw) : parseText(raw);

  const items = [];
  const seen = new Set();
  let skipped = 0;
  for (const item of parsed) {
    const simp = (item.simp || '').trim();
    const trad = (item.trad || '').trim();
    if (!CJK.test(simp) && !CJK.test(trad)) { skipped++; continue; }
    const key = `${simp}|${trad}`;
    if (seen.has(key)) continue; // the same word twice in one file is one card
    seen.add(key);
    items.push({ simp: simp || trad, trad: trad || simp, pinyin: item.pinyin, defs: item.defs });
  }
  return { items, format, skipped };
}
