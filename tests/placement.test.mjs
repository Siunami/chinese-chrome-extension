// The placement interview, both halves.
//
// The ladder (extension/lib/placement.js) is where the interview's honesty
// lives: it decides which level to probe next, when there is enough evidence
// to stop, and what the marks add up to. None of that involves a model, so
// none of it is tested with one — the cases below are the sequences of marks a
// real run produces, driven straight through the rules.
//
// The endpoint half checks the guards, the rate limit, and the two things the
// Worker must not let the model do: pick a level the ladder ruled out, and
// return a result on a turn that is not the last one.
// Run: node tests/placement.test.mjs

import assert from 'node:assert/strict';
import worker from '../worker/src/index.js';
import { fakeDb, stubModel } from './fake-d1.mjs';
import {
  MAX_TURNS, MIN_TURNS, MAX_PROBES_PER_LEVEL, SUSTAIN, FLOOR,
  MAX_FULL_RESULTS, MAX_RESULTS, MODEL_HISTORY_LIMIT,
  turnScore, verdictOf, estimate, planNext, rubricFor,
  trimResults, summarizeResult, progression, placementDigest,
} from '../extension/lib/placement.js';

let passed = 0;
const failures = [];
async function test(name, fn) {
  try {
    await fn();
    passed++;
  } catch (e) {
    failures.push(`${name}\n    ${e.message.split('\n')[0]}`);
  }
}

// A marked turn at `level`. `mark` is the score out of 3 given to both
// comprehension and production, which is how a run reads in practice.
const turn = (level, mark, extra = {}) => ({
  level,
  assess: { comprehension: mark, production: mark, errors: [], comment: '', ...extra },
});

// Drive the ladder through a run whose answers are decided by `answer(level)`.
// Returns every turn asked, which is what estimate() consumes.
function runInterview(answer, { startLevel = 3, maxTurns = MAX_TURNS } = {}) {
  const turns = [];
  for (let i = 0; i < 40; i++) {
    const plan = planNext(turns, { startLevel, maxTurns });
    if (plan.done) return { turns, reason: plan.reason };
    assert.ok(plan.allowed.includes(plan.level), 'the preferred level must be in its own band');
    turns.push(turn(plan.level, answer(plan.level)));
  }
  throw new Error('the ladder never terminated');
}

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

await test('a mark is comprehension and production out of three, together', () => {
  assert.equal(turnScore({ comprehension: 3, production: 3 }), 1);
  assert.equal(turnScore({ comprehension: 0, production: 0 }), 0);
  assert.equal(turnScore({ comprehension: 3, production: 0 }), 0.5);
});

await test('a missing or malformed mark scores zero rather than throwing', () => {
  assert.equal(turnScore(null), 0);
  assert.equal(turnScore({}), 0);
  assert.equal(turnScore({ comprehension: 'lots', production: null }), 0);
});

await test('marks out of range are clamped, not trusted', () => {
  assert.equal(turnScore({ comprehension: 99, production: 99 }), 1);
  assert.equal(turnScore({ comprehension: -5, production: -5 }), 0);
});

await test('a level is held, shaky or lost by where its mean falls', () => {
  assert.equal(verdictOf([1]), 'sustained');
  assert.equal(verdictOf([SUSTAIN]), 'sustained');
  assert.equal(verdictOf([0.5]), 'partial');
  assert.equal(verdictOf([FLOOR]), 'struggled');
  assert.equal(verdictOf([0]), 'struggled');
  assert.equal(verdictOf([]), 'untested');
});

// ---------------------------------------------------------------------------
// The ladder
// ---------------------------------------------------------------------------

await test('the first task sits one level below the guess, so it can be answered', () => {
  const plan = planNext([], { startLevel: 5 });
  assert.equal(plan.level, 4);
  assert.equal(plan.done, false);
});

await test('opening at HSK 1 cannot fall off the bottom of the scale', () => {
  assert.equal(planNext([], { startLevel: 1 }).level, 1);
});

