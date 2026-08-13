// Convergence tests for the sync protocol: two simulated clients talking to
// an in-memory server that implements the same merge + version-cursor logic
// as worker/src/index.js. Run: node tests/sync-protocol.test.mjs

import assert from 'node:assert/strict';
import {
  cardKey, mergeCards, changedSince, applyRemote, tombstoneFor,
} from '../extension/lib/merge.js';
import { schedule } from '../extension/lib/srs.js';

const NOW = 1_800_000_000_000;
const MIN = 60 * 1000;
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

// In-memory stand-in for the Worker: rows keyed by card_key, per-user version
// counter, POST /api/sync semantics (merge incoming, return rows > since).
class Server {
  constructor() {
    this.rows = new Map(); // key -> { doc, version }
    this.version = 0;
  }

  sync({ since = 0, cards = [] }) {
    this.version += 1;
    for (const doc of cards) {
      const key = cardKey(doc);
      const existing = this.rows.get(key);
      this.rows.set(key, {
        doc: mergeCards(existing?.doc, doc),
        version: this.version,
      });
    }
    const out = [];
    for (const { doc, version } of this.rows.values()) {
      if (version > since) out.push(doc);
    }
    return { version: this.version, cards: out };
  }
}

// Client replica: mirrors extension/lib/sync.js state and sync step.
class Client {
  constructor(server) {
    this.server = server;
    this.cards = [];
    this.tombstones = [];
    this.cursor = 0;
    this.lastPushAt = 0;
  }

  save(over, now) {
    const key = cardKey({ cardType: 'word', trad: '', ...over });
    const idx = this.cards.findIndex((c) => cardKey(c) === key);
    if (idx !== -1) {
      const c = this.cards.splice(idx, 1)[0];
      c.touches = (c.touches || 1) + 1;
      c.lastSavedAt = now;
      if (over.defs) c.defs = over.defs;
      this.cards.unshift(c);
    } else {
      this.cards.unshift({
        cardType: 'word', trad: '', pinyin: '', tones: '', defs: '',
        savedAt: now, lastSavedAt: now, touches: 1, srs: null, sourceWord: '',
        ...over,
      });
    }
  }

  grade(simp, g, now) {
    const c = this.cards.find((x) => x.simp === simp);
    c.srs = schedule(c.srs, g, now);
  }

  remove(simp, now) {
    const idx = this.cards.findIndex((x) => x.simp === simp);
    const [c] = this.cards.splice(idx, 1);
    this.tombstones.unshift(tombstoneFor(c, now));
  }

  sync(now) {
    const push = changedSince(this.cards, this.tombstones, this.lastPushAt);
    const res = this.server.sync({ since: this.cursor, cards: push });
    const merged = applyRemote(this.cards, this.tombstones, res.cards);
    this.cards = merged.cards;
    this.tombstones = merged.tombstones;
    this.cursor = res.version;
    this.lastPushAt = now;
  }

  find(simp) {
    return this.cards.find((c) => c.simp === simp);
  }
}

function convergedState(client) {
  return {
    cards: client.cards.map((c) => [cardKey(c), c]),
    tombstones: client.tombstones.map((t) => cardKey(t)).sort(),
  };
}

function assertConverged(a, b) {
  assert.deepEqual(convergedState(a), convergedState(b));
}

test('save on extension appears on phone; grade on phone returns to extension', () => {
  const server = new Server();
  const ext = new Client(server);
  const phone = new Client(server);
  let t = NOW;

  ext.save({ simp: '喜欢', pinyin: 'xǐ huan', defs: 'to like' }, t);
  ext.sync(t += MIN);
  phone.sync(t += MIN);
  assert.ok(phone.find('喜欢'), 'card arrived on phone');

  phone.grade('喜欢', 'good', t += MIN);
  phone.sync(t += MIN);
  ext.sync(t += MIN);
  assert.equal(ext.find('喜欢').srs.reps, 1, 'review arrived back');
  assertConverged(ext, phone);
});

