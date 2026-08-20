# Chrome Web Store submission notes

Everything the Developer Dashboard asks for, written once so a resubmission
does not become an exercise in remembering what was claimed last time. The
answers here have to stay true to the code; if a permission changes, this file
changes with it.

Privacy policy URL to give the dashboard:
<https://github.com/Siunami/chinese-chrome-extension/blob/main/docs/PRIVACY.md>

---

## Single purpose

> **Zhongwen Explorer helps a reader of Chinese understand the text in front of
> them and remember the words they meet.**

Every surface serves that one purpose: the hover popup defines the word under
the cursor, saving turns a word into a flashcard, review brings it back on a
spaced-repetition schedule, and the study guides, news digest and tutor are
reading material and explanation pitched at the level the learner is at.

### Why the New Tab page is overridden

This is the part a reviewer is most likely to question, so answer it directly
rather than waiting to be asked.

The New Tab page is the extension's review dashboard: cards due today, the
saved-word library, and the news digest. Spaced repetition only works if the
learner actually sees the queue, and a flashcard tool that has to be hunted for
in a menu is one that goes unused — putting the due count where a new tab
already goes is the feature, not a way to capture the surface.

It is not a search hijack and not monetised. It renders the extension's own
local data, and contains no ads, no sponsored links, and no search box that
redirects traffic. As installed it makes no network request on load at all; if
the user has configured their own sync server, it may make one cached status
request to *that* server — the one they deployed themselves — at most once every
six hours. A user who does not want the page can disable the extension or use
any of the standard New Tab replacements, which take precedence normally.

---

## Permission justifications

Paste each into the matching field in the dashboard.

**`storage`**
> Stores the user's saved flashcards, review schedules and settings locally in
> the browser. This is the core of the extension: without it nothing the learner
> saves survives a restart.

**`unlimitedStorage`**
> A learner's deck, plus locally kept news articles and tutor conversations,
> can exceed the default 10 MB quota. Without this permission Chrome silently
> refuses further writes, which appears to the user as losing their saved
> progress. It stores no more data than the features already described — it only
> removes a ceiling that would corrupt the experience.

**`tts`**
> Reads Chinese words and sentences aloud using the speech voices already
> installed on the user's own machine, so a learner can hear a word's
> pronunciation. No audio and no text is sent to any speech service; there is no
> remote speech component in this extension.

**`alarms`**
> Schedules the periodic background sync of flashcards to the user's own
> self-hosted server, and only runs when the user has explicitly configured that
> server. Alarms are used rather than timers because a service worker is
> suspended between events.

**Host permission — content script on `<all_urls>`**
> The extension's primary feature is showing a dictionary definition for the
> Chinese text under the user's cursor on any page they are reading. Chinese
> text appears on any website, so the feature cannot be scoped to a list of
> domains without making it fail exactly where a learner needs it.
>
> The content script reads only the text node under the cursor, and does so
> locally against a dictionary bundled inside the extension. No page content, no
> URL, and no browsing history is transmitted or stored. The one exception is
> explicit and user-initiated: if the user highlights a sentence and chooses
> "Save", that sentence becomes a flashcard stored locally — and if they have
> separately configured their own sync server, it syncs there like any other
> card.

**Remote code**
> None. All code executes from files inside the package. Nothing is fetched and
> evaluated at runtime.

---

## Data-use disclosures

Tick these in the dashboard, and no others. They must match `docs/PRIVACY.md`.

| Category | Collected? | Why |
| --- | --- | --- |
| Personally identifiable information | **No** | No accounts, no names, no email, no address. |
| Health information | No | — |
| Financial and payment information | **No** | The API key is a credential the user supplies for their own use, forwarded to their chosen AI provider and never retained. No payment data is handled. |
| Authentication information | **Yes** | The user's own AI provider API key, and the sync pairing token, are stored locally so the features can work. Neither is transmitted to the developer. |
| Personal communications | **Yes** | Questions typed to the tutor, and answers typed during the placement interview, are sent to the user's own server and their own AI provider to be answered. |
| Location | No | — |
| Web history | **No** | No URL, page title or referrer is ever recorded or transmitted. |
| User activity | **No** | No analytics, no clickstream, no interaction monitoring of any kind. |
| Website content | **Yes** | Only text the user explicitly highlights and saves as a flashcard, or highlights to ask the tutor about. Never automatic page scraping. |

Then certify all three:

- Not being sold to third parties — **true**
- Not being used or transferred for purposes unrelated to the item's single
  purpose — **true**
- Not being used or transferred to determine creditworthiness or for lending
  purposes — **true**

---

## Listing copy

**Name:** Zhongwen Explorer

**Short description** (132 char limit; current manifest text is 116):
> Hover over Chinese text for an instant popup with pinyin, concise CC-CEDICT
> definitions, and real example sentences.

**Detailed description** — lead with what works with no setup, because that is
almost everything, then mention the optional self-hosted parts honestly:

> Point at any Chinese text and get pinyin, clear definitions and real example
> sentences — instantly, on any page.
>
> • Pleco-style word segmentation: hover the 欢 in 喜欢 and you get 喜欢, not a
>   single character
> • Tap into a definition to explore the characters inside it, with back and
>   forward history
> • Save any word or sentence as a flashcard, and review it on a proven
>   spaced-repetition schedule
> • HSK 1–9 study guides with reading passages, grammar and vocabulary
> • Reads words aloud using your computer's own voices
>
> All of the above works offline, with no account, no server and no sign-up.
> The dictionary is bundled inside the extension.
>
> Optional, and off unless you set them up yourself: sync your deck to your
> phone, and AI features (a personalized news digest, a tutor, a placement
> interview). These run through a Cloudflare Worker you deploy to your own
> account, using your own AI API key. There is no shared server — your cards
> and your key never pass through anyone else's infrastructure.
>
> Open source: https://github.com/Siunami/chinese-chrome-extension

**Category:** Education
**Screenshots:** `docs/shots/` — regenerate with `node scripts/screenshots.mjs`.
Store requires 1280×800 or 640×400; check the output matches before uploading.

---

## Packaging

The uploaded ZIP is the contents of `extension/`, with `manifest.json` at the
root of the archive — not a folder containing it.

```sh
cd extension && zip -r ../zhongwen-explorer.zip . -x '.*' -x '__MACOSX/*'
```

About 14 MB, most of it `data/dict.tsv` and `data/sentences.tsv`. That is the
product — the dictionary is bundled precisely so lookups need no server — and it
is well inside the store's limit.

`data/LICENSE.md` ships with it deliberately: the dictionary is CC BY-SA, and
those terms travel with the data into the package.

---

## Before each submission

1. `node scripts/extension-smoke.mjs` — drives the real pages in headless Chrome
2. `for f in tests/*.test.mjs; do node "$f" || break; done`
3. Bump `version` in `extension/manifest.json` (the store rejects a re-upload of
   an existing version)
4. Confirm `DEFAULT_SERVER_URL` in `extension/lib/sync.js` is still empty — a
   build that ships pointed at someone's deployment silently makes them the
   custodian of every installer's deck, and changes the privacy answers above
5. Check `docs/PRIVACY.md` still describes what the code does

### Expect a slower review

An `<all_urls>` content script and a New Tab override are each reviewed by hand,
and together they are the combination most associated with abusive extensions.
Nothing here is abusive, but budget for a longer first review and be ready to
answer the New Tab question in the words above.