await test('holding a level offers a harder one; losing it offers an easier one', () => {
  assert.equal(planNext([turn(4, 3)], { startLevel: 5 }).level, 5);
  assert.equal(planNext([turn(4, 0)], { startLevel: 5 }).level, 3);
});

await test('the band offered is the level either side, and never one already ruled out', () => {
  const plan = planNext([turn(4, 3)], { startLevel: 5 });
  assert.deepEqual(plan.allowed, [3, 4, 5]);
  // Two tasks at 4 closes it; the examiner may no longer hold there.
  const full = planNext([turn(4, 3), turn(4, 2), turn(5, 1)], { startLevel: 5 });
  assert.ok(!full.done);
  assert.ok(!full.allowed.includes(4), `4 was probed ${MAX_PROBES_PER_LEVEL} times already`);
});

await test('a shaky level is asked about again, then treated as the ceiling', () => {
  const once = planNext([turn(4, 2)], { startLevel: 4 });
  assert.equal(once.level, 4, 'one shaky answer is not an answer');
  // Two shaky answers at the same level, with both neighbours already closed,
  // is the search settling rather than a reason to keep going.
  const run = [turn(3, 3), turn(3, 3), turn(5, 0), turn(5, 0), turn(4, 2), turn(4, 2)];
  assert.equal(planNext(run, { startLevel: 4 }).done, true);
});

await test('a run always asks at least the minimum before it reports a number', () => {
  // Collapses immediately: held HSK 2, lost HSK 3 on the first two answers.
  const { turns } = runInterview((level) => (level <= 2 ? 3 : 0), { startLevel: 3 });
  assert.ok(turns.length >= MIN_TURNS,
    `stopped after ${turns.length} questions, below the ${MIN_TURNS} minimum`);
});

await test('every run terminates, at or under the turn cap', () => {
  // Every shape of learner the ladder can meet, including the awkward ones.
  const shapes = {
    'strong beginner': (l) => (l <= 2 ? 3 : 0),
    'solid intermediate': (l) => (l <= 5 ? 3 : 1),
    'near native': () => 3,
    'no chinese at all': () => 0,
    'uniformly shaky': () => 2,
    'gappy — good low, good high, bad middle': (l) => (l === 4 ? 0 : 3),
  };
  for (const [name, answer] of Object.entries(shapes)) {
    for (const startLevel of [1, 3, 5, 9]) {
      const { turns } = runInterview(answer, { startLevel });
      assert.ok(turns.length <= MAX_TURNS,
        `${name} from ${startLevel} ran to ${turns.length} turns`);
      assert.ok(turns.length > 0, `${name} from ${startLevel} asked nothing`);
    }
  }
});

await test('topping out at HSK 9 ends the run rather than trying for a tenth level', () => {
  const { turns } = runInterview(() => 3, { startLevel: 8 });
  assert.ok(turns.every((t) => t.level <= 9), 'asked above the top of the scale');
  assert.equal(estimate(turns).level, 9);
});

await test('answering nothing anywhere places below HSK 1', () => {
  const { turns } = runInterview(() => 0, { startLevel: 3 });
  assert.ok(turns.every((t) => t.level >= 1), 'asked below the bottom of the scale');
  assert.equal(estimate(turns).level, 0);
});

// ---------------------------------------------------------------------------
// What the run adds up to
// ---------------------------------------------------------------------------

await test('the level is the highest held, and the guides open one above it', () => {
  const summary = estimate([turn(3, 3), turn(4, 3), turn(5, 0)]);
  assert.equal(summary.level, 4);
  assert.equal(summary.studyLevel, 5);
});

await test('a level held above one that came apart is a gap, not a placement', () => {
  // Lost HSK 3, then sustained 5. HSK is cumulative, so the honest reading is
  // the top of the range held BEFORE the first thing that broke.
  const summary = estimate([turn(2, 3), turn(3, 0), turn(5, 3)]);
  assert.equal(summary.level, 2);
});

