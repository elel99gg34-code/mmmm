/**
 * 2048 듀얼 — same tile-spawn luck, two boards, higher score wins.
 *
 * Each seat has its own grid but draws spawns from the same seeded stream
 * (`seed:seat:spawnCount`), so neither player can blame the dice. Every slide
 * is replayed by the server, which makes the score a fact rather than a claim.
 */
import { clone, fail, done, makeStatus } from './_engine.js';
import { Rng } from '../rng.js';

export const meta = {
  id: 'g2048',
  name: '2048 듀얼',
  nameEn: '2048 Duel',
  emoji: '🔢',
  category: '퍼즐',
  mode: 'race',
  ai: false,
  solo: true,
  desc: '같은 숫자를 밀어 합칩니다. 제한 시간 안에 더 높은 점수를 낸 쪽이 승리.',
  rules: [
    '방향키(또는 스와이프)로 판 전체를 밀어 같은 숫자를 합칩니다.',
    '합쳐진 숫자만큼 점수를 얻습니다.',
    '두 사람의 타일 등장 순서는 동일한 규칙으로 정해집니다.',
    '제한 시간이 끝나거나 둘 다 움직일 수 없으면 점수가 높은 쪽이 승리합니다.',
  ],
};

export const DEFAULTS = { size: 4, timeLimit: 180000 };
export const DIRS = ['up', 'down', 'left', 'right'];

function emptyCells(grid) {
  const out = [];
  for (let i = 0; i < grid.length; i++) if (grid[i] === 0) out.push(i);
  return out;
}

/** Deterministic spawn: the nth tile for a seat is always the same tile. */
function spawn(grid, seed, seat, spawnCount) {
  const free = emptyCells(grid);
  if (!free.length) return false;
  const rng = new Rng(`${seed}:${seat}:${spawnCount}`);
  const cell = free[rng.int(0, free.length - 1)];
  grid[cell] = rng.float() < 0.9 ? 2 : 4;
  return true;
}

/** Squash one line toward index 0. Returns `{ line, gained, moved }`. */
export function squash(line) {
  const kept = line.filter((v) => v !== 0);
  const out = [];
  let gained = 0;
  for (let i = 0; i < kept.length; i++) {
    if (i + 1 < kept.length && kept[i] === kept[i + 1]) {
      const merged = kept[i] * 2;
      out.push(merged);
      gained += merged;
      i++; // a tile that just merged cannot merge again this move
    } else {
      out.push(kept[i]);
    }
  }
  while (out.length < line.length) out.push(0);
  return { line: out, gained, moved: out.some((v, i) => v !== line[i]) };
}

/** Indices of one row/column, ordered so that index 0 is the direction of travel. */
function lineIndices(size, dir, k) {
  const out = [];
  for (let i = 0; i < size; i++) {
    if (dir === 'left') out.push(k * size + i);
    else if (dir === 'right') out.push(k * size + (size - 1 - i));
    else if (dir === 'up') out.push(i * size + k);
    else out.push((size - 1 - i) * size + k);
  }
  return out;
}

export function slide(grid, size, dir) {
  const next = grid.slice();
  let gained = 0;
  let moved = false;
  for (let k = 0; k < size; k++) {
    const idxs = lineIndices(size, dir, k);
    const res = squash(idxs.map((i) => next[i]));
    if (res.moved) moved = true;
    gained += res.gained;
    idxs.forEach((idx, i) => {
      next[idx] = res.line[i];
    });
  }
  return { grid: next, gained, moved };
}

export function canMove(grid, size) {
  return DIRS.some((dir) => slide(grid, size, dir).moved);
}

export function createState(opts = {}) {
  const config = { ...DEFAULTS, ...(opts.config || {}) };
  const now = opts.now ?? Date.now();
  const seed = opts.seed || '2048';
  const size = config.size;

  const grids = [];
  const spawns = [];
  for (const seat of [0, 1]) {
    const grid = new Array(size * size).fill(0);
    spawn(grid, seed, seat, 0);
    spawn(grid, seed, seat, 1);
    grids.push(grid);
    spawns.push(2);
  }

  return {
    config,
    seed,
    grids,
    spawns,
    scores: [0, 0],
    best: [0, 0],
    moves: [0, 0],
    dead: [false, false],
    startedAt: now,
    deadline: now + config.timeLimit,
    winner: null,
    reason: '',
  };
}

export function status(state) {
  if (state.winner !== null) {
    return makeStatus({ phase: 'over', turn: null, winner: state.winner, scores: state.scores, reason: state.reason });
  }
  return makeStatus({ phase: 'playing', turn: null, scores: state.scores });
}

function settle(next, now) {
  const timeUp = now >= next.deadline;
  if (!timeUp && !(next.dead[0] && next.dead[1])) return false;
  const [a, b] = next.scores;
  next.winner = a === b ? 'draw' : a > b ? 0 : 1;
  next.reason = timeUp ? `시간 종료 — ${a}점 vs ${b}점` : `둘 다 막힘 — ${a}점 vs ${b}점`;
  return true;
}

export function applyMove(state, seat, move, ctx = {}) {
  const now = ctx.now ?? Date.now();
  if (state.winner !== null) return fail('이미 끝난 게임입니다.');
  if (!move || move.type !== 'move') return fail('알 수 없는 동작입니다.');
  if (state.dead[seat]) return fail('더 이상 움직일 수 없습니다.');
  if (!DIRS.includes(move.dir)) return fail('없는 방향입니다.');
  if (now >= state.deadline) return fail('시간이 끝났습니다.');

  const size = state.config.size;
  const res = slide(state.grids[seat], size, move.dir);
  if (!res.moved) return fail('그 방향으로는 움직일 수 없습니다.');

  const next = clone(state);
  next.grids[seat] = res.grid;
  next.scores[seat] += res.gained;
  next.moves[seat] += 1;
  spawn(next.grids[seat], next.seed, seat, next.spawns[seat]);
  next.spawns[seat] += 1;
  next.best[seat] = Math.max(...next.grids[seat]);
  if (!canMove(next.grids[seat], size)) next.dead[seat] = true;

  settle(next, now);
  return done(next, [{ type: 'move', seat, dir: move.dir, gained: res.gained }]);
}

export function tick(state, now = Date.now()) {
  if (state.winner !== null) return { state, changed: false };
  const next = clone(state);
  const changed = settle(next, now);
  return { state: changed ? next : state, changed };
}
