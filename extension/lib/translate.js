// Giving a sentence card an English back that says what it MEANS.
//
// A sentence highlighted in an article — or one the tutor just wrote — is in
// no dictionary and in no example corpus, so lib/cards.js falls back to a
// word-by-word gloss: "看 to see · 了 to finish · 两 two · 次 next in sequence
// · 电影 movie". That tells you which words are present, which is exactly what
// the hover popup already tells you, and not what the sentence says. It is not
// a flashcard back.
//
// So the service worker asks the sync Worker's /api/translate for a real one
// and rewrites the card in place. The sweep below is the decision half, kept
// free of chrome APIs so it can be tested: what to translate, what to do when
// a request fails, and what the new back should read.

export const MAX_PER_SWEEP = 8;

// The back of a translated card. A literal rendering is worth carrying only
// when it differs from the natural one — otherwise it is noise on a card the
// learner reads at speed.
export function translationBack({ translation, literal }) {
  const natural = String(translation || '').trim();
  const word = String(literal || '').trim();
  return word && word !== natural ? `${natural}  (literally: ${word})` : natural;
}

// 4xx statuses that are about the *request* rather than the text, and so say
// nothing about whether this card can ever be translated. 404 is the one that
// bit us: a server deployed before /api/translate existed answers every sweep
// with "not found", and treating that as a verdict on the text marked a whole
// batch of cards unfixable forever — they kept their word-by-word gloss even
// after the endpoint shipped. Auth and timing failures are the same story.
const TRANSIENT_STATUS = new Set([401, 403, 404, 405, 408, 409, 429]);

// Otherwise 4xx means this text will never translate, whatever we do: it is not
// Chinese, it is too long, or the model found nothing translatable in it.
// Retrying it on every sync would spend requests to be told the same thing.
export function isPermanent(status) {
  return status >= 400 && status < 500 && !TRANSIENT_STATUS.has(status);
}

// Translate the glossed cards in `cards`, newest first, up to `limit`.
//
//   isGloss(card)  -> whether this card's back is a machine gloss
//   request(text)  -> { translation, literal }, or throws; a thrown error with
//                     .permanent = true means never retry this card
//   patch(card, changes) -> persist changes against the freshest copy
//
// Returns a summary rather than throwing: a sweep is best-effort background
// work, and the card keeps its gloss when it cannot be improved on.
export async function translateGlossed({
  cards, isGloss, request, patch, limit = MAX_PER_SWEEP, now = () => Date.now(),
}) {
  const pending = (cards || [])
    .filter((card) => card && !card.translateFailed && isGloss(card))
    .slice(0, limit);

  let translated = 0;
  let failed = 0;
  for (const card of pending) {
    let result;
    try {
      result = await request(card.simp);
    } catch (err) {
      if (err && err.permanent) {
        // Remember the refusal so the next sweep does not reconsider it.
        failed++;
        await patch(card, { translateFailed: true });
        continue;
      }
      // Rate limited, offline, or the server is down: everything still pending
      // is still pending. Stop rather than burning through the rest.
      return { translated, failed, stopped: 'transient' };
    }
    const back = translationBack(result);
    if (!back) {
      failed++;
      await patch(card, { translateFailed: true });
      continue;
    }
    await patch(card, {
      defs: back,
      glossed: false,
      // The content changed, so last-write-wins has to see this copy as newer
      // than the glossed one another device already holds.
      lastSavedAt: now(),
    });
    translated++;
  }
  return { translated, failed, stopped: null };
}