await test('every level gets a row, including the ones never asked about', () => {
  const summary = estimate([turn(4, 3), turn(5, 1)]);
  assert.equal(summary.perLevel.length, 9);
  assert.deepEqual(summary.perLevel.map((r) => r.level), [1, 2, 3, 4, 5, 6, 7, 8, 9]);
  assert.equal(summary.perLevel[0].verdict, 'untested');
  assert.equal(summary.perLevel[0].score, null);
  assert.equal(summary.perLevel[3].verdict, 'sustained');
  assert.equal(summary.perLevel[3].probes, 1);
});

await test('confidence rises with a bracket, and with evidence at the boundary', () => {
  // Nothing failed: no ceiling was found, so no number to be confident about.
  assert.equal(estimate([turn(3, 3), turn(4, 3)]).confidence, 'low');
  // A level held and a level lost, on one question each.
  assert.equal(estimate([turn(3, 3), turn(4, 0)]).confidence, 'medium');
  // The same bracket, twice over, in a full-length run.
  const full = [
    turn(2, 3), turn(3, 3), turn(3, 3), turn(4, 0), turn(4, 0),
    turn(3, 3), turn(2, 3), turn(4, 1),
  ];
  assert.equal(estimate(full).confidence, 'high');
});

await test('an abandoned run still reports, at low confidence', () => {
  // One good answer at HSK 3 is a level held, so it is reported — but nothing
  // above it was ever asked, so there is no ceiling and no confidence in it.
  const summary = estimate([turn(3, 3)]);
  assert.equal(summary.level, 3);
  assert.equal(summary.bracketed, false, 'a run with no failure cannot have found a ceiling');
  assert.equal(summary.confidence, 'low');
  assert.equal(summary.turns, 1);
});

await test('unmarked turns are not counted as zeros', () => {
  // The last turn of a run is unmarked until the closing call comes back, and
  // a run stopped early never marks it at all. Scoring it as a zero would
  // drag every placement down by one bad answer nobody gave.
  const summary = estimate([turn(4, 3), turn(4, 3), { level: 9, assess: null }]);
  assert.equal(summary.turns, 2);
  assert.equal(summary.perLevel[8].verdict, 'untested');
  assert.equal(summary.level, 4);
});

// ---------------------------------------------------------------------------
// The kept history
//
// The interview can be sat as often as the learner likes, and the pile of
// sittings is the only thing in the app that measures rather than counts. What
// is bounded is the bulk of an old sitting, never the fact that it happened.
// ---------------------------------------------------------------------------

// A stored result, as complete() writes one.
const sitting = (at, level, over = {}) => ({
  at,
  level,
  confidence: 'high',
  studyLevel: level + 1,
  perLevel: [],
  turns: 12,
  comprehension: 2.4,
  production: 2.1,
  report: { summary: `Held ${level}.`, strengths: ['tones'], gaps: ['了'], advice: ['read more'] },
  transcript: [{ level, prompt: '你好吗？', answer: '很好。', assess: { comprehension: 3, production: 3 } }],
  ...over,
});

await test('a new sitting goes on the front, and nothing already there is dropped', () => {
  // Newest first, which is the order the key is stored in.
  const before = Array.from({ length: 40 }, (_, i) => sitting(1039 - i, 3));
  const after = trimResults([sitting(9999, 4), ...before]);
  assert.equal(after.length, 41);
  assert.equal(after[0].at, 9999);
  assert.equal(after[after.length - 1].at, 1000, 'the oldest sitting was lost');
});

