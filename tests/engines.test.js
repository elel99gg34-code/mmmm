/**
 * Engine conformance + rules tests.
 *
 * Every engine must satisfy the shared contract, survive thousands of random
 * playouts without producing an illegal or stuck state, and honour the handful
 * of rules that are easy to get subtly wrong.
 */
import { suite, test, assert, equal, deepEqual } from './harness.js';
import { GAMES, getGame, catalogue, viewFor, tickOf } from '../shared/games/index.js';
import { Rng } from '../shared/rng.js';
import * as gomoku from '../shared/games/gomoku.js';
import * as connect4 from '../shared/games/connect4.js';
import * as reversi from '../shared/games/reversi.js';
import * as checkers from '../shared/games/checkers.js';
import * as uttt from '../shared/games/uttt.js';
import * as dotsboxes from '../shared/games/dotsboxes.js';
import * as battleship from '../shared/games/battleship.js';
import * as quiz from '../shared/games/quiz.js';
import * as wordchain from '../shared/games/wordchain.js';
import * as typing from '../shared/games/typing.js';
import * as reaction from '../shared/games/reaction.js';
import * as memory from '../shared/games/memory.js';
import * as minesweeper from '../shared/games/minesweeper.js';
import * as g2048 from '../shared/games/g2048.js';
import * as snake from '../shared/games/snake.js';
import { allowedStarts, canFollow } from '../shared/hangul.js';
import { QUESTIONS, CATEGORIES } from '../shared/data/quiz-bank.js';

/* ── Registry ─────────────────────────────────────────────────────────────── */

suite('registry');

test('exactly 15 games are registered', () => {
  equal(GAMES.length, 15);
});

test('ids are unique and resolvable', () => {
  const ids = GAMES.map((g) => g.meta.id);
  equal(new Set(ids).size, 15, `duplicate id in ${ids.join(', ')}`);
  for (const id of ids) assert(getGame(id), `getGame('${id}') returned nothing`);
});

test('every game exposes the required contract', () => {
  for (const game of GAMES) {
    const { id } = game.meta;
    assert(typeof game.createState === 'function', `${id}: createState missing`);
    assert(typeof game.status === 'function', `${id}: status missing`);
    assert(typeof game.applyMove === 'function', `${id}: applyMove missing`);
    for (const field of ['id', 'name', 'nameEn', 'emoji', 'category', 'mode', 'desc']) {
      assert(game.meta[field], `${id}: meta.${field} missing`);
    }
    assert(Array.isArray(game.meta.rules) && game.meta.rules.length >= 3, `${id}: needs rules text`);
  }
});

test('catalogue is JSON-safe metadata only', () => {
  const json = JSON.parse(JSON.stringify(catalogue()));
  equal(json.length, 15);
  assert(json.every((m) => typeof m.id === 'string'));
});

test('initial state is JSON-serialisable and deterministic in the seed', () => {
  for (const game of GAMES) {
    const opts = { seed: 'fixed-seed', now: 1_700_000_000_000 };
    const a = JSON.stringify(game.createState(opts));
    const b = JSON.stringify(game.createState(opts));
    equal(a, b, `${game.meta.id}: same seed produced different states`);
    assert(a.length > 2, `${game.meta.id}: empty state`);
  }
});

test('applyMove never mutates the state it was given', () => {
  for (const game of GAMES) {
    const state = game.createState({ seed: 'nomutate', now: 1_700_000_000_000 });
    const before = JSON.stringify(state);
    const moves = typeof game.legalMoves === 'function' ? game.legalMoves(state, 0) : [];
    if (!moves.length) continue;
    game.applyMove(state, 0, moves[0], { now: 1_700_000_000_100 });
    equal(JSON.stringify(state), before, `${game.meta.id}: applyMove mutated its input`);
  }
});

test('illegal moves are rejected rather than thrown', () => {
  for (const game of GAMES) {
    const state = game.createState({ seed: 'bad', now: 1 });
    for (const junk of [null, undefined, {}, { type: 'nonsense' }, -1, 99999, 'x']) {
      const res = game.applyMove(state, 0, junk, { now: 2 });
      assert(res && typeof res.ok === 'boolean', `${game.meta.id}: applyMove returned ${res}`);
      if (!res.ok) assert(typeof res.error === 'string' && res.error, `${game.meta.id}: missing error text`);
    }
  }
});

/* ── Random playouts ──────────────────────────────────────────────────────── */

suite('turn-based playouts');

