/**
 * 점과 상자 (Dots and Boxes) — 5x5 boxes on a 6x6 grid of dots.
 *
 * Edges are addressed by a single flat index: `0 .. H-1` are horizontal edges
 * in row-major order, `H .. H+V-1` are vertical ones. Closing a box scores a
 * point and grants another turn, which is where the whole chain strategy lives.
 */
import { clone, fail, done, other, makeStatus } from './_engine.js';

export const ROWS = 5;
export const COLS = 5;
export const H_COUNT = (ROWS + 1) * COLS;
export const V_COUNT = ROWS * (COLS + 1);
export const EDGES = H_COUNT + V_COUNT;

export const meta = {
  id: 'dotsboxes',
  name: '점과 상자',
  nameEn: 'Dots & Boxes',
  emoji: '🔲',
  category: '전략',
  mode: 'turn',
  ai: true,
  desc: '선을 하나씩 긋다가 상자를 완성하면 한 번 더. 언제 사슬을 넘겨줄지가 승부입니다.',
  rules: [
    '차례마다 점과 점 사이에 선을 하나 긋습니다.',
    '상자의 네 변을 마지막으로 채우면 그 상자를 차지하고 한 번 더 긋습니다.',
    '모든 선이 그어지면 게임이 끝납니다.',
    '차지한 상자가 많은 쪽이 승리합니다.',
  ],
};

export const hIndex = (r, c) => r * COLS + c;
export const vIndex = (r, c) => H_COUNT + r * (COLS + 1) + c;

/** The four edges enclosing box (r, c). */
export function boxEdges(r, c) {
  return [hIndex(r, c), hIndex(r + 1, c), vIndex(r, c), vIndex(r, c + 1)];
}

export function createState() {
  return {
    edges: new Array(EDGES).fill(0), // 0 = undrawn, 1 = seat0, 2 = seat1
    boxes: new Array(ROWS * COLS).fill(0), // 0 = open, 1 = seat0, 2 = seat1
    turn: 0,
    last: null,
    scores: [0, 0],
    winner: null,
  };
}

export function legalMoves(state) {
  if (state.winner !== null) return [];
  const out = [];
  for (let i = 0; i < EDGES; i++) if (state.edges[i] === 0) out.push(i);
  return out;
}

export function status(state) {
  if (state.winner !== null) {
    return makeStatus({
      phase: 'over',
      turn: null,
      winner: state.winner,
      scores: state.scores,
      reason: `${state.scores[0]} : ${state.scores[1]}`,
    });
  }
  return makeStatus({ phase: 'playing', turn: state.turn, scores: state.scores });
}

function sidesDrawn(edges, r, c) {
  return boxEdges(r, c).reduce((n, e) => n + (edges[e] ? 1 : 0), 0);
}

export function applyMove(state, seat, move) {
  if (state.winner !== null) return fail('이미 끝난 게임입니다.');
  if (seat !== state.turn) return fail('상대 차례입니다.');
  const edge = typeof move === 'number' ? move : move?.edge;
  if (!Number.isInteger(edge) || edge < 0 || edge >= EDGES) return fail('없는 선입니다.');
  if (state.edges[edge] !== 0) return fail('이미 그어진 선입니다.');

  const next = clone(state);
  next.edges[edge] = seat + 1;
  next.last = edge;

  const claimed = [];
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const b = r * COLS + c;
      if (next.boxes[b] !== 0) continue;
      if (boxEdges(r, c).includes(edge) && sidesDrawn(next.edges, r, c) === 4) {
        next.boxes[b] = seat + 1;
        next.scores[seat]++;
        claimed.push(b);
      }
    }
  }

  if (next.edges.every((v) => v !== 0)) {
    next.winner = next.scores[0] === next.scores[1] ? 'draw' : next.scores[0] > next.scores[1] ? 0 : 1;
    next.turn = null;
  } else if (claimed.length === 0) {
    next.turn = other(seat);
  }
  return done(next, [{ type: 'edge', edge, seat, claimed }]);
}

/* ── AI ───────────────────────────────────────────────────────────────────── */

/** Edges that complete a box right now. */
function completing(state) {
  const out = [];
  for (const e of legalMoves(state)) {
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        if (state.boxes[r * COLS + c] !== 0) continue;
        const es = boxEdges(r, c);
        if (es.includes(e) && es.filter((x) => state.edges[x]).length === 3) {
          out.push(e);
          break;
        }
      }
    }
  }
  return [...new Set(out)];
}

/** Edges that leave every touched box with at most 2 sides — the safe moves. */
function safeMoves(state) {
  return legalMoves(state).filter((e) => {
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        if (state.boxes[r * COLS + c] !== 0) continue;
        const es = boxEdges(r, c);
        if (es.includes(e) && es.filter((x) => state.edges[x]).length >= 2) return false;
      }
    }
    return true;
  });
}

/** How many boxes the opponent would gift-take after `edge`. */
function chainCost(state, edge, seat) {
  const res = applyMove(state, seat, edge);
  if (!res.ok) return 99;
  let s = res.state;
  let taken = 0;
  const opp = other(seat);
  if (s.turn !== opp) return 0;
  // Greedily let the opponent hoover up every free box.
  for (let guard = 0; guard < EDGES; guard++) {
    const free = completing(s);
    if (!free.length) break;
    const step = applyMove(s, s.turn, free[0]);
    if (!step.ok) break;
    taken++;
    s = step.state;
  }
  return taken;
}

export function ai(state, seat, level = 2) {
  const moves = legalMoves(state);
  if (!moves.length) return null;
  if (level <= 1) return moves[Math.floor(Math.random() * moves.length)];

  // Always take a free box.
  const free = completing(state);
  if (free.length) {
    if (level < 3) return free[0];
    // At the top level, consider leaving the last two boxes of a chain as a
    // "double cross" so the opponent is forced to open the next chain.
    let best = free[0];
    let bestCost = Infinity;
    for (const e of free) {
      const cost = chainCost(state, e, seat);
      if (cost < bestCost) {
        bestCost = cost;
        best = e;
      }
    }
    return best;
  }

  const safe = safeMoves(state);
  if (safe.length) return safe[Math.floor(Math.random() * safe.length)];

  // Everything opens something: pick the move that gives away the least.
  let best = moves[0];
  let bestCost = Infinity;
  for (const e of moves) {
    const cost = chainCost(state, e, seat);
    if (cost < bestCost) {
      bestCost = cost;
      best = e;
    }
  }
  return best;
}
