/**
 * 오목 (Gomoku / Five in a Row) — 15x15, freestyle rules.
 *
 * Seat 0 plays black and moves first. Five or more stones in an unbroken
 * line wins. The AI scores threat patterns and searches a pruned candidate
 * set near existing stones, which is far cheaper than a full 225-wide search
 * and plays a respectable game.
 */
import { clone, fail, done, other, makeStatus } from './_engine.js';

export const SIZE = 15;
const N = SIZE * SIZE;
const DIRS = [
  [0, 1],
  [1, 0],
  [1, 1],
  [1, -1],
];

export const meta = {
  id: 'gomoku',
  name: '오목',
  nameEn: 'Gomoku',
  emoji: '⚫',
  category: '보드',
  mode: 'turn',
  ai: true,
  desc: '15×15 판에서 돌 다섯 개를 먼저 나란히 놓으면 이깁니다. 가장 고전적인 1대1 두뇌 대결.',
  rules: [
    '흑(선공)이 먼저 둡니다.',
    '가로·세로·대각선 중 어느 방향이든 자기 돌 5개를 연속으로 놓으면 승리합니다.',
    '금수 규칙이 없는 자유 오목(프리스타일)입니다. 6목 이상도 승리로 인정합니다.',
    '판이 가득 차면 무승부입니다.',
  ],
};

const at = (board, r, c) => (r < 0 || c < 0 || r >= SIZE || c >= SIZE ? -1 : board[r * SIZE + c]);

export function createState(opts = {}) {
  return {
    board: new Array(N).fill(0), // 0 empty, 1 seat0(black), 2 seat1(white)
    turn: 0,
    moves: [],
    last: null,
    winner: null,
    winLine: null,
    config: { size: SIZE, ...(opts.config || {}) },
  };
}

export function status(state) {
  if (state.winner !== null) {
    return makeStatus({
      phase: 'over',
      turn: null,
      winner: state.winner,
      scores: state.winner === 'draw' ? [0, 0] : state.winner === 0 ? [1, 0] : [0, 1],
      reason: state.winner === 'draw' ? '판이 가득 차 무승부' : '오목 완성',
    });
  }
  return makeStatus({ phase: 'playing', turn: state.turn, scores: [0, 0] });
}

export function legalMoves(state) {
  if (state.winner !== null) return [];
  const out = [];
  for (let i = 0; i < N; i++) if (state.board[i] === 0) out.push(i);
  return out;
}

/** Returns the winning line as an array of indices, or null. */
function findWin(board, idx, stone) {
  const r0 = Math.floor(idx / SIZE);
  const c0 = idx % SIZE;
  for (const [dr, dc] of DIRS) {
    const line = [idx];
    for (const sign of [1, -1]) {
      let r = r0 + dr * sign;
      let c = c0 + dc * sign;
      while (at(board, r, c) === stone) {
        line.push(r * SIZE + c);
        r += dr * sign;
        c += dc * sign;
      }
    }
    if (line.length >= 5) return line.sort((a, b) => a - b);
  }
  return null;
}

export function applyMove(state, seat, move) {
  if (state.winner !== null) return fail('이미 끝난 게임입니다.');
  if (seat !== state.turn) return fail('상대 차례입니다.');
  const idx = typeof move === 'number' ? move : move && typeof move.idx === 'number' ? move.idx : -1;
  if (!Number.isInteger(idx) || idx < 0 || idx >= N) return fail('판 밖입니다.');
  if (state.board[idx] !== 0) return fail('이미 돌이 놓인 자리입니다.');

  const next = clone(state);
  const stone = seat + 1;
  next.board[idx] = stone;
  next.moves.push(idx);
  next.last = idx;

  const line = findWin(next.board, idx, stone);
  if (line) {
    next.winner = seat;
    next.winLine = line;
  } else if (next.moves.length >= N) {
    next.winner = 'draw';
  } else {
    next.turn = other(seat);
  }
  return done(next, [{ type: 'place', idx, seat }]);
}

/* ── AI ───────────────────────────────────────────────────────────────────── */

// Scores for a run of `count` stones with `open` free ends.
const PATTERN = {
  5: 10000000,
  4: { 2: 500000, 1: 20000, 0: 0 },
  3: { 2: 15000, 1: 900, 0: 0 },
  2: { 2: 600, 1: 90, 0: 0 },
  1: { 2: 40, 1: 8, 0: 0 },
};