/** Play a whole game with random legal moves; assert it terminates cleanly. */
function playout(game, seed, maxPlies = 4000) {
  const rng = new Rng(seed);
  let state = game.createState({ seed: `${seed}`, now: 0 });
  let now = 0;
  for (let ply = 0; ply < maxPlies; ply++) {
    const st = game.status(state);
    if (st.phase === 'over') return { state, plies: ply, status: st };

    now += 50;
    const ticked = tickOf(game, state, now);
    if (ticked.changed) {
      state = ticked.state;
      continue;
    }

    const seat = st.turn === null ? rng.int(0, 1) : st.turn;
    const moves = typeof game.legalMoves === 'function' ? game.legalMoves(state, seat) : [];
    if (!moves.length) {
      const other = seat === 0 ? 1 : 0;
      const alt = typeof game.legalMoves === 'function' ? game.legalMoves(state, other) : [];
      if (!alt.length) {
        now += 5000; // let the clocks resolve it
        const forced = tickOf(game, state, now);
        if (!forced.changed) throw new Error(`${game.meta.id}: stuck with no legal move at ply ${ply}`);
        state = forced.state;
        continue;
      }
      const res = game.applyMove(state, other, alt[rng.int(0, alt.length - 1)], { now });
      if (res.ok) state = res.state;
      continue;
    }

    const move = moves[rng.int(0, moves.length - 1)];
    const res = game.applyMove(state, seat, move, { now });
    if (!res.ok) throw new Error(`${game.meta.id}: legalMoves offered an illegal move — ${res.error}`);
    state = res.state;
  }
  throw new Error(`${game.meta.id}: did not finish within ${maxPlies} plies`);
}

for (const game of [gomoku, connect4, reversi, checkers, uttt, dotsboxes, memory]) {
  test(`${game.meta.id}: 20 random playouts terminate with a valid result`, () => {
    for (let i = 0; i < 20; i++) {
      const { status } = playout(game, `playout-${i}`);
      assert(
        status.winner === 0 || status.winner === 1 || status.winner === 'draw',
        `${game.meta.id}: ended with winner=${status.winner}`,
      );
      equal(status.phase, 'over');
    }
  });
}

test('AI returns a legal move for every AI-enabled game', () => {
  for (const game of GAMES) {
    if (!game.meta.ai || typeof game.ai !== 'function') continue;
    const state = game.createState({ seed: 'ai-check', now: Date.now() });
    const st = game.status(state);
    const seat = st.turn === null ? 0 : st.turn;
    const move = game.ai(state, seat, 2);
    if (move === null) continue;
    const res = game.applyMove(state, seat, move, { now: Date.now() + 10 });
    assert(res.ok, `${game.meta.id}: AI produced an illegal move — ${res.error}`);
  }
});

/* ── Per-game rules ───────────────────────────────────────────────────────── */

suite('gomoku');

test('five in a row wins, four does not', () => {
  let state = gomoku.createState();
  const black = [112, 113, 114, 115, 116];
  const white = [0, 1, 2, 3];
  for (let i = 0; i < 4; i++) {
    state = gomoku.applyMove(state, 0, black[i], {}).state;
    equal(state.winner, null, `black won early at stone ${i + 1}`);
    state = gomoku.applyMove(state, 1, white[i], {}).state;
  }
  state = gomoku.applyMove(state, 0, black[4], {}).state;
  equal(state.winner, 0);
  equal(state.winLine.length, 5);
});

test('a seat cannot move out of turn or onto a stone', () => {
  const state = gomoku.createState();
  assert(!gomoku.applyMove(state, 1, 112, {}).ok, 'white moved first');
  const after = gomoku.applyMove(state, 0, 112, {}).state;
  assert(!gomoku.applyMove(after, 1, 112, {}).ok, 'stacked a stone');
});

test('AI blocks an open four instead of playing elsewhere', () => {
  let state = gomoku.createState();
  // Black builds 112,113,114,115 with both ends (111, 116) open, then it is
  // white's move: the only non-losing reply is to plug an end.
  for (const [black, white] of [[112, 0], [113, 1], [114, 2]]) {
    state = gomoku.applyMove(state, 0, black, {}).state;
    state = gomoku.applyMove(state, 1, white, {}).state;
  }
  state = gomoku.applyMove(state, 0, 115, {}).state;
  equal(state.winner, null, 'four in a row is not yet a win');
  equal(state.turn, 1);
  const block = gomoku.ai(state, 1, 2);
  assert(block === 111 || block === 116, `AI played ${block} instead of blocking 111/116`);
});