await test('older sittings keep their numbers and lose their bulk', () => {
  const results = trimResults(
    Array.from({ length: MAX_FULL_RESULTS + 5 }, (_, i) => sitting(9000 - i, 3)),
  );
  const recent = results[MAX_FULL_RESULTS - 1];
  assert.ok(recent.transcript, 'a recent sitting lost its transcript');
  assert.ok(recent.report, 'a recent sitting lost its report');

  const old = results[MAX_FULL_RESULTS];
  assert.equal(old.transcript, undefined);
  assert.equal(old.report, undefined);
  // The numbers the history, the chart and the tutor read all survive.
  assert.equal(old.level, 3);
  assert.equal(old.turns, 12);
  assert.equal(old.confidence, 'high');
  assert.equal(old.comprehension, 2.4);
  assert.equal(old.summary, 'Held 3.', 'the examiner\'s one line was not kept');
});

await test('trimming a history that has already been trimmed changes nothing', () => {
  const once = trimResults(Array.from({ length: MAX_FULL_RESULTS + 3 }, (_, i) => sitting(9000 - i, 3)));
  assert.deepEqual(trimResults(once), once);
});

await test('the row count has a backstop, and it is the oldest that goes', () => {
  const results = trimResults(Array.from({ length: MAX_RESULTS + 10 }, (_, i) => sitting(9000 - i, 3)));
  assert.equal(results.length, MAX_RESULTS);
  assert.equal(results[0].at, 9000, 'the newest sitting was dropped');
});

await test('the progression reads oldest first, and says what moved', () => {
  const trail = progression([sitting(3000, 4), sitting(2000, 3), sitting(1000, 2)]);
  assert.deepEqual(trail.points.map((p) => p.level), [2, 3, 4]);
  assert.equal(trail.first.at, 1000);
  assert.equal(trail.latest.at, 3000);
  assert.equal(trail.sittings, 3);
  assert.equal(trail.best, 4);
  assert.equal(trail.change, 2);
});

await test('a single sitting has a level but no movement to report', () => {
  const trail = progression([sitting(1000, 3)]);
  assert.equal(trail.change, null, 'one sitting cannot be a trend');
  assert.equal(trail.best, 3);
});

await test('a run that held nothing stays in the line as a zero', () => {
  // Dropping these would draw a flattering line through the early months,
  // when "sat it, held nothing" is most of what happened.
  const trail = progression([sitting(2000, 2), sitting(1000, 0)]);
  assert.deepEqual(trail.points.map((p) => p.level), [0, 2]);
  assert.equal(trail.change, 2);
});

await test('the tutor is told the whole line, oldest first and capped', () => {
  const many = Array.from({ length: MODEL_HISTORY_LIMIT + 6 }, (_, i) => sitting(9000 - i * 100, 4));
  const digest = placementDigest(many);
  assert.equal(digest.level, 4);
  assert.equal(digest.summary, 'Held 4.');
  assert.equal(digest.history.length, MODEL_HISTORY_LIMIT);
  // Oldest first within the window, and the window is the recent end of it.
  assert.ok(digest.history[0].at < digest.history[digest.history.length - 1].at);
  assert.equal(digest.history[digest.history.length - 1].at, 9000);
  assert.equal(placementDigest([]), null);
});

await test('a sitting whose transcript is gone still reaches the tutor', () => {
  const digest = placementDigest([summarizeResult(sitting(2000, 5)), sitting(1000, 4)]);
  assert.equal(digest.level, 5);
  assert.equal(digest.summary, 'Held 5.', 'the summary did not survive the trim');
  assert.equal(digest.history.length, 2);
});

// ---------------------------------------------------------------------------
// The rubric the model marks against
// ---------------------------------------------------------------------------

await test('every level has a rubric drawn from its own study guide', () => {
  for (let level = 1; level <= 9; level++) {
    const rubric = rubricFor(level);
    assert.ok(rubric, `no rubric for HSK ${level}`);
    assert.equal(rubric.level, level);
    assert.ok(rubric.canDo.length >= 4, `HSK ${level} has too few can-do statements`);
    assert.ok(rubric.grammar.length >= 5, `HSK ${level} has too few grammar points`);
    assert.ok(rubric.vocab.length >= 20, `HSK ${level} has too little vocabulary`);
    assert.ok(rubric.vocab.every((w) => /[㐀-鿿]/.test(w)),
      `HSK ${level} rubric vocabulary is not all Chinese`);
  }
  assert.equal(rubricFor(10), null);
  assert.equal(rubricFor(0), null);
});

