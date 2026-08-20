# Privacy Policy — Zhongwen Explorer

**Last updated: 13 August 2026**

Zhongwen Explorer is a Chinese-reading and flashcard extension. This policy
describes every piece of data it touches and everywhere that data can go. It
describes the extension as published; the source is at
<https://github.com/Siunami/chinese-chrome-extension>, so any claim here can be
checked against the code rather than taken on trust.

## The short version

**As installed, this extension sends nothing anywhere.** There is no server
behind it, no account to make, no analytics, no telemetry, no advertising, and
no tracking of any kind. The dictionary, the example sentences, the hover
popup, the HSK study guides, saving words, flashcards and spaced-repetition
review all run entirely inside your browser and work offline.

Two optional features change that, and **neither is on unless you deliberately
set it up**:

1. **Phone sync** and **the AI features** need a server. There is no shared
   one — you deploy your own Cloudflare Worker, to your own account, and paste
   its URL into the extension's options page. Your data goes to infrastructure
   you control.
2. **The AI features** additionally need your own API key from an AI provider,
   which you paste in yourself.

If you never do either, nothing described in "What leaves your browser" below
ever happens.

## What is stored on your computer

Stored in your browser's extension storage, on your machine:

- Saved flashcards and their review schedules
- Settings (script preference, voice, example-sentence limits, and so on)
- Your API key, if you paste one
- Your pairing token and server URL, if you set up sync
- Locally kept history: past news articles, tutor conversations (including any
  images you attached), and placement-interview results

A small number of settings — display preferences, not content — are kept in
Chrome's *synced* extension storage. If you are signed into Chrome with sync
enabled, Google replicates those settings across your own devices under your own
Google account, the same way it does for your bookmarks. No learning content, no
cards, and no credentials are put there.

You can export all of this to a file, and delete it, from the extension's
options page. Uninstalling the extension removes it from your computer.

## What never leaves your browser

- **Your browsing history.** The extension never records, transmits or stores
  which pages you visit. Cards carry no URL, no page title and no referrer.
- **Page content**, except in the one narrow case described immediately below.
- **Anything at all**, if you have not configured a server.

## What leaves your browser, if you set up a server

All of the following goes to **the Cloudflare Worker you deployed yourself**.
The author of this extension does not operate a server for it and cannot see
any of it.

**Phone sync (`/api/sync`)** sends your flashcards so your phone can show them.
A card is either a word or a single sentence. **Sentence cards contain the text
you highlighted when you saved them**, which — if you saved it from a web page —
is a sentence of that page's content. This is the one case where page content
leaves your browser, it only ever covers text you deliberately chose to save as
a card, and it never includes the address of the page it came from. Cards are
stored in your Worker's D1 database until you delete them.

**The AI features** send, depending on which one you use:

- *News digest* (`/api/news`): word statistics only — a list of the Chinese
  words you are studying, know, recently saved, or keep failing, plus counts and
  any topic you searched for. No page content, no history.
- *Tutor* (`/api/ask`): your question, the text visible on the extension's own
  page at the time (a study guide, a flashcard, a news passage, or your saved
  word list), anything you highlighted there, recent turns of that conversation,
  the same word statistics as above, and any image you attached. The tutor is
  only available on the extension's own pages — it is never present on the web
  pages you browse and cannot read them.
- *Translation* (`/api/translate`): the short Chinese text being translated.
- *Placement interview* (`/api/placement`): your typed answers, the interview
  transcript so far, and the same word statistics.

**Your IP address** reaches your Worker as it does any web server. It is used
for one thing — limiting how many new pairings can be created per hour, to stop
your own deployment being abused — and what is retained is a coarsened form: for
IPv6, only the network prefix (`/64`), not the full address.

## Your API key

If you use the AI features, you provide your own key from OpenAI, Azure OpenAI
or fal.ai.

- It is stored in your browser's local extension storage.
- It is sent, over HTTPS, with each AI request to your own Worker.
- Your Worker forwards it to the AI provider to authorise that single request,
  then discards it. It is **never written to the database and never written to
  logs**.
- It pays only for your own usage.

You can remove it at any time from the options page. You can also exclude it,
and your pairing token, when exporting a backup file.

## Third parties

- **Your AI provider** (OpenAI, Azure OpenAI, or fal.ai — whichever key you
  supply) receives the content listed under "The AI features" above and handles
  it under *their* privacy policy and data-retention terms, not this one. If
  this matters to you, read theirs before pasting a key.
- **Google News RSS** is queried to ground the news digest in real headlines.
  Those requests are made by your Worker, not by your browser: they carry no
  identifier of you, no cookie of yours, and nothing about your deck.
- **Cloudflare** hosts the Worker and database you deployed, under your own
  Cloudflare account and their terms.

There are no other third parties. No analytics provider, no error-reporting
service, no advertiser, no data broker.

## Data we sell or share

None. Data is never sold, rented, or shared with anyone, and is never used for
advertising, profiling, or credit assessment. It is not used to train any model
beyond whatever your chosen AI provider does under its own terms.

## Children

This extension is a language-learning tool with no social features, no user
accounts and no content submitted to the author. It is not directed at children
under 13, and collects nothing that would identify them or anyone else.

## Permissions, and why each is needed

- `storage`, `unlimitedStorage` — keep your cards, settings and history on your
  computer, without a 10 MB ceiling that would silently drop your saved data.
- `tts` — read Chinese aloud using the voices already on your machine. Nothing
  is sent to a speech service; there is no paid speech anywhere in this
  extension.
- `alarms` — schedule the periodic sync, when you have turned sync on.
- Access to the pages you visit (`<all_urls>`) — required for the core feature:
  showing a dictionary popup for the Chinese text under your cursor, on whatever
  page you are reading. The reading happens locally, in the page, against the
  bundled dictionary. Nothing about the page is transmitted, and no page content
  is stored unless you explicitly save a sentence as a flashcard.

## Changes

Material changes will be published in this file, with the date above updated,
and are visible in the repository's commit history.

## Contact

Questions, or a privacy problem to report: open an issue at
<https://github.com/Siunami/chinese-chrome-extension/issues>.
