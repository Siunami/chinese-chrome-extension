// Unit tests for extension/lib/chatlog.js — what the tutor's conversation log
// keeps when it cannot keep everything. Attached pictures are the most
// expensive thing the extension stores, so the rules that bound them are worth
// pinning down away from the browser.
// Run: node tests/chatlog.test.mjs

import assert from 'node:assert/strict';
import {
  IMAGE_BUDGET, KEEP_IMAGES, MAX_CHATS, MAX_STORED_TURNS,
  capImages, packChats, prune,
} from '../extension/lib/chatlog.js';

let passed = 0;
function test(name, fn) {
  try {
    fn();
    passed++;
  } catch (e) {
    console.error(`FAIL: ${name}`);
    throw e;
  }
}

// A stored thumbnail is a base64 data URL; its length is what it costs.
const shot = (bytes = 4500) => `data:image/webp;base64,${'A'.repeat(bytes)}`;
const msg = (i, images) => ({ role: i % 2 ? 'assistant' : 'user', content: `m${i}`, ...(images ? { images } : {}) });
const chat = (id, messages) => ({ id, at: 1000, messages });

const imagesIn = (chats) => chats.reduce(
  (n, c) => n + c.messages.filter((m) => m.images && m.images.length).length, 0);
const bytesIn = (chats) => chats.reduce((n, c) => n + c.messages.reduce(
  (m, x) => m + (x.images || []).reduce((s, u) => s + u.length, 0), 0), 0);

// --- per conversation -----------------------------------------------------

test('a long conversation keeps its last turns and drops the rest', () => {
  const messages = Array.from({ length: MAX_STORED_TURNS + 20 }, (_, i) => msg(i));
  const kept = prune(messages);
  assert.equal(kept.length, MAX_STORED_TURNS);
  assert.equal(kept[kept.length - 1].content, `m${MAX_STORED_TURNS + 19}`);
});

test('only the last few messages of a conversation keep their pictures', () => {
  const messages = Array.from({ length: 20 }, (_, i) => msg(i, [shot()]));
  const kept = prune(messages);
  assert.equal(imagesIn([{ messages: kept }]), KEEP_IMAGES);
  // The ones that lost their picture keep everything else about them.
  assert.equal(kept[0].content, 'm0');
  assert.equal(kept[0].images, undefined);
  assert.deepEqual(kept[kept.length - 1].images, [shot()]);
});

// --- across the whole log -------------------------------------------------

test('pictures across every conversation are spent against one budget', () => {
  // Forty conversations of the most a chat may keep: what the per-chat rules
  // alone would have allowed into storage.
  const chats = Array.from({ length: MAX_CHATS }, (_, c) =>
    chat(`c${c}`, Array.from({ length: KEEP_IMAGES }, (_, i) => msg(i, [shot(), shot(), shot()]))));
  const before = bytesIn(chats);
  assert.ok(before > 3_000_000, `expected the unbounded case to be large, got ${before}`);

  const packed = packChats(chats);
  assert.ok(bytesIn(packed) <= IMAGE_BUDGET,
    `over budget: ${bytesIn(packed)} > ${IMAGE_BUDGET}`);
  // Not by throwing the log away — every conversation and every message is
  // still there, and so are the words.
  assert.equal(packed.length, MAX_CHATS);
  assert.equal(packed[0].messages.length, KEEP_IMAGES);
  assert.equal(packed[MAX_CHATS - 1].messages.length, KEEP_IMAGES);
  assert.equal(packed[MAX_CHATS - 1].messages[0].content, 'm0');
});

test('the newest pictures are the ones kept', () => {
  const big = 400_000;
  const chats = [
    chat('newest', [msg(0, [shot(big)])]),
    chat('middle', [msg(0, [shot(big)])]),
    chat('older', [msg(0, [shot(big)])]),
    chat('oldest', [msg(0, [shot(big)])]),
  ];
  const packed = capImages(chats, big * 2 + 100);
  assert.deepEqual(packed.map((c) => !!c.messages[0].images),
    [true, true, false, false]);
});

test('within a conversation the budget is spent from the most recent message back', () => {
  const big = 100_000;
  const messages = [msg(0, [shot(big)]), msg(1, [shot(big)]), msg(2, [shot(big)])];
  const packed = capImages([chat('c', messages)], big + 50);
  assert.deepEqual(packed[0].messages.map((m) => !!m.images), [false, false, true]);
});

test('once the budget runs out the log simply stops having pictures', () => {
  // A small one behind a dropped large one does not slip back in: a history
  // with holes in it is harder to read than one that stops.
  const packed = capImages([chat('c', [
    msg(0, [shot(100)]),
    msg(1, [shot(900_000)]),
    msg(2, [shot(900_000)]),
  ])], 1_000_000);
  assert.deepEqual(packed[0].messages.map((m) => !!m.images), [false, false, true]);
});

test('a log that fits is returned untouched', () => {
  const chats = [chat('a', [msg(0, [shot()]), msg(1)]), chat('b', [msg(0)])];
  const packed = capImages(chats);
  assert.deepEqual(packed, chats);
  assert.equal(packed[0], chats[0], 'a chat that did not change was rebuilt anyway');
});

test('packing keeps the newest conversations and drops the oldest', () => {
  const chats = Array.from({ length: MAX_CHATS + 5 }, (_, i) => chat(`c${i}`, [msg(0)]));
  const packed = packChats(chats);
  assert.equal(packed.length, MAX_CHATS);
  assert.equal(packed[0].id, 'c0');
  assert.equal(packed[MAX_CHATS - 1].id, `c${MAX_CHATS - 1}`);
});

test('packing survives a conversation with nothing in it', () => {
  assert.deepEqual(packChats([{ id: 'c', at: 1 }]), [{ id: 'c', at: 1, messages: [] }]);
  assert.deepEqual(packChats([]), []);
});

console.log(`OK — ${passed} tests passed`);
