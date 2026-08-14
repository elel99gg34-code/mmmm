/**
 * 얼티밋 틱택토 (Ultimate Tic-Tac-Toe) — nine boards inside one board.
 *
 * Your move decides which small board your opponent must play in next, which
 * turns a solved children's game into a genuinely deep one.
 */
import { clone, fail, done, other, makeStatus } from './_engine.js';

export const meta = {
  id: 'uttt',
  name: '얼티밋 틱택토',
  nameEn: 'Ultimate Tic-Tac-Toe',
  emoji: '❎',
  category: '전략',
  mode: 'turn',
  ai: true,
  desc: '작은 판 9개가 모여 큰 판 하나. 내가 둔 칸이 상대가 둘 판을 정합니다.',
  rules: [
    'X(선공)가 먼저 둡니다.',
    '작은 판에서 3목을 만들면 그 판을 차지합니다.',
    '내가 둔 "칸의 위치"가 상대가 다음에 둘 "작은 판"이 됩니다.',
    '보내진 판이 이미 끝났다면 상대는 아무 판에나 둘 수 있습니다.',
    '차지한 작은 판 3개를 나란히 만들면 최종 승리입니다.',
  ],
};

const LINES = [
  [0, 1, 2], [3, 4, 5], [6, 7, 8],
  [0, 3, 6], [1, 4, 7], [2, 5, 8],
  [0, 4, 8], [2, 4, 6],
];

export function createState() {
  return {
    cells: new Array(81).fill(0), // 0 empty, 1 seat0(X), 2 seat1(O)
    macro: new Array(9).fill(0), // 0 open, 1 seat0, 2 seat1, 3 drawn
    active: null, // which small board must be played, or null for free choice
    turn: 0,
    last: null,
    winner: null,
    winLine: null,
  };
}

function lineWinner(get) {
  for (const [a, b, c] of LINES) {
    const v = get(a);
    if (v && v !== 3 && v === get(b) && v === get(c)) return { who: v, line: [a, b, c] };
  }
  return null;
}

function boardFull(cells, b) {
  for (let i = 0; i < 9; i++) if (cells[b * 9 + i] === 0) return false;
  return true;
}

export function status(state) {
  if (state.winner !== null) {
    const won = state.macro.filter((v) => v === 1).length;
    const lost = state.macro.filter((v) => v === 2).length;
    return makeStatus({
      phase: 'over',
      turn: null,
      winner: state.winner,
      scores: [won, lost],
      reason: state.winner === 'draw' ? '큰 판 무승부' : '큰 판 3목 완성',
    });
  }
  return makeStatus({
    phase: 'playing',
    turn: state.turn,
    scores: [state.macro.filter((v) => v === 1).length, state.macro.filter((v) => v === 2).length],
  });
}

export function legalMoves(state) {
  if (state.winner !== null) return [];
  const out = [];
  const boards =
    state.active !== null && state.macro[state.active] === 0
      ? [state.active]
      : [0, 1, 2, 3, 4, 5, 6, 7, 8].filter((b) => state.macro[b] === 0);
  for (const b of boards) {
    for (let i = 0; i < 9; i++) if (state.cells[b * 9 + i] === 0) out.push(b * 9 + i);
  }
  return out;
}

