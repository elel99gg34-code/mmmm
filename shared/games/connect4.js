/**
 * 커넥트4 (Connect Four) — 7 columns × 6 rows.
 *
 * Small enough for exact search: the AI is a plain negamax with alpha-beta
 * over column order, which at depth 7 already plays near-perfect openings.
 */
import { clone, fail, done, other, makeStatus } from './_engine.js';

export const COLS = 7;
export const ROWS = 6;
const N = COLS * ROWS;

export const meta = {
  id: 'connect4',
  name: '커넥트4',
  nameEn: 'Connect Four',
  emoji: '🔴',
  category: '보드',
  mode: 'turn',
  ai: true,
  desc: '동전을 떨어뜨려 네 개를 나란히. 규칙은 1분이면 배우고, 수읽기는 끝이 없습니다.',
  rules: [
    '빨강(선공)이 먼저 놓습니다.',
    '열을 고르면 동전이 가장 아래 빈칸으로 떨어집니다.',
    '가로·세로·대각선으로 4개를 먼저 연결하면 승리합니다.',
    '42칸이 모두 차면 무승부입니다.',
  ],
};

const idx = (r, c) => r * COLS + c;
const cellAt = (board, r, c) => (r < 0 || c < 0 || r >= ROWS || c >= COLS ? -1 : board[idx(r, c)]);

export function createState() {
  return {
    board: new Array(N).fill(0), // 0 empty, 1 seat0, 2 seat1
    turn: 0,
    last: null,
    winner: null,
    winLine: null,
    plies: 0,
  };
}

export function status(state) {
  if (state.winner !== null) {
    return makeStatus({
      phase: 'over',
      turn: null,
      winner: state.winner,
      scores: state.winner === 'draw' ? [0, 0] : state.winner === 0 ? [1, 0] : [0, 1],
      reason: state.winner === 'draw' ? '판이 가득 차 무승부' : '4목 완성',
    });
  }
  return makeStatus({ phase: 'playing', turn: state.turn });
}

export function legalMoves(state) {
  if (state.winner !== null) return [];
  const out = [];
  for (let c = 0; c < COLS; c++) if (state.board[idx(0, c)] === 0) out.push(c);
  return out;
}

function dropRow(board, col) {
  for (let r = ROWS - 1; r >= 0; r--) if (board[idx(r, col)] === 0) return r;
  return -1;
}

function findWin(board, r, c) {
  const stone = board[idx(r, c)];
  if (!stone) return null;
  for (const [dr, dc] of [[0, 1], [1, 0], [1, 1], [1, -1]]) {
    const line = [idx(r, c)];
    for (const sign of [1, -1]) {
      let rr = r + dr * sign;
      let cc = c + dc * sign;
      while (cellAt(board, rr, cc) === stone) {
        line.push(idx(rr, cc));
        rr += dr * sign;
        cc += dc * sign;
      }
    }
    if (line.length >= 4) return line.sort((a, b) => a - b);
  }
  return null;
}

export function applyMove(state, seat, move) {
  if (state.winner !== null) return fail('이미 끝난 게임입니다.');
  if (seat !== state.turn) return fail('상대 차례입니다.');
  const col = typeof move === 'number' ? move : move?.col;
  if (!Number.isInteger(col) || col < 0 || col >= COLS) return fail('없는 열입니다.');
  const row = dropRow(state.board, col);
  if (row < 0) return fail('그 열은 가득 찼습니다.');

  const next = clone(state);
  next.board[idx(row, col)] = seat + 1;
  next.last = idx(row, col);
  next.plies++;

  const line = findWin(next.board, row, col);
  if (line) {
    next.winner = seat;
    next.winLine = line;
  } else if (next.plies >= N) {
    next.winner = 'draw';
  } else {
    next.turn = other(seat);
  }
  return done(next, [{ type: 'drop', col, row, seat }]);
}

/* ── AI ───────────────────────────────────────────────────────────────────── */

const CENTER_ORDER = [3, 2, 4, 1, 5, 0, 6];

function windowScore(cells, me) {
  const you = me === 1 ? 2 : 1;
  let mine = 0;
  let theirs = 0;
  let empty = 0;
  for (const v of cells) {
    if (v === me) mine++;
    else if (v === you) theirs++;
    else empty++;
  }
  if (mine && theirs) return 0;
  if (mine === 4) return 100000;
  if (theirs === 4) return -100000;
  if (mine === 3 && empty === 1) return 120;
  if (theirs === 3 && empty === 1) return -150;
  if (mine === 2 && empty === 2) return 12;
  if (theirs === 2 && empty === 2) return -14;
  return 0;
}

function evaluate(board, me) {
  let score = 0;
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      if (board[idx(r, c)] === me) score += [3, 4, 5, 7, 5, 4, 3][c];
      for (const [dr, dc] of [[0, 1], [1, 0], [1, 1], [1, -1]]) {
        const rEnd = r + dr * 3;
        const cEnd = c + dc * 3;
        if (rEnd < 0 || rEnd >= ROWS || cEnd < 0 || cEnd >= COLS) continue;
        score += windowScore([0, 1, 2, 3].map((k) => board[idx(r + dr * k, c + dc * k)]), me);
      }
    }
  }
  return score;
}

function search(board, me, turnStone, depth, alpha, beta) {
  const cols = CENTER_ORDER.filter((c) => board[idx(0, c)] === 0);
  if (cols.length === 0) return { score: 0, move: null };

  let best = -Infinity;
  let bestMove = cols[0];
  const opp = turnStone === 1 ? 2 : 1;

  for (const col of cols) {
    const row = dropRow(board, col);
    board[idx(row, col)] = turnStone;
    let value;
    if (findWin(board, row, col)) {
      value = turnStone === me ? 100000 + depth * 100 : -(100000 + depth * 100);
    } else if (depth === 1) {
      value = evaluate(board, me);
    } else {
      value = search(board, me, opp, depth - 1, alpha, beta).score;
    }
    board[idx(row, col)] = 0;

    if (turnStone === me) {
      if (value > best || best === -Infinity) {
        best = value;
        bestMove = col;
      }
      alpha = Math.max(alpha, value);
    } else {
      if (best === -Infinity || value < best) {
        best = value;
        bestMove = col;
      }
      beta = Math.min(beta, value);
    }
    if (alpha >= beta) break;
  }
  return { score: best, move: bestMove };
}

export function ai(state, seat, level = 2) {
  if (state.winner !== null) return null;
  const board = state.board.slice();
  const me = seat + 1;
  const opp = me === 1 ? 2 : 1;
  const open = legalMoves(state);
  if (open.length === 0) return null;

  // Exact tactics first: win now, else block their win now.
  for (const probe of [me, opp]) {
    for (const col of open) {
      const row = dropRow(board, col);
      board[idx(row, col)] = probe;
      const win = findWin(board, row, col);
      board[idx(row, col)] = 0;
      if (win) return col;
    }
  }

  if (level <= 1) return open[Math.floor(Math.random() * open.length)];
  const depth = level >= 3 ? 7 : 5;
  const { move } = search(board, me, me, depth, -Infinity, Infinity);
  return move ?? open[0];
}