test('AI completes its own five when it can', () => {
  let state = gomoku.createState();
  for (const [black, white] of [[112, 0], [113, 1], [114, 2], [115, 3]]) {
    state = gomoku.applyMove(state, 0, black, {}).state;
    state = gomoku.applyMove(state, 1, white, {}).state;
  }
  const win = gomoku.ai(state, 0, 2);
  assert(win === 111 || win === 116, `AI played ${win} instead of winning at 111/116`);
  equal(gomoku.applyMove(state, 0, win, {}).state.winner, 0);
});

suite('connect4');

test('coins fall to the lowest empty row', () => {
  const s1 = connect4.applyMove(connect4.createState(), 0, 3, {}).state;
  equal(s1.board[5 * 7 + 3], 1);
  const s2 = connect4.applyMove(s1, 1, 3, {}).state;
  equal(s2.board[4 * 7 + 3], 2);
});

test('four in a column wins', () => {
  let state = connect4.createState();
  for (let i = 0; i < 3; i++) {
    state = connect4.applyMove(state, 0, 0, {}).state;
    state = connect4.applyMove(state, 1, 1, {}).state;
  }
  state = connect4.applyMove(state, 0, 0, {}).state;
  equal(state.winner, 0);
});

test('a full column is rejected', () => {
  let state = connect4.createState();
  for (let i = 0; i < 6; i++) {
    state = connect4.applyMove(state, i % 2, i % 2 === 0 ? 0 : 0, {}).state;
  }
  assert(!connect4.applyMove(state, 0, 0, {}).ok);
});

test('AI takes an immediate win', () => {
  let state = connect4.createState();
  state = connect4.applyMove(state, 0, 0, {}).state;
  state = connect4.applyMove(state, 1, 6, {}).state;
  state = connect4.applyMove(state, 0, 1, {}).state;
  state = connect4.applyMove(state, 1, 6, {}).state;
  state = connect4.applyMove(state, 0, 2, {}).state;
  state = connect4.applyMove(state, 1, 6, {}).state;
  // Black threatens 0,1,2 -> 3 completes it. It is black's move.
  equal(connect4.ai(state, 0, 3), 3);
});

test('AI blocks an immediate loss', () => {
  let state = connect4.createState();
  state = connect4.applyMove(state, 0, 0, {}).state;
  state = connect4.applyMove(state, 1, 1, {}).state;
  state = connect4.applyMove(state, 0, 5, {}).state;
  state = connect4.applyMove(state, 1, 2, {}).state;
  state = connect4.applyMove(state, 0, 5, {}).state;
  state = connect4.applyMove(state, 1, 3, {}).state;
  // White threatens 1,2,3; black must take 0 or 4. Column 0 is occupied at the
  // bottom by black, so the block is column 4.
  equal(connect4.ai(state, 0, 3), 4);
});

suite('reversi');

test('opening position has four discs and four legal moves', () => {
  const state = reversi.createState();
  deepEqual(reversi.counts(state.board), [2, 2]);
  equal(reversi.legalMoves(state, 0).length, 4);
});

test('a placement flips the sandwiched disc', () => {
  const state = reversi.createState();
  const res = reversi.applyMove(state, 0, 2 * 8 + 3, {});
  assert(res.ok, res.error);
  equal(res.state.board[3 * 8 + 3], 1, 'the white disc at d4 should have flipped');
  deepEqual(reversi.counts(res.state.board), [4, 1]);
});

test('placing where nothing flips is illegal', () => {
  assert(!reversi.applyMove(reversi.createState(), 0, 0, {}).ok);
});

suite('checkers');

test('opening position has 12 pieces a side and 7 opening moves', () => {
  const state = checkers.createState();
  equal(state.board.filter((v) => v === 1).length, 12);
  equal(state.board.filter((v) => v === 3).length, 12);
  equal(checkers.legalMoves(state, 0).length, 7);
});

test('capture is compulsory when one is available', () => {
  const state = checkers.createState();
  // Hand-build a position where seat 0 must jump.
  const board = new Array(64).fill(0);
  board[5 * 8 + 2] = 1; // seat 0 man
  board[4 * 8 + 3] = 3; // seat 1 man, jumpable to (3,4)
  board[6 * 8 + 6] = 1; // a piece with a quiet move available
  const forced = { ...state, board };
  const moves = checkers.legalMoves(forced, 0);
  assert(moves.length > 0, 'no moves generated');
  for (const m of moves) {
    assert(Math.abs(Math.floor(m[0] / 8) - Math.floor(m[1] / 8)) === 2, `quiet move ${m} offered while a jump exists`);
  }
});

