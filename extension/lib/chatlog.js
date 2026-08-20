// What the tutor's conversation log keeps when it cannot keep everything.
//
// Attached pictures are far and away the most expensive thing this extension
// stores. Everything else is text measured in bytes per card; a thumbnail is
// about 4.5 KB of base64, and base64 is what it has to be — chrome.storage
// holds JSON, so a Blob or an ArrayBuffer cannot be put in it, and the 33%
// the encoding costs is the price of storing a picture there at all.
//
// The per-conversation rules were already careful: sixty turns kept, and
// pictures only on the last few messages, because a question about a photo
// makes no sense afterwards without the photo but a photo from eight questions
// ago is scrollback. What was missing is a ceiling across the whole log —
// forty conversations each holding six messages of three pictures is around
// 3 MB, and nothing stopped it. So the pictures are also spent against one
// budget, newest first: the ones you might still be looking at are kept, and
// older ones fall back to their words.
//
// Pure functions, no browser APIs, so the policy can be tested without a
// browser — lib/tutor.js is where the storage and the DOM live.

export const MAX_CHATS = 40;        // conversations kept before the oldest is dropped
export const MAX_STORED_TURNS = 60; // messages retained per conversation
export const KEEP_IMAGES = 6;       // trailing messages of a chat that keep pictures

// Characters of base64 across every picture in the log. At the ~4.5 KB a
// 150px thumbnail measures, this is around 330 pictures — a hundred questions
// asked with the full three attachments — after which the oldest give up their
// pictures rather than the log growing without end.
export const IMAGE_BUDGET = 1_500_000;

export function prune(messages) {
  const kept = messages.slice(-MAX_STORED_TURNS);
  return kept.map((msg, i) => (msg.images && i < kept.length - KEEP_IMAGES
    ? { ...msg, images: undefined }
    : msg));
}

const costOf = (images) =>
  images.reduce((n, src) => n + (typeof src === 'string' ? src.length : 0), 0);

// Spend one budget across every picture in the log, newest first. Once it runs
// out everything older loses its pictures, rather than a later small one
// slipping in behind a dropped larger one — a history with holes in it is
// harder to make sense of than one that simply stops having pictures.
export function capImages(chats, budget = IMAGE_BUDGET) {
  let spent = 0;
  let full = false;
  return chats.map((chat) => {
    const messages = (chat.messages || []).slice();
    let changed = false;
    for (let i = messages.length - 1; i >= 0; i--) {
      const images = messages[i] && messages[i].images;
      if (!images || !images.length) continue;
      const cost = costOf(images);
      if (!full && spent + cost <= budget) {
        spent += cost;
        continue;
      }
      full = true;
      messages[i] = { ...messages[i], images: undefined };
      changed = true;
    }
    return changed ? { ...chat, messages } : chat;
  });
}

// Newest first, which is the order they are stored and listed in.
export function packChats(chats) {
  return capImages(
    chats.slice(0, MAX_CHATS)
      .map((chat) => ({ ...chat, messages: prune(chat.messages || []) })),
  );
}
