/**
 * 체커 (English draughts) — 8x8, 12 pieces each, capture is compulsory.
 *
 * Moves are expressed as a path: `[from, to]` for a simple slide, or
 * `[from, over1, over2, ...]` for a multi-jump. The engine always generates
 * complete jump sequences, so a half-finished chain is never a legal move.
 */
import { clone, fail, done, other, makeStatus } from './_engine.js';

export const SIZE = 8;
const N = SIZE * SIZE;

// 1 = seat0 man, 2 = seat0 king, 3 = seat1 man, 4 = seat1 king.
const ownerOf = (v) => (v === 0 ? -1 : v <= 2 ? 0 : 1);
const isKing = (v) => v === 2 || v === 4;
const manFor = (seat) => (seat === 0 ? 1 : 3);
const kingFor = (seat) => (seat === 0 ? 2 : 4);

export const meta = {
  id: 'checkers',
  name: '체커',
  nameEn: 'Checkers',
  emoji: '🔶',
  category: '보드',
  mode: 'turn',
  ai: true,
  desc: '잡을 수 있으면 반드시 잡아야 합니다. 한 수로 연속 점프를 노리는 계산 싸움.',
  rules: [
    '흰 말(선공)이 먼저 움직이며 위쪽으로, 검은 말은 아래쪽으로 전진합니다.',
    '대각선 한 칸 이동, 상대 말을 뛰어넘으면 잡습니다.',
    '잡을 수 있는 수가 하나라도 있으면 반드시 잡아야 합니다.',
    '연속으로 잡을 수 있으면 한 턴에 이어서 잡습니다.',
    '맨 끝줄에 도달하면 킹이 되어 양방향으로 움직입니다.',
    '움직일 수 없거나 말이 모두 잡히면 패배합니다.',
  ],
};

const rc = (i) => [Math.floor(i / SIZE), i % SIZE];
const at = (b, r, c) => (r < 0 || c < 0 || r >= SIZE || c >= SIZE ? -1 : b[r * SIZE + c]);

export function createState() {
  const board = new Array(N).fill(0);
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < SIZE; c++) if ((r + c) % 2 === 1) board[r * SIZE + c] = 3;
  }
  for (let r = SIZE - 3; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) if ((r + c) % 2 === 1) board[r * SIZE + c] = 1;
  }
  return { board, turn: 0, last: null, winner: null, idle: 0, captured: [0, 0] };
}

function dirsFor(piece, seat) {
  if (isKing(piece)) return [[-1, -1], [-1, 1], [1, -1], [1, 1]];
  return seat === 0 ? [[-1, -1], [-1, 1]] : [[1, -1], [1, 1]];
}