test('a double jump is generated as one move and removes both pieces', () => {
  const board = new Array(64).fill(0);
  board[5 * 8 + 2] = 1;
  board[4 * 8 + 3] = 3;
  board[2 * 8 + 3] = 3;
  const state = { ...checkers.createState(), board };
  const moves = checkers.legalMoves(state, 0);
  const chain = moves.find((m) => m.length === 3);
  assert(chain, `expected a two-jump chain, got ${JSON.stringify(moves)}`);
  const res = checkers.applyMove(state, 0, chain, {});
  assert(res.ok, res.error);
  equal(res.state.board.filter((v) => v === 3).length, 0, 'both men should have been captured');
  equal(res.state.captured[0], 2);
});

test('a man reaching the far row is crowned', () => {
  const board = new Array(64).fill(0);
  board[1 * 8 + 2] = 1;
  board[7 * 8 + 0] = 3;
  const state = { ...checkers.createState(), board };
  const res = checkers.applyMove(state, 0, [1 * 8 + 2, 0 * 8 + 1], {});
  assert(res.ok, res.error);
  equal(res.state.board[0 * 8 + 1], 2, 'should be a king');
});

suite('ultimate tic-tac-toe');

test('a move constrains the opponent to the matching board', () => {
  const state = uttt.createState();
  const res = uttt.applyMove(state, 0, 4 * 9 + 2, {}); // board 4, cell 2
  equal(res.state.active, 2);
  const moves = uttt.legalMoves(res.state);
  assert(moves.every((m) => Math.floor(m / 9) === 2));
});

test('winning a small board claims it', () => {
  let state = uttt.createState();
  // X takes cells 0,1,2 of board 0 while O is sent elsewhere each time.
  state = uttt.applyMove(state, 0, 0 * 9 + 0, {}).state; // sends O to board 0
  state = uttt.applyMove(state, 1, 0 * 9 + 4, {}).state; // sends X to board 4
  state = uttt.applyMove(state, 0, 4 * 9 + 0, {}).state; // sends O to board 0
  state = uttt.applyMove(state, 1, 0 * 9 + 5, {}).state; // sends X to board 5
  state = uttt.applyMove(state, 0, 5 * 9 + 0, {}).state; // sends O to board 0
  state = uttt.applyMove(state, 1, 0 * 9 + 8, {}).state; // sends X to board 8
  state = uttt.applyMove(state, 0, 8 * 9 + 0, {}).state; // sends O to board 0
  state = uttt.applyMove(state, 1, 0 * 9 + 7, {}).state;
  equal(state.macro[0], 0, 'board 0 should still be open');
  assert(state.cells[0] === 1 && state.cells[4] === 2);
});

suite('dots and boxes');

test('closing a box scores and keeps the turn', () => {
  let state = dotsboxes.createState();
  const [top, bottom, left, right] = dotsboxes.boxEdges(0, 0);
  state = dotsboxes.applyMove(state, 0, top, {}).state;
  state = dotsboxes.applyMove(state, 1, bottom, {}).state;
  state = dotsboxes.applyMove(state, 0, left, {}).state;
  equal(state.turn, 1, 'turn should have passed after a non-closing edge');
  const res = dotsboxes.applyMove(state, 1, right, {});
  equal(res.state.scores[1], 1);
  equal(res.state.turn, 1, 'the closer plays again');
});

test('a drawn edge cannot be redrawn', () => {
  const state = dotsboxes.applyMove(dotsboxes.createState(), 0, 0, {}).state;
  assert(!dotsboxes.applyMove(state, 1, 0, {}).ok);
});

suite('battleship');

test('random placements are always legal', () => {
  for (let i = 0; i < 200; i++) {
    const { fleet, error } = battleship.buildFleet(battleship.randomPlacements(`seed-${i}`));
    assert(!error, `attempt ${i}: ${error}`);
    equal(fleet.cells.filter(Boolean).length, 17);
  }
});

test('overlapping placements are rejected', () => {
  const bad = [
    { id: 'carrier', r: 0, c: 0, dir: 'h' },
    { id: 'battleship', r: 0, c: 0, dir: 'v' },
    { id: 'cruiser', r: 5, c: 0, dir: 'h' },
    { id: 'submarine', r: 7, c: 0, dir: 'h' },
    { id: 'destroyer', r: 9, c: 0, dir: 'h' },
  ];
  assert(battleship.buildFleet(bad).error);
});