// ---------------------------------------------------------------------------
// The endpoint
// ---------------------------------------------------------------------------

const TOKEN = 'a'.repeat(32);
const auth = { authorization: `Bearer ${TOKEN}` };
const post = (body, headers = {}) => new Request('https://example.com/api/placement', {
  method: 'POST',
  headers: { 'content-type': 'application/json', ...headers },
  body: JSON.stringify(body),
});

const REPLY = JSON.stringify({
  level: 4,
  reply: '你周末一般做什么？',
  taskType: 'question',
  assess: { comprehension: 3, production: 2, errors: [], vocabUsed: [], comment: 'Clear.' },
  result: null,
});

await test('rejects a request with no bearer token', async () => {
  const res = await worker.fetch(post({ target: 3 }), { DB: fakeDb() });
  assert.equal(res.status, 401);
});

await test('rejects anything but POST', async () => {
  const res = await worker.fetch(
    new Request('https://example.com/api/placement', { method: 'GET' }), { DB: fakeDb() });
  assert.equal(res.status, 405);
});

await test('reports a clear 503 when no model provider is configured', async () => {
  const res = await worker.fetch(post({ target: 3 }, auth), { DB: fakeDb() });
  assert.equal(res.status, 503);
  assert.match((await res.json()).error, /not configured/);
});

await test('rejects a target that is not an HSK level', async () => {
  const db = fakeDb();
  for (const target of [0, 10, 'four', null, 3.5]) {
    const res = await worker.fetch(post({ target }, auth), { DB: db, OPENAI_API_KEY: 'k' });
    assert.equal(res.status, 400, `target ${target} was accepted`);
  }
  assert.equal(db.countOf('placement'), 0, 'a refused request spent an allowance');
});

await test('the rubric for the target level reaches the model prompt', async () => {
  const stub = stubModel(REPLY);
  try {
    const res = await worker.fetch(post({
      target: 4,
      allowed: [3, 4, 5],
      rubrics: [rubricFor(4)],
      history: [],
    }, auth), { DB: fakeDb(), OPENAI_API_KEY: 'k' });
    assert.equal(res.status, 200);
    const prompt = stub.seen[0].input;
    assert.match(prompt, /RUBRIC FOR HSK 4/);
    assert.match(prompt, /Allowed levels for this turn: 3, 4, 5/);
    assert.match(prompt, /Grammar introduced at this level/);
  } finally {
    stub.restore();
  }
});

await test('the learner\'s answer reaches the model marked as the thing to grade', async () => {
  const stub = stubModel(REPLY);
  try {
    await worker.fetch(post({
      target: 4,
      allowed: [4],
      answer: '我喜欢看书。',
      answeredLevel: 3,
      history: [{ role: 'examiner', content: '你喜欢做什么？' }],
    }, auth), { DB: fakeDb(), OPENAI_API_KEY: 'k' });
    const prompt = stub.seen[0].input;
    assert.match(prompt, /mark this one/);
    assert.match(prompt, /我喜欢看书。/);
    assert.match(prompt, /aimed at HSK 3\. Mark it against THAT level/);
  } finally {
    stub.restore();
  }
});