test('offline review + concurrent re-save on the other device both survive', () => {
  const server = new Server();
  const ext = new Client(server);
  const phone = new Client(server);
  let t = NOW;

  ext.save({ simp: '面', pinyin: 'miàn', defs: 'noodles' }, t);
  ext.sync(t += MIN);
  phone.sync(t += MIN);

  // phone reviews offline; extension re-saves with fresher defs meanwhile
  phone.grade('面', 'easy', t += MIN);
  ext.save({ simp: '面', pinyin: 'miàn', defs: 'noodles; flour' }, t += MIN);
  ext.sync(t += MIN);
  phone.sync(t += MIN);
  ext.sync(t += MIN);

  for (const c of [ext.find('面'), phone.find('面')]) {
    assert.equal(c.defs, 'noodles; flour', 'later re-save content kept');
    assert.equal(c.srs.reps, 1, 'offline review kept');
    assert.equal(c.touches, 2);
  }
  assertConverged(ext, phone);
});

test('delete propagates; a later review on the other device resurrects', () => {
  const server = new Server();
  const ext = new Client(server);
  const phone = new Client(server);
  let t = NOW;

  ext.save({ simp: 'A', pinyin: 'a' }, t);
  ext.save({ simp: 'B', pinyin: 'b' }, t);
  ext.sync(t += MIN);
  phone.sync(t += MIN);

  // simple delete propagates
  ext.remove('A', t += MIN);
  ext.sync(t += MIN);
  phone.sync(t += MIN);
  assert.equal(phone.find('A'), undefined, 'delete reached phone');

  // delete on ext, but phone reviews B *after* the deletion time → resurrect
  ext.remove('B', t += MIN);
  phone.grade('B', 'good', t += 2 * MIN);
  ext.sync(t += MIN);
  phone.sync(t += MIN);
  ext.sync(t += MIN);
  assert.ok(ext.find('B'), 'later review resurrected the card on ext');
  assert.equal(ext.find('B').srs.reps, 1);
  assertConverged(ext, phone);
});

test('both devices grade the same card while offline: later grade wins, progress never resets', () => {
  const server = new Server();
  const ext = new Client(server);
  const phone = new Client(server);
  let t = NOW;

  ext.save({ simp: 'C', pinyin: 'c' }, t);
  ext.grade('C', 'good', t += MIN);
  ext.sync(t += MIN);
  phone.sync(t += MIN);

  ext.grade('C', 'good', t += MIN); // earlier offline grade
  phone.grade('C', 'again', t += MIN); // later offline grade
  ext.sync(t += MIN);
  phone.sync(t += MIN);
  ext.sync(t += MIN);

  assert.deepEqual(ext.find('C').srs, phone.find('C').srs);
  assert.equal(ext.find('C').srs.reviewedAt, NOW + 5 * MIN, 'later grade won');
  assertConverged(ext, phone);
});

test('sync is idempotent: repeating a sync changes nothing', () => {
  const server = new Server();
  const ext = new Client(server);
  const phone = new Client(server);
  let t = NOW;
  ext.save({ simp: 'D', pinyin: 'd' }, t);
  ext.grade('D', 'good', t += MIN);
  ext.sync(t += MIN);
  phone.sync(t += MIN);
  const before = JSON.stringify(convergedState(phone));
  phone.sync(t += MIN);
  phone.sync(t += MIN);
  assert.equal(JSON.stringify(convergedState(phone)), before);
});

test('three-way churn converges: random-ish interleaving of ops', () => {
  const server = new Server();
  const ext = new Client(server);
  const phone = new Client(server);
  let t = NOW;
  const words = ['一', '二', '三', '四', '五', '六', '七', '八'];
  words.forEach((w, i) => ext.save({ simp: w, pinyin: `p${i}` }, t + i));
  t += MIN;
  ext.sync(t += MIN);
  phone.sync(t += MIN);

  phone.grade('一', 'good', t += MIN);
  ext.remove('二', t += MIN);
  phone.grade('三', 'easy', t += MIN);
  ext.save({ simp: '三', defs: 'three (updated)', pinyin: 'p2' }, t += MIN);
  phone.remove('四', t += MIN);
  ext.grade('五', 'again', t += MIN);
  phone.save({ simp: '九', pinyin: 'p8' }, t += MIN);

  // several rounds until quiescent
  for (let i = 0; i < 3; i++) {
    ext.sync(t += MIN);
    phone.sync(t += MIN);
  }
  assertConverged(ext, phone);
  assert.ok(!ext.find('二') && !ext.find('四'));
  assert.equal(ext.find('三').defs, 'three (updated)');
  assert.equal(ext.find('三').srs.reps, 1);
  assert.ok(ext.find('九'));
});

console.log(`OK — ${passed} tests passed`);