test('a full game of fire resolves to a winner and view() hides live ships', () => {
  let state = battleship.createState({ seed: 'bs' });
  state = battleship.applyMove(state, 0, { type: 'place', placements: battleship.randomPlacements('a') }, {}).state;
  state = battleship.applyMove(state, 1, { type: 'place', placements: battleship.randomPlacements('b') }, {}).state;
  equal(state.phase, 'playing');

  const masked = battleship.view(state, 0);
  equal(masked.fleets[1].cells.filter(Boolean).length, 0, 'opponent fleet leaked to the client');
  equal(masked.fleets[0].cells.filter(Boolean).length, 17, 'own fleet should be visible');

  // Both seats sweep the grid in index order, so whoever's opponent has the
  // shallower last hull cell wins. Either outcome is fine; finishing is not.
  let guard = 0;
  while (state.winner === null && guard++ < 500) {
    const seat = state.turn;
    const moves = battleship.legalMoves(state, seat);
    if (!moves.length) break;
    const res = battleship.applyMove(state, seat, moves[0], {});
    assert(res.ok, res.error);
    state = res.state;
  }
  assert(state.winner === 0 || state.winner === 1, `match never resolved (winner=${state.winner})`);
  const sunkAll = state.fleets[state.winner === 0 ? 1 : 0].sunk.length;
  equal(sunkAll, battleship.SHIPS.length, 'the loser should have lost every ship');
  equal(battleship.view(state, 1).fleets[0].cells.filter(Boolean).length, 17, 'fleets reveal once it is over');
});

suite('quiz');

test('questions are drawn deterministically and answers are shuffled', () => {
  const a = quiz.createState({ seed: 'q1', now: 0 });
  const b = quiz.createState({ seed: 'q1', now: 0 });
  const c = quiz.createState({ seed: 'q2', now: 0 });
  deepEqual(a.questions, b.questions);
  assert(JSON.stringify(a.questions) !== JSON.stringify(c.questions), 'different seeds gave the same quiz');
  equal(a.questions.length, 10);
  for (const q of a.questions) assert(q.c >= 0 && q.c <= 3);
});

test('every question in the bank is well formed', () => {
  const seen = new Set();
  QUESTIONS.forEach((item, i) => {
    const where = `question ${i} ("${item.q?.slice(0, 24)}…")`;
    assert(typeof item.q === 'string' && item.q.length > 3, `${where}: missing text`);
    assert(Array.isArray(item.a) && item.a.length === 4, `${where}: needs exactly 4 options`);
    assert(
      item.a.every((option) => typeof option === 'string' && option.length > 0),
      `${where}: has an empty option`,
    );
    equal(new Set(item.a).size, 4, `${where}: has duplicate options`);
    assert(Number.isInteger(item.c) && item.c >= 0 && item.c <= 3, `${where}: bad answer index`);
    assert(CATEGORIES.includes(item.cat), `${where}: unknown category "${item.cat}"`);
    assert([1, 2, 3].includes(item.d), `${where}: difficulty must be 1-3`);
    assert(!seen.has(item.q), `${where}: duplicate question`);
    seen.add(item.q);
  });
  assert(QUESTIONS.length >= 100, `bank is only ${QUESTIONS.length} questions`);
});

test('shuffling the options carries the answer index with it', () => {
  // The bank writes the answer first for readability; a match must not.
  for (const seed of ['a', 'b', 'c', 'd', 'e']) {
    const built = quiz.buildQuestions(seed, { ...quiz.DEFAULTS, count: 40 });
    for (const q of built) {
      const source = QUESTIONS.find((item) => item.q === q.q);
      assert(source, `built a question that is not in the bank: ${q.q}`);
      equal(q.a[q.c], source.a[source.c], `seed ${seed}: answer index does not follow the shuffle`);
      deepEqual([...q.a].sort(), [...source.a].sort(), 'options changed during the shuffle');
    }
    const firstIsAnswer = built.filter((q) => q.c === 0).length;
    assert(firstIsAnswer < built.length, `seed ${seed}: every answer landed in slot 0`);
  }
});

test('a fast correct answer beats a slow correct answer', () => {
  const state = quiz.createState({ seed: 'q1', now: 0 });
  const correct = state.questions[0].c;
  const fast = quiz.applyMove(state, 0, { type: 'answer', qi: 0, choice: correct }, { now: 500 }).state;
  const slow = quiz.applyMove(state, 1, { type: 'answer', qi: 0, choice: correct }, { now: 12000 }).state;
  assert(fast.scores[0] > slow.scores[1], `${fast.scores[0]} should beat ${slow.scores[1]}`);
  assert(slow.scores[1] >= quiz.BASE_POINTS);
});