// A traditional reader who wrote 博物館 was told the correct character for
// "museum" is 馆 — a correction that is not one, and that goes into their deck
// in the script they do not read. The examiner cannot know which way the app's
// 简/繁 toggle is set unless the turn says so, so the turn says so.
await test('the learner\'s script travels, so traditional is not marked as an error', async () => {
  const stub = stubModel(REPLY);
  try {
    await worker.fetch(post({
      target: 3,
      script: 'trad',
      answer: '我去了博物館。',
      history: [{ role: 'examiner', content: '你昨天做了什麼？' }],
    }, auth), { DB: fakeDb(), OPENAI_API_KEY: 'k' });
    const prompt = stub.seen[0].input;
    assert.match(prompt, /TRADITIONAL/);
    assert.match(prompt, /never list one as an error/);
    assert.doesNotMatch(prompt, /reads and writes SIMPLIFIED/);

    // And the standing rule is in the system prompt, so it holds for a turn
    // whose own line is somehow missing.
    assert.match(stub.seen[0].instructions, /博物館 is not a misspelling of 博物馆/);
  } finally {
    stub.restore();
  }
});

await test('a turn with no script named is a simplified one', async () => {
  const stub = stubModel(REPLY);
  try {
    await worker.fetch(post({ target: 3, history: [] }, auth),
      { DB: fakeDb(), OPENAI_API_KEY: 'k' });
    const prompt = stub.seen[0].input;
    assert.match(prompt, /reads and writes SIMPLIFIED/);
    assert.doesNotMatch(prompt, /TRADITIONAL/);
  } finally {
    stub.restore();
  }
});

await test('an empty answer is marked as a zero rather than left unmeasured', async () => {
  const stub = stubModel(REPLY);
  try {
    await worker.fetch(post({
      target: 4,
      answer: '   ',
      history: [{ role: 'examiner', content: '你喜欢做什么？' }],
    }, auth), { DB: fakeDb(), OPENAI_API_KEY: 'k' });
    assert.match(stub.seen[0].input, /sent no reply.*Mark comprehension 0 and production 0/s);
  } finally {
    stub.restore();
  }
});

await test('a level outside the allowed band is replaced by the one the ladder asked for', async () => {
  // The band is the client's rules already applied. A model that answers with
  // a level outside it is not making a suggestion worth weighing.
  const stub = stubModel(JSON.stringify({ ...JSON.parse(REPLY), level: 9 }));
  try {
    const res = await worker.fetch(post({
      target: 4, allowed: [3, 4, 5], history: [],
    }, auth), { DB: fakeDb(), OPENAI_API_KEY: 'k' });
    assert.equal((await res.json()).level, 4);
  } finally {
    stub.restore();
  }
});

await test('a level inside the band is taken, so the ladder can react to the last answer', async () => {
  const stub = stubModel(JSON.stringify({ ...JSON.parse(REPLY), level: 5 }));
  try {
    const res = await worker.fetch(post({
      target: 4, allowed: [3, 4, 5], history: [],
    }, auth), { DB: fakeDb(), OPENAI_API_KEY: 'k' });
    assert.equal((await res.json()).level, 5);
  } finally {
    stub.restore();
  }
});

await test('no mark on the opening turn, and no result before the closing one', async () => {
  const stub = stubModel(JSON.stringify({
    ...JSON.parse(REPLY),
    result: { summary: 'Premature.', strengths: ['a'], gaps: [], advice: [] },
  }));
  try {
    const res = await worker.fetch(post({ target: 3, history: [] }, auth),
      { DB: fakeDb(), OPENAI_API_KEY: 'k' });
    const data = await res.json();
    assert.equal(data.assess, null, 'marked an answer that was never given');
    assert.equal(data.result, null, 'closed an interview that had just started');
  } finally {
    stub.restore();
  }
});

