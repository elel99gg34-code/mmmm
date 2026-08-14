/**
 * 리버시 / 오델로 (Reversi) — 8x8.
 *
 * Turn passes automatically when a seat has no legal move; the game ends when
 * neither side can move. The AI weights corners heavily and switches to raw
 * disc count in the endgame, which is the classic Othello heuristic split.
 */
import { clone, fail, done, other, makeStatus } from './_engine.js';

export const SIZE = 8;
const N = SIZE * SIZE;
const DIRS = [
  [-1, -1], [-1, 0], [-1, 1],
  [0, -1], [0, 1],
  [1, -1], [1, 0], [1, 1],
];

export const meta = {
  id: 'reversi',
  name: '리버시',
  nameEn: 'Reversi',
  emoji: '⚪',
  category: '보드',
  mode: 'turn',
  ai: true,
  desc: '상대 돌을 양쪽에서 감싸 뒤집습니다. 한 수에 판세가 통째로 뒤집히는 역전의 게임.',
  rules: [
    '흑(선공)이 먼저 둡니다.',
    '자기 돌과 자기 돌 사이에 낀 상대 돌은 모두 자기 색으로 뒤집힙니다.',
    '뒤집을 수 있는 자리에만 놓을 수 있습니다.',
    '둘 곳이 없으면 자동으로 차례가 넘어갑니다.',
    '양쪽 모두 둘 수 없으면 게임이 끝나고 돌이 많은 쪽이 승리합니다.',
  ],
};

const idx = (r, c) => r * SIZE + c;

export function createState() {
  const board = new Array(N).fill(0);
  board[idx(3, 3)] = 2;
  board[idx(4, 4)] = 2;
  board[idx(3, 4)] = 1;
  board[idx(4, 3)] = 1;
  return { board, turn: 0, last: null, flipped: [], winner: null, passes: 0 };
}

/** Discs that would flip if `stone` played at (r, c); empty array means illegal. */
function gains(board, r, c, stone) {
  if (board[idx(r, c)] !== 0) return [];
  const opp = stone === 1 ? 2 : 1;
  const out = [];
  for (const [dr, dc] of DIRS) {
    const run = [];
    let rr = r + dr;
    let cc = c + dc;
    while (rr >= 0 && cc >= 0 && rr < SIZE && cc < SIZE && board[idx(rr, cc)] === opp) {
      run.push(idx(rr, cc));
      rr += dr;
      cc += dc;
    }
    if (run.length && rr >= 0 && cc >= 0 && rr < SIZE && cc < SIZE && board[idx(rr, cc)] === stone) {
      out.push(...run);
    }
  }
  return out;
}

function movesFor(board, stone) {
  const out = [];
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      if (gains(board, r, c, stone).length) out.push(idx(r, c));
    }
  }
  return out;
}

export function legalMoves(state, seat) {
  if (state.winner !== null) return [];
  const who = seat === undefined ? state.turn : seat;
  if (who !== state.turn) return [];
  return movesFor(state.board, who + 1);
}

export function counts(board) {
  let a = 0;
  let b = 0;
  for (const v of board) {
    if (v === 1) a++;
    else if (v === 2) b++;
  }
  return [a, b];
}

export function status(state) {
  const scores = counts(state.board);
  if (state.winner !== null) {
    return makeStatus({
      phase: 'over',
      turn: null,
      winner: state.winner,
      scores,
      reason: state.winner === 'draw' ? `${scores[0]} : ${scores[1]} 동점` : `${scores[0]} : ${scores[1]}`,
    });
  }
  return makeStatus({ phase: 'playing', turn: state.turn, scores });
}

function finish(next) {
  const [a, b] = counts(next.board);
  next.winner = a === b ? 'draw' : a > b ? 0 : 1;
  next.turn = null;
}