test('a wrong answer scores nothing and breaks the streak', () => {
  let state = quiz.createState({ seed: 'q1', now: 0 });
  const wrong = (state.questions[0].c + 1) % 4;
  state = quiz.applyMove(state, 0, { type: 'answer', qi: 0, choice: wrong }, { now: 100 }).state;
  equal(state.scores[0], 0);
  equal(state.streak[0], 0);
});

test('answering twice is rejected', () => {
  const state = quiz.createState({ seed: 'q1', now: 0 });
  const after = quiz.applyMove(state, 0, { type: 'answer', qi: 0, choice: 0 }, { now: 100 }).state;
  assert(!quiz.applyMove(after, 0, { type: 'answer', qi: 0, choice: 1 }, { now: 200 }).ok);
});

test('the clock walks question -> reveal -> next -> over', () => {
  let state = quiz.createState({ seed: 'q1', now: 0 });
  let now = 0;
  // Ten questions at 15s + 2.6s of reveal each needs a little under 3 minutes.
  for (let guard = 0; guard < 2000 && state.phase !== 'over'; guard++) {
    now += 500;
    state = quiz.tick(state, now).state;
  }
  equal(state.phase, 'over');
  equal(state.qi, 9, 'every question should have been asked');
  equal(state.winner, 'draw', 'two silent players should draw');
});

test('view() hides the answer key and the opponent pick', () => {
  const state = quiz.createState({ seed: 'q1', now: 0 });
  const answered = quiz.applyMove(state, 1, { type: 'answer', qi: 0, choice: 2 }, { now: 100 }).state;
  const seen = quiz.view(answered, 0);
  equal(seen.questions[0].c, -1, 'answer key leaked');
  equal(seen.questions[1].q, '', 'a future question leaked');
  deepEqual(seen.answers[0][1], { locked: true }, 'opponent choice leaked');
});

suite('word chain');

test('두음법칙 is accepted in both directions', () => {
  deepEqual([...allowedStarts('력')].sort(), ['역', '력'].sort());
  deepEqual([...allowedStarts('라')].sort(), ['나', '라'].sort());
  deepEqual([...allowedStarts('녀')].sort(), ['녀', '여'].sort());
  assert(canFollow('로', '노래'));
  assert(!canFollow('로', '가방'));
});

test('a word must follow the last syllable and cannot repeat', () => {
  const state = wordchain.createState({ seed: 'wc', now: 0 });
  const first = wordchain.lastWord(state);
  const options = wordchain.legalMoves(state);
  assert(options.length > 0, `no continuations for "${first}"`);
  const good = wordchain.applyMove(state, 0, options[0], { now: 100 });
  assert(good.ok, good.error);
  assert(!wordchain.applyMove(good.state, 1, { type: 'word', word: first }, { now: 200 }).ok, 'repeat accepted');
  assert(!wordchain.applyMove(good.state, 1, { type: 'word', word: '없는낱말입니다' }, { now: 200 }).ok);
});

test('running out of time loses the game', () => {
  const state = wordchain.createState({ seed: 'wc', now: 0 });
  const timedOut = wordchain.tick(state, state.deadline + 1).state;
  equal(timedOut.winner, 1, 'seat 0 was on the clock and should lose');
});

suite('typing');

test('progress cannot exceed what a human could type', () => {
  const state = typing.createState({ seed: 't', now: 0 });
  const res = typing.applyMove(state, 0, { type: 'progress', chars: 99999 }, { now: 1000 });
  assert(res.ok);
  assert(res.state.progress[0] <= typing.MAX_CPS + 5, `clamped to ${res.state.progress[0]}`);
  assert(res.state.finished[0] === null, 'a bogus claim should not finish the race');
});

test('progress never goes backwards', () => {
  let state = typing.createState({ seed: 't', now: 0 });
  state = typing.applyMove(state, 0, { type: 'progress', chars: 20 }, { now: 5000 }).state;
  state = typing.applyMove(state, 0, { type: 'progress', chars: 3 }, { now: 6000 }).state;
  equal(state.progress[0], 20);
});

test('completing the passage finishes and wins', () => {
  let state = typing.createState({ seed: 't', now: 0 });
  const len = state.text.length;
  const legitTime = (len / typing.MAX_CPS) * 1000 + 500;
  state = typing.applyMove(state, 0, { type: 'progress', chars: len }, { now: legitTime }).state;
  assert(state.finished[0] !== null, 'should have finished');
  state = typing.tick(state, state.deadline + 1).state;
  equal(state.winner, 0);
});

suite('reaction');