/** All jump chains starting from square `from`. Returns array of paths. */
function jumpsFrom(board, from, seat, piece) {
  const results = [];
  const walk = (b, sq, pc, path, taken) => {
    const [r, c] = rc(sq);
    let extended = false;
    for (const [dr, dc] of dirsFor(pc, seat)) {
      const mr = r + dr;
      const mc = c + dc;
      const lr = r + dr * 2;
      const lc = c + dc * 2;
      const mid = at(b, mr, mc);
      const land = at(b, lr, lc);
      if (mid <= 0 || land !== 0) continue;
      if (ownerOf(mid) !== other(seat)) continue;
      const midSq = mr * SIZE + mc;
      if (taken.includes(midSq)) continue;

      const nb = b.slice();
      nb[sq] = 0;
      nb[midSq] = 0;
      const promoted = !isKing(pc) && (seat === 0 ? lr === 0 : lr === SIZE - 1);
      const newPiece = promoted ? kingFor(seat) : pc;
      nb[lr * SIZE + lc] = newPiece;
      extended = true;
      // Crowning ends the turn in English draughts.
      if (promoted) results.push([...path, lr * SIZE + lc]);
      else walk(nb, lr * SIZE + lc, newPiece, [...path, lr * SIZE + lc], [...taken, midSq]);
    }
    if (!extended && path.length > 1) results.push(path);
  };
  walk(board, from, piece, [from], []);
  // `walk` pushes on dead ends; dedupe identical paths.
  const seen = new Set();
  return results.filter((p) => {
    const key = p.join(',');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function legalMoves(state, seat) {
  if (state.winner !== null) return [];
  const who = seat === undefined ? state.turn : seat;
  if (who !== state.turn) return [];

  const jumps = [];
  const slides = [];
  for (let i = 0; i < N; i++) {
    const piece = state.board[i];
    if (piece === 0 || ownerOf(piece) !== who) continue;
    const chains = jumpsFrom(state.board, i, who, piece);
    if (chains.length) jumps.push(...chains);
  }
  if (jumps.length) return jumps;

  for (let i = 0; i < N; i++) {
    const piece = state.board[i];
    if (piece === 0 || ownerOf(piece) !== who) continue;
    const [r, c] = rc(i);
    for (const [dr, dc] of dirsFor(piece, who)) {
      if (at(state.board, r + dr, c + dc) === 0) slides.push([i, (r + dr) * SIZE + (c + dc)]);
    }
  }
  return slides;
}

export function status(state) {
  if (state.winner !== null) {
    return makeStatus({
      phase: 'over',
      turn: null,
      winner: state.winner,
      scores: state.captured,
      reason:
        state.winner === 'draw' ? '40수 동안 진전이 없어 무승부' : '상대가 움직일 수 없어 승리',
    });
  }
  return makeStatus({ phase: 'playing', turn: state.turn, scores: state.captured });
}

function pathEquals(a, b) {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

export function applyMove(state, seat, move) {
  if (state.winner !== null) return fail('이미 끝난 게임입니다.');
  if (seat !== state.turn) return fail('상대 차례입니다.');
  const path = Array.isArray(move) ? move : move?.path;
  if (!Array.isArray(path) || path.length < 2) return fail('이동 경로가 올바르지 않습니다.');

  const options = legalMoves(state, seat);
  const chosen = options.find((p) => pathEquals(p, path));
  if (!chosen) {
    const mustJump = options.some((p) => Math.abs(rc(p[0])[0] - rc(p[1])[0]) === 2);
    return fail(mustJump ? '잡을 수 있을 때는 반드시 잡아야 합니다.' : '둘 수 없는 이동입니다.');
  }

  const next = clone(state);
  let piece = next.board[chosen[0]];
  const startedAsMan = piece === manFor(seat);
  next.board[chosen[0]] = 0;
  let captures = 0;

  for (let k = 1; k < chosen.length; k++) {
    const [pr, pc] = rc(chosen[k - 1]);
    const [nr, nc] = rc(chosen[k]);
    if (Math.abs(nr - pr) === 2) {
      const midSq = ((pr + nr) / 2) * SIZE + (pc + nc) / 2;
      if (next.board[midSq]) captures++;
      next.board[midSq] = 0;
    }
    if (!isKing(piece) && (seat === 0 ? nr === 0 : nr === SIZE - 1)) piece = kingFor(seat);
  }
  next.board[chosen[chosen.length - 1]] = piece;
  next.last = chosen;
  next.captured = [...state.captured];
  next.captured[seat] += captures;
  // The draw clock only resets on progress: a capture or a new king.
  const promoted = startedAsMan && isKing(piece);
  next.idle = captures > 0 || promoted ? 0 : state.idle + 1;

  const opp = other(seat);
  next.turn = opp;

  if (!legalMoves(next, opp).length) {
    next.winner = seat;
    next.turn = null;
  } else if (next.idle >= 80) {
    next.winner = 'draw';
    next.turn = null;
  }
  return done(next, [{ type: 'move', path: chosen, seat, captures }]);
}

/* ── AI ───────────────────────────────────────────────────────────────────── */

function evaluate(state, me) {
  let score = 0;
  for (let i = 0; i < N; i++) {
    const piece = state.board[i];
    if (!piece) continue;
    const owner = ownerOf(piece);
    const [r, c] = rc(i);
    let value = isKing(piece) ? 155 : 100;
    if (!isKing(piece)) {
      // Advancement toward promotion.
      value += owner === 0 ? (SIZE - 1 - r) * 4 : r * 4;
    }
    if (c === 0 || c === SIZE - 1) value += 6; // edges cannot be jumped
    if (r === 0 || r === SIZE - 1) value += 4;
    score += owner === me ? value : -value;
  }
  return score;
}

function search(state, me, depth, alpha, beta) {
  if (state.winner !== null) {
    if (state.winner === 'draw') return { score: 0, move: null };
    return { score: state.winner === me ? 90000 + depth * 100 : -(90000 + depth * 100), move: null };
  }
  if (depth === 0) return { score: evaluate(state, me), move: null };

  const moves = legalMoves(state, state.turn);
  if (!moves.length) return { score: state.turn === me ? -90000 : 90000, move: null };

  const maximizing = state.turn === me;
  let best = maximizing ? -Infinity : Infinity;
  let bestMove = moves[0];
  for (const mv of moves) {
    const res = applyMove(state, state.turn, mv);
    if (!res.ok) continue;
    const value = search(res.state, me, depth - 1, alpha, beta).score;
    if (maximizing ? value > best : value < best) {
      best = value;
      bestMove = mv;
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
  if (moves.length === 1) return moves[0];
  if (level <= 1) return moves[Math.floor(Math.random() * moves.length)];
  const depth = level >= 3 ? 7 : 5;
  const { move } = search(state, seat, depth, -Infinity, Infinity);
  return move ?? moves[0];
}