await test('the closing turn returns the examiner\'s written report', async () => {
  const stub = stubModel(JSON.stringify({
    level: 4,
    reply: '今天就到这里，谢谢你！',
    taskType: 'wind-down',
    assess: { comprehension: 2, production: 2, errors: [], comment: 'Held up.' },
    result: {
      summary: 'Comfortable at HSK 3.',
      strengths: ['Everyday topics'],
      gaps: ['了 with experience'],
      advice: ['Drill aspect markers'],
    },
  }));
  try {
    const res = await worker.fetch(post({
      target: 4, finish: true, answer: '好的，谢谢！',
      history: [{ role: 'examiner', content: '你好' }],
    }, auth), { DB: fakeDb(), OPENAI_API_KEY: 'k' });
    const data = await res.json();
    assert.equal(data.result.summary, 'Comfortable at HSK 3.');
    assert.deepEqual(data.result.gaps, ['了 with experience']);
    assert.equal(data.assess.comprehension, 2);
    assert.match(stub.seen[0].input, /THIS IS THE FINAL TURN/);
  } finally {
    stub.restore();
  }
});

await test('marks and corrections are coerced into shape before they are stored', async () => {
  const stub = stubModel(JSON.stringify({
    level: 4,
    reply: '再说一次。',
    assess: {
      comprehension: 7,
      production: -2,
      errors: Array.from({ length: 9 }, (_, i) => ({
        span: `bad ${i}`, correction: `good ${i}`, note: 'x'.repeat(400),
      })),
      comment: 'y'.repeat(900),
    },
  }));
  try {
    const res = await worker.fetch(post({
      target: 4, answer: '嗯', history: [{ role: 'examiner', content: '你好' }],
    }, auth), { DB: fakeDb(), OPENAI_API_KEY: 'k' });
    const { assess } = await res.json();
    assert.equal(assess.comprehension, 3, 'a mark above the scale was stored');
    assert.equal(assess.production, 0, 'a negative mark was stored');
    assert.equal(assess.errors.length, 3, 'an unbounded list of errors was stored');
    assert.ok(assess.errors[0].note.length <= 200);
    assert.ok(assess.comment.length <= 300);
  } finally {
    stub.restore();
  }
});

await test('a reply with nothing to say is an error, not a blank turn', async () => {
  const stub = stubModel(JSON.stringify({ level: 4, reply: '   ', assess: null }));
  try {
    const db = fakeDb();
    const res = await worker.fetch(post({ target: 4, history: [] }, auth),
      { DB: db, OPENAI_API_KEY: 'k' });
    assert.equal(res.status, 502);
    assert.equal(db.countOf('placement'), 0, 'an unusable turn was charged for');
  } finally {
    stub.restore();
  }
});

await test('the hourly cap is counted in turns and kept separate from the tutor\'s', async () => {
  const now = Date.now();
  const usage = Array.from({ length: 60 }, () => ({
    user_id: 1, kind: 'placement', created_at: now,
  }));
  const db = fakeDb({ users: [{ id: 1, token_hash: await sha256(TOKEN) }], usage });
  const res = await worker.fetch(post({ target: 4 }, auth), { DB: db, OPENAI_API_KEY: 'k' });
  assert.equal(res.status, 429);
  assert.match((await res.json()).error, /placement limit reached/);

  // The tutor's own allowance is untouched by a spent placement budget.
  const stub = stubModel('Because 了 marks completion.');
  try {
    const ask = await worker.fetch(new Request('https://example.com/api/ask', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...auth },
      body: JSON.stringify({ question: 'why?' }),
    }), { DB: db, OPENAI_API_KEY: 'k' });
    assert.equal(ask.status, 200);
  } finally {
    stub.restore();
  }
});

await test('an oversized deck profile is refused before the model is called', async () => {
  const stub = stubModel(REPLY);
  try {
    const res = await worker.fetch(post({
      target: 4,
      profile: { recentWords: Array.from({ length: 8000 }, (_, i) => `词${i}`) },
    }, auth), { DB: fakeDb(), OPENAI_API_KEY: 'k' });
    assert.equal(res.status, 413);
    assert.equal(stub.seen.length, 0, 'the model was called with an oversized profile');
  } finally {
    stub.restore();
  }
});

async function sha256(text) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

if (failures.length) {
  console.error(`\n${failures.length} failing:\n  - ${failures.join('\n  - ')}\n`);
  process.exit(1);
}
console.log(`placement: ${passed} passing`);