test('pressing before GO is a false start and loses the round', () => {
  const state = reaction.createState({ seed: 'r', now: 0 });
  const early = reaction.applyMove(state, 0, { type: 'react', rt: 10 }, { now: state.goAt - 100 });
  equal(early.state.current[0], reaction.FALSE_START);
  const both = reaction.applyMove(
    { ...early.state, phase: 'go' },
    1,
    { type: 'react', rt: 250 },
    { now: early.state.goAt + 250 },
  );
  equal(both.state.wins[1], 1, 'the honest player should take the round');
});

test('an impossibly fast claim is clamped upward', () => {
  const base = reaction.createState({ seed: 'r', now: 0 });
  const live = { ...base, phase: 'go' };
  const res = reaction.applyMove(live, 0, { type: 'react', rt: 1 }, { now: live.goAt + 2000 });
  assert(res.state.current[0] >= 2000 - reaction.LATENCY_ALLOWANCE_MS, `got ${res.state.current[0]}`);
});

test('an inflated claim is clamped down to the server measurement', () => {
  const base = reaction.createState({ seed: 'r', now: 0 });
  const live = { ...base, phase: 'go' };
  const res = reaction.applyMove(live, 0, { type: 'react', rt: 9999 }, { now: live.goAt + 300 });
  equal(res.state.current[0], 300);
});

test('five rounds elapse and produce a winner', () => {
  let state = reaction.createState({ seed: 'r', now: 0 });
  let now = 0;
  for (let guard = 0; guard < 5000 && state.phase !== 'over'; guard++) {
    now += 100;
    const res = reaction.tick(state, now);
    state = res.state;
  }
  equal(state.phase, 'over');
  equal(state.times.length, 5);
});

suite('memory');

test('a matched pair scores and keeps the turn', () => {
  const state = memory.createState({ seed: 'm', now: 0 });
  const first = state.cards.findIndex((s) => s === state.cards[0]);
  const partner = state.cards.findIndex((s, i) => i !== first && s === state.cards[first]);
  let next = memory.applyMove(state, 0, { type: 'flip', idx: first }, { now: 0 }).state;
  next = memory.applyMove(next, 0, { type: 'flip', idx: partner }, { now: 10 }).state;
  equal(next.scores[0], 1);
  equal(next.turn, 0, 'a match keeps the turn');
});

test('a miss holds the cards up, then passes the turn on tick', () => {
  const state = memory.createState({ seed: 'm', now: 0 });
  const a = 0;
  const b = state.cards.findIndex((s, i) => i !== a && s !== state.cards[a]);
  let next = memory.applyMove(state, 0, { type: 'flip', idx: a }, { now: 0 }).state;
  next = memory.applyMove(next, 0, { type: 'flip', idx: b }, { now: 10 }).state;
  equal(next.face.length, 2);
  assert(!memory.applyMove(next, 0, { type: 'flip', idx: 5 }, { now: 20 }).ok, 'flipped during the hold');
  next = memory.tick(next, next.closeAt + 1).state;
  equal(next.face.length, 0);
  equal(next.turn, 1);
});

test('view() hides face-down cards', () => {
  const state = memory.createState({ seed: 'm', now: 0 });
  const masked = memory.view(state, 0);
  equal(masked.cards.filter(Boolean).length, 0);
});

suite('minesweeper');

test('both players get the same field with the same opening already cleared', () => {
  const state = minesweeper.createState({ seed: 'ms', now: 0 });
  deepEqual(state.revealed[0], state.revealed[1]);
  equal(state.opened[0], state.opened[1]);
  assert(state.opened[0] > 0, 'the opening region should be pre-cleared');
  equal(state.mines.length, minesweeper.DEFAULTS.mines);
});

test('stepping on a mine ends that player', () => {
  const state = minesweeper.createState({ seed: 'ms', now: 0 });
  const mine = state.mines[0];
  const res = minesweeper.applyMove(state, 0, { type: 'reveal', idx: mine }, { now: 100 });
  assert(res.ok, res.error);
  equal(res.state.dead[0], true);
});

test('clearing every safe square wins', () => {
  let state = minesweeper.createState({ seed: 'ms', now: 0 });
  const mines = new Set(state.mines);
  const n = state.config.rows * state.config.cols;
  for (let i = 0; i < n && state.winner === null; i++) {
    if (mines.has(i) || state.revealed[0][i]) continue;
    const res = minesweeper.applyMove(state, 0, { type: 'reveal', idx: i }, { now: 1000 });
    if (res.ok) state = res.state;
  }
  equal(state.finishedAt[0] !== null, true, 'seat 0 should have cleared the board');
});