export function applyMove(state, seat, move) {
  if (state.winner !== null) return fail('이미 끝난 게임입니다.');
  if (seat !== state.turn) return fail('상대 차례입니다.');
  const cell = typeof move === 'number' ? move : move?.idx;
  if (!Number.isInteger(cell) || cell < 0 || cell >= 81) return fail('판 밖입니다.');
  if (!legalMoves(state).includes(cell)) return fail('지금 그 칸에는 둘 수 없습니다.');

  const next = clone(state);
  const b = Math.floor(cell / 9);
  const i = cell % 9;
  next.cells[cell] = seat + 1;
  next.last = cell;

  const small = lineWinner((k) => next.cells[b * 9 + k]);
  if (small) next.macro[b] = small.who;
  else if (boardFull(next.cells, b)) next.macro[b] = 3;

  const big = lineWinner((k) => next.macro[k]);
  if (big) {
    next.winner = big.who - 1;
    next.winLine = big.line;
    next.active = null;
    return done(next, [{ type: 'place', cell, seat }]);
  }
  if (next.macro.every((v) => v !== 0)) {
    const a = next.macro.filter((v) => v === 1).length;
    const c = next.macro.filter((v) => v === 2).length;
    next.winner = a === c ? 'draw' : a > c ? 0 : 1;
    next.active = null;
    return done(next, [{ type: 'place', cell, seat }]);
  }

  next.active = next.macro[i] === 0 ? i : null;
  next.turn = other(seat);
  return done(next, [{ type: 'place', cell, seat }]);
}

/* ── AI ───────────────────────────────────────────────────────────────────── */

const CELL_WEIGHT = [3, 2, 3, 2, 4, 2, 3, 2, 3];

function smallScore(cells, b, me) {
  const you = me === 1 ? 2 : 1;
  let score = 0;
  for (const [x, y, z] of LINES) {
    const trio = [cells[b * 9 + x], cells[b * 9 + y], cells[b * 9 + z]];
    const mine = trio.filter((v) => v === me).length;
    const theirs = trio.filter((v) => v === you).length;
    if (mine && theirs) continue;
    if (mine === 2) score += 6;
    else if (mine === 1) score += 1;
    if (theirs === 2) score -= 7;
    else if (theirs === 1) score -= 1;
  }
  for (let i = 0; i < 9; i++) {
    if (cells[b * 9 + i] === me) score += CELL_WEIGHT[i] * 0.4;
    else if (cells[b * 9 + i] === you) score -= CELL_WEIGHT[i] * 0.4;
  }
  return score;
}

function evaluate(state, me) {
  const you = me === 1 ? 2 : 1;
  let score = 0;
  for (let b = 0; b < 9; b++) {
    if (state.macro[b] === me) score += 28 * CELL_WEIGHT[b];
    else if (state.macro[b] === you) score -= 30 * CELL_WEIGHT[b];
    else if (state.macro[b] === 0) score += smallScore(state.cells, b, me);
  }
  for (const [x, y, z] of LINES) {
    const trio = [state.macro[x], state.macro[y], state.macro[z]];
    if (trio.includes(3)) continue;
    const mine = trio.filter((v) => v === me).length;
    const theirs = trio.filter((v) => v === you).length;
    if (mine && theirs) continue;
    if (mine === 2) score += 90;
    if (theirs === 2) score -= 100;
  }
  // Sending the opponent to a board where they are free to choose is a gift.
  if (state.active === null && state.turn === you - 1) score -= 15;
  return score;
}

function search(state, me, depth, alpha, beta) {
  if (state.winner !== null) {
    if (state.winner === 'draw') return { score: 0, move: null };
    return { score: state.winner === me - 1 ? 100000 + depth * 100 : -(100000 + depth * 100), move: null };
  }
  if (depth === 0) return { score: evaluate(state, me), move: null };

  const moves = legalMoves(state);
  const maximizing = state.turn === me - 1;
  let best = maximizing ? -Infinity : Infinity;
  let bestMove = moves[0] ?? null;

  for (const cell of moves) {
    const res = applyMove(state, state.turn, cell);
    if (!res.ok) continue;
    const value = search(res.state, me, depth - 1, alpha, beta).score;
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
  const moves = legalMoves(state);
  if (!moves.length) return null;
  if (level <= 1) return moves[Math.floor(Math.random() * moves.length)];
  const depth = level >= 3 ? 5 : 3;
  const { move } = search(state, seat + 1, depth, -Infinity, Infinity);
  return move ?? moves[0];
}
