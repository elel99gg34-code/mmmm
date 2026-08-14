/**
 * 스네이크 듀얼 (Snake Duel) — two snakes, two boards, one clock.
 *
 * Real time, but still refereed: clients send *direction changes*, not
 * positions. The simulation is a pure function of the seed plus the ordered
 * input log, so `tick()` on the server and `tick()` in the browser produce the
 * same board. Nobody teleports and nobody reports a score they did not earn.
 */
import { clone, fail, done, makeStatus } from './_engine.js';
import { Rng } from '../rng.js';

export const meta = {
  id: 'snake',
  name: '스네이크 듀얼',
  nameEn: 'Snake Duel',
  emoji: '🐍',
  category: '순발력',
  mode: 'race',
  ai: false,
  solo: true,
  desc: '먹을수록 길어지고, 길어질수록 위험해집니다. 제한 시간 안에 더 많이 먹는 쪽이 승리.',
  rules: [
    '방향키(또는 스와이프)로 뱀을 조종합니다.',
    '먹이를 먹으면 점수가 오르고 몸이 길어집니다.',
    '벽이나 자기 몸에 부딪히면 그 자리에서 끝납니다.',
    '제한 시간이 끝나거나 둘 다 죽으면 점수가 높은 쪽이 승리합니다.',
    '점수가 같으면 더 오래 살아남은 쪽이 승리합니다.',
  ],
};

export const DEFAULTS = { w: 20, h: 16, tickMs: 115, timeLimit: 120000 };
export const VECTORS = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };

const key = (x, y) => `${x},${y}`;

function spawnFood(snakeBody, seed, seat, foodCount, config) {
  const taken = new Set(snakeBody.map(([x, y]) => key(x, y)));
  const free = [];
  for (let y = 0; y < config.h; y++) {
    for (let x = 0; x < config.w; x++) if (!taken.has(key(x, y))) free.push([x, y]);
  }
  if (!free.length) return null;
  const rng = new Rng(`${seed}:food:${seat}:${foodCount}`);
  return free[rng.int(0, free.length - 1)];
}

function newSnake(seed, seat, config) {
  const y = Math.floor(config.h / 2);
  const x = Math.floor(config.w / 4) + (seat === 1 ? Math.floor(config.w / 2) : 0);
  const body = [
    [x, y],
    [x - 1, y],
    [x - 2, y],
  ];
  return {
    body,
    dir: 'right',
    queued: [],
    alive: true,
    score: 0,
    grow: 0,
    foodCount: 0,
    deathTick: null,
    food: spawnFood(body, seed, seat, 0, config),
  };
}

export function createState(opts = {}) {
  const config = { ...DEFAULTS, ...(opts.config || {}) };
  const now = opts.now ?? Date.now();
  const seed = opts.seed || 'snake';
  return {
    config,
    seed,
    startedAt: now,
    deadline: now + config.timeLimit,
    tickIndex: 0,
    snakes: [newSnake(seed, 0, config), newSnake(seed, 1, config)],
    winner: null,
    reason: '',
  };
}

export function status(state) {
  const scores = state.snakes.map((s) => s.score);
  if (state.winner !== null) {
    return makeStatus({ phase: 'over', turn: null, winner: state.winner, scores, reason: state.reason });
  }
  return makeStatus({ phase: 'playing', turn: null, scores });
}

const OPPOSITE = { up: 'down', down: 'up', left: 'right', right: 'left' };

export function applyMove(state, seat, move) {
  if (state.winner !== null) return fail('이미 끝난 게임입니다.');
  if (!move || move.type !== 'dir') return fail('알 수 없는 동작입니다.');
  if (!VECTORS[move.dir]) return fail('없는 방향입니다.');
  const snake = state.snakes[seat];
  if (!snake.alive) return fail('이미 끝났습니다.');

  // Compare against the last *queued* turn, not the current heading, so a
  // fast double-tap (right, then down) is not silently swallowed.
  const facing = snake.queued.length ? snake.queued[snake.queued.length - 1] : snake.dir;
  if (move.dir === facing || move.dir === OPPOSITE[facing]) return { ok: true, state };

  const next = clone(state);
  // Two buffered turns is enough for a corner; more is just input lag.
  if (next.snakes[seat].queued.length < 2) next.snakes[seat].queued.push(move.dir);
  return done(next, [{ type: 'dir', seat, dir: move.dir }]);
}

/** Advance one snake by a single step. Mutates `snake`. */
function step(snake, seat, seed, config, tickIndex) {
  if (!snake.alive) return;
  if (snake.queued.length) snake.dir = snake.queued.shift();

  const [dx, dy] = VECTORS[snake.dir];
  const [hx, hy] = snake.body[0];
  const nx = hx + dx;
  const ny = hy + dy;

  if (nx < 0 || ny < 0 || nx >= config.w || ny >= config.h) {
    snake.alive = false;
    snake.deathTick = tickIndex;
    return;
  }
  // The tail square frees up on the same tick unless we are growing into it.
  const body = snake.grow > 0 ? snake.body : snake.body.slice(0, -1);
  if (body.some(([x, y]) => x === nx && y === ny)) {
    snake.alive = false;
    snake.deathTick = tickIndex;
    return;
  }

  snake.body = [[nx, ny], ...body];
  if (snake.grow > 0) snake.grow -= 1;

  if (snake.food && snake.food[0] === nx && snake.food[1] === ny) {
    snake.score += 10;
    snake.grow += 2;
    snake.foodCount += 1;
    snake.food = spawnFood(snake.body, seed, seat, snake.foodCount, config);
  }
}

function settle(next, now) {
  const bothDead = next.snakes.every((s) => !s.alive);
  const timeUp = now >= next.deadline;
  if (!bothDead && !timeUp) return false;

  const [a, b] = next.snakes;
  if (a.score !== b.score) {
    next.winner = a.score > b.score ? 0 : 1;
  } else {
    const life = (s) => (s.alive ? Infinity : s.deathTick ?? 0);
    next.winner = life(a) === life(b) ? 'draw' : life(a) > life(b) ? 0 : 1;
  }
  next.reason = timeUp
    ? `시간 종료 — ${a.score}점 vs ${b.score}점`
    : `둘 다 충돌 — ${a.score}점 vs ${b.score}점`;
  return true;
}

/**
 * Catch the simulation up to `now`. Called on a timer by the server and by
 * every client; because it is deterministic they all agree on the result.
 */
export function tick(state, now = Date.now()) {
  if (state.winner !== null) return { state, changed: false };
  const config = state.config;
  const target = Math.min(
    Math.floor((now - state.startedAt) / config.tickMs),
    Math.floor(config.timeLimit / config.tickMs),
  );
  if (target <= state.tickIndex && now < state.deadline) return { state, changed: false };

  const next = clone(state);
  while (next.tickIndex < target) {
    next.tickIndex += 1;
    for (const seat of [0, 1]) step(next.snakes[seat], seat, next.seed, config, next.tickIndex);
    if (next.snakes.every((s) => !s.alive)) break;
  }
  settle(next, now);
  return { state: next, changed: true };
}