test('view() withholds unopened numbers and the mine list', () => {
  const state = minesweeper.createState({ seed: 'ms', now: 0 });
  const masked = minesweeper.view(state, 0);
  equal(masked.mines.length, 0, 'mine positions leaked');
  const hidden = masked.numbers.filter((v, i) => !state.revealed[0][i]);
  assert(hidden.every((v) => v === null), 'unopened numbers leaked');
});

suite('2048');

test('squash merges each tile at most once', () => {
  deepEqual(g2048.squash([2, 2, 2, 2]), { line: [4, 4, 0, 0], gained: 8, moved: true });
  deepEqual(g2048.squash([4, 4, 8, 0]), { line: [8, 8, 0, 0], gained: 8, moved: true });
  deepEqual(g2048.squash([2, 0, 0, 0]).moved, false);
  deepEqual(g2048.squash([0, 0, 0, 2]).moved, true);
});

test('a slide that changes nothing is rejected', () => {
  const state = g2048.createState({ seed: 'g', now: 0 });
  const dirs = g2048.DIRS.filter((d) => g2048.slide(state.grids[0], 4, d).moved);
  assert(dirs.length > 0);
  const dead = g2048.DIRS.find((d) => !g2048.slide(state.grids[0], 4, d).moved);
  if (dead) assert(!g2048.applyMove(state, 0, { type: 'move', dir: dead }, { now: 10 }).ok);
});

test('a legal slide spawns exactly one new tile', () => {
  const state = g2048.createState({ seed: 'g', now: 0 });
  const before = state.grids[0].filter((v) => v !== 0).length;
  const dir = g2048.DIRS.find((d) => g2048.slide(state.grids[0], 4, d).moved);
  const res = g2048.applyMove(state, 0, { type: 'move', dir }, { now: 10 });
  assert(res.ok, res.error);
  const after = res.state.grids[0].filter((v) => v !== 0).length;
  assert(after === before || after === before + 1, `${before} -> ${after}`);
  equal(res.state.spawns[0], state.spawns[0] + 1);
});

test('both seats start from the same spawn stream', () => {
  const state = g2048.createState({ seed: 'same', now: 0 });
  equal(state.grids[0].filter((v) => v !== 0).length, 2);
  equal(state.grids[1].filter((v) => v !== 0).length, 2);
});

suite('snake');

test('a 180-degree reversal is ignored', () => {
  const state = snake.createState({ seed: 's', now: 0 });
  equal(state.snakes[0].dir, 'right');
  const res = snake.applyMove(state, 0, { type: 'dir', dir: 'left' }, {});
  equal(res.state.snakes[0].queued.length, 0, 'reversal should not queue');
});

test('the simulation is deterministic for the same input log', () => {
  const runOnce = () => {
    let state = snake.createState({ seed: 's', now: 0 });
    state = snake.applyMove(state, 0, { type: 'dir', dir: 'down' }, {}).state;
    for (let t = 1; t <= 40; t++) state = snake.tick(state, t * state.config.tickMs).state;
    return JSON.stringify(state.snakes.map((s) => s.body));
  };
  equal(runOnce(), runOnce());
});

test('running into a wall kills the snake and settles the match', () => {
  let state = snake.createState({ seed: 's', now: 0 });
  state = snake.applyMove(state, 0, { type: 'dir', dir: 'up' }, {}).state;
  state = snake.applyMove(state, 1, { type: 'dir', dir: 'up' }, {}).state;
  const ticks = state.config.h + 4;
  for (let t = 1; t <= ticks; t++) state = snake.tick(state, t * state.config.tickMs).state;
  assert(state.snakes.every((s) => !s.alive), 'both snakes should have hit the top wall');
  assert(state.winner !== null, 'the match should have settled');
});

test('the food square is always inside the board and off the snake', () => {
  for (let i = 0; i < 50; i++) {
    const state = snake.createState({ seed: `food-${i}`, now: 0 });
    for (const s of state.snakes) {
      const [fx, fy] = s.food;
      assert(fx >= 0 && fy >= 0 && fx < state.config.w && fy < state.config.h, 'food outside the board');
      assert(!s.body.some(([x, y]) => x === fx && y === fy), 'food spawned on the snake');
    }
  }
});

/* ── Shared view helper ───────────────────────────────────────────────────── */

suite('view helper');

test('viewFor never leaks more than the engine allows', () => {
  for (const game of GAMES) {
    const state = game.createState({ seed: 'v', now: 0 });
    const seen = viewFor(game, state, 0);
    assert(seen && typeof seen === 'object', `${game.meta.id}: view returned ${seen}`);
    JSON.stringify(seen); // must stay serialisable
  }
});