function scoreFor(board, stone) {
  let total = 0;
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      if (board[r * SIZE + c] !== stone) continue;
      for (const [dr, dc] of DIRS) {
        // Only count a run from its starting stone to avoid double counting.
        if (at(board, r - dr, c - dc) === stone) continue;
        let count = 0;
        let rr = r;
        let cc = c;
        while (at(board, rr, cc) === stone) {
          count++;
          rr += dr;
          cc += dc;
        }
        const openEnd = at(board, rr, cc) === 0 ? 1 : 0;
        const openStart = at(board, r - dr, c - dc) === 0 ? 1 : 0;
        const open = openEnd + openStart;
        if (count >= 5) total += PATTERN[5];
        else total += PATTERN[count][open];
      }
    }
  }
  return total;
}

/** Board evaluation from seat 0's perspective. */
function evaluate(board) {
  return scoreFor(board, 1) - scoreFor(board, 2) * 1.08;
}

/** Empty cells within `radius` of an existing stone — the only moves worth trying. */
function candidates(board, radius = 2) {
  const seen = new Set();
  let any = false;
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      if (board[r * SIZE + c] === 0) continue;
      any = true;
      for (let dr = -radius; dr <= radius; dr++) {
        for (let dc = -radius; dc <= radius; dc++) {
          const rr = r + dr;
          const cc = c + dc;
          if (rr < 0 || cc < 0 || rr >= SIZE || cc >= SIZE) continue;
          if (board[rr * SIZE + cc] === 0) seen.add(rr * SIZE + cc);
        }
      }
    }
  }
  if (!any) return [Math.floor(N / 2)];
  return [...seen];
}

/** Order candidates by a cheap one-ply score so alpha-beta prunes early. */
function ordered(board, stone, limit) {
  const mine = stone;
  const theirs = stone === 1 ? 2 : 1;
  const scored = candidates(board).map((idx) => {
    board[idx] = mine;
    const attack = scoreFor(board, mine);
    board[idx] = theirs;
    const defend = scoreFor(board, theirs);
    board[idx] = 0;
    return { idx, s: attack + defend * 1.02 };
  });
  scored.sort((a, b) => b.s - a.s);
  return scored.slice(0, limit).map((x) => x.idx);
}

function search(board, stone, depth, alpha, beta, width) {
  // Negamax: always report the score from `stone`'s point of view.
  if (depth === 0) return { score: stone === 1 ? evaluate(board) : -evaluate(board), move: null };
  const moves = ordered(board, stone, width);
  let best = -Infinity;
  let bestMove = moves[0] ?? null;
  const opp = stone === 1 ? 2 : 1;
  for (const idx of moves) {
    board[idx] = stone;
    const win = findWin(board, idx, stone);
    let value;
    if (win) {
      value = PATTERN[5] + depth * 1000;
    } else {
      value = -search(board, opp, depth - 1, -beta, -alpha, width).score;
    }
    board[idx] = 0;
    if (value > best) {
      best = value;
      bestMove = idx;
    }
    if (value > alpha) alpha = value;
    if (alpha >= beta) break;
  }
  return { score: best, move: bestMove };
}

export function ai(state, seat, level = 2) {
  if (state.winner !== null) return null;
  const board = state.board.slice();
  const stone = seat + 1;
  const opp = stone === 1 ? 2 : 1;

  // Take the win if there is one; otherwise block the opponent's. Both are
  // cheap to check exactly, and no search result should ever override them.
  for (const probe of [stone, opp]) {
    for (const idx of candidates(board)) {
      board[idx] = probe;
      const win = findWin(board, idx, probe);
      board[idx] = 0;
      if (win) return idx;
    }
  }

  if (level <= 1) {
    const list = ordered(board, stone, 6);
    return list[Math.floor(Math.random() * Math.min(3, list.length))] ?? candidates(board)[0];
  }
  const depth = level >= 3 ? 4 : 2;
  const width = level >= 3 ? 10 : 12;
  const { move } = search(board, stone, depth, -Infinity, Infinity, width);
  return move ?? candidates(board)[0];
}