export function applyMove(state, seat, move) {
  if (state.winner !== null) return fail('이미 끝난 게임입니다.');
  if (seat !== state.turn) return fail('상대 차례입니다.');
  const cell = typeof move === 'number' ? move : move?.idx;
  if (!Number.isInteger(cell) || cell < 0 || cell >= N) return fail('판 밖입니다.');

  const r = Math.floor(cell / SIZE);
  const c = cell % SIZE;
  const stone = seat + 1;
  const flips = gains(state.board, r, c, stone);
  if (!flips.length) return fail('뒤집을 돌이 없는 자리에는 놓을 수 없습니다.');

  const next = clone(state);
  next.board[cell] = stone;
  for (const f of flips) next.board[f] = stone;
  next.last = cell;
  next.flipped = flips;
  next.passes = 0;

  const opp = other(seat);
  if (movesFor(next.board, opp + 1).length) {
    next.turn = opp;
  } else if (movesFor(next.board, stone).length) {
    next.turn = seat; // opponent must pass
    next.passes = 1;
  } else {
    finish(next);
  }
  return done(next, [{ type: 'place', idx: cell, seat, flips }]);
}

/* ── AI ───────────────────────────────────────────────────────────────────── */

// prettier-ignore
const WEIGHTS = [
  120, -20,  20,   5,   5,  20, -20, 120,
  -20, -40,  -5,  -5,  -5,  -5, -40, -20,
   20,  -5,  15,   3,   3,  15,  -5,  20,
    5,  -5,   3,   3,   3,   3,  -5,   5,
    5,  -5,   3,   3,   3,   3,  -5,   5,
   20,  -5,  15,   3,   3,  15,  -5,  20,
  -20, -40,  -5,  -5,  -5,  -5, -40, -20,
  120, -20,  20,   5,   5,  20, -20, 120,
];

function simulate(board, cell, stone) {
  const next = board.slice();
  const r = Math.floor(cell / SIZE);
  const c = cell % SIZE;
  next[cell] = stone;
  for (const f of gains(board, r, c, stone)) next[f] = stone;
  return next;
}

function evaluate(board, me) {
  const opp = me === 1 ? 2 : 1;
  const filled = board.reduce((n, v) => n + (v ? 1 : 0), 0);
  const endgame = filled > 52;

  let positional = 0;
  let mine = 0;
  let theirs = 0;
  for (let i = 0; i < N; i++) {
    if (board[i] === me) {
      positional += WEIGHTS[i];
      mine++;
    } else if (board[i] === opp) {
      positional -= WEIGHTS[i];
      theirs++;
    }
  }
  if (endgame) return (mine - theirs) * 100 + positional * 0.2;

  const myMoves = movesFor(board, me).length;
  const oppMoves = movesFor(board, opp).length;
  const mobility = myMoves + oppMoves ? ((myMoves - oppMoves) * 100) / (myMoves + oppMoves) : 0;
  return positional + mobility * 10 - (mine - theirs) * 2;
}

function search(board, me, stone, depth, alpha, beta) {
  const moves = movesFor(board, stone);
  const opp = stone === 1 ? 2 : 1;

  if (!moves.length) {
    if (!movesFor(board, opp).length) {
      let mine = 0;
      let theirs = 0;
      for (const v of board) {
        if (v === me) mine++;
        else if (v) theirs++;
      }
      return { score: (mine - theirs) * 100000, move: null };
    }
    return { score: search(board, me, opp, depth - 1, alpha, beta).score, move: null };
  }
  if (depth === 0) return { score: evaluate(board, me), move: null };

  const maximizing = stone === me;
  let best = maximizing ? -Infinity : Infinity;
  let bestMove = moves[0];
  for (const cell of moves) {
    const value = search(simulate(board, cell, stone), me, opp, depth - 1, alpha, beta).score;
    if (maximizing ? value > best : value < best) {
      best = value;
      bestMove = cell;
    }
    if (maximizing) alpha = Math.max(alpha, value);
    else beta = Math.min(beta, value);
    if (alpha >= beta) break;
  }
  return { score: best, move: bestMove };
}

export function ai(state, seat, level = 2) {
  const moves = legalMoves(state, seat);
  if (!moves.length) return null;
  if (level <= 1) return moves[Math.floor(Math.random() * moves.length)];
  const depth = level >= 3 ? 5 : 3;
  const { move } = search(state.board, seat + 1, seat + 1, depth, -Infinity, Infinity);
  return move ?? moves[0];
}
