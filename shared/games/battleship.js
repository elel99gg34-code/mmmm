/**
 * 해전게임 (Battleship) — 10x10, five ships, hidden information.
 *
 * This is the one engine where `view()` matters: each seat sees its own fleet
 * in full but only the shots it has fired at the opponent. The server holds
 * the complete state and never ships the opponent's fleet to the client until
 * the match is over.
 */
import { clone, fail, done, other, makeStatus } from './_engine.js';
import { Rng } from '../rng.js';

export const SIZE = 10;
const N = SIZE * SIZE;

export const SHIPS = [
  { id: 'carrier', name: '항공모함', len: 5 },
  { id: 'battleship', name: '전함', len: 4 },
  { id: 'cruiser', name: '순양함', len: 3 },
  { id: 'submarine', name: '잠수함', len: 3 },
  { id: 'destroyer', name: '구축함', len: 2 },
];
const TOTAL_CELLS = SHIPS.reduce((n, s) => n + s.len, 0);

export const meta = {
  id: 'battleship',
  name: '해전게임',
  nameEn: 'Battleship',
  emoji: '🚢',
  category: '전략',
  mode: 'turn',
  ai: true,
  hidden: true,
  desc: '보이지 않는 상대 함대를 좌표로 추격합니다. 배치와 추리, 둘 다 필요합니다.',
  rules: [
    '먼저 10×10 바다에 함선 5척(5·4·3·3·2칸)을 배치합니다.',
    '함선은 가로 또는 세로로 놓이며 서로 겹칠 수 없습니다.',
    '차례마다 좌표 한 곳을 포격합니다.',
    '명중이든 빗나감이든 차례는 상대에게 넘어갑니다.',
    '상대 함선 5척을 모두 격침하면 승리합니다.',
  ],
};

const idx = (r, c) => r * SIZE + c;

function emptyFleet() {
  return { cells: new Array(N).fill(null), ships: [], sunk: [] };
}

export function createState(opts = {}) {
  return {
    phase: 'setup',
    fleets: [emptyFleet(), emptyFleet()],
    shots: [new Array(N).fill(0), new Array(N).fill(0)], // shots[seat][cell]: 0 none, 1 miss, 2 hit
    ready: [false, false],
    turn: 0,
    last: [null, null],
    winner: null,
    seed: opts.seed || 'battleship',
  };
}

/** Squares a ship would occupy, or null if it does not fit. */
export function shipCells(r, c, len, dir) {
  const out = [];
  for (let k = 0; k < len; k++) {
    const rr = dir === 'v' ? r + k : r;
    const cc = dir === 'h' ? c + k : c;
    if (rr < 0 || cc < 0 || rr >= SIZE || cc >= SIZE) return null;
    out.push(idx(rr, cc));
  }
  return out;
}

/** Validate a full placement and build the fleet, or return an error string. */
export function buildFleet(placements) {
  if (!Array.isArray(placements) || placements.length !== SHIPS.length) {
    return { error: '함선 5척을 모두 배치해야 합니다.' };
  }
  const fleet = emptyFleet();
  const used = new Set();
  for (const spec of SHIPS) {
    const p = placements.find((x) => x && x.id === spec.id);
    if (!p) return { error: `${spec.name}이(가) 배치되지 않았습니다.` };
    if (p.dir !== 'h' && p.dir !== 'v') return { error: '방향이 올바르지 않습니다.' };
    const cells = shipCells(p.r, p.c, spec.len, p.dir);
    if (!cells) return { error: `${spec.name}이(가) 바다 밖으로 나갑니다.` };
    for (const cell of cells) {
      if (used.has(cell)) return { error: '함선이 서로 겹칩니다.' };
      used.add(cell);
    }
    fleet.ships.push({ id: spec.id, name: spec.name, len: spec.len, r: p.r, c: p.c, dir: p.dir, cells, hits: 0 });
    for (const cell of cells) fleet.cells[cell] = spec.id;
  }
  return { fleet };
}

/** A legal random layout — used for "자동 배치" and by the AI. */
export function randomPlacements(seed) {
  const rng = new Rng(seed ?? Math.random() * 1e9);
  for (let attempt = 0; attempt < 500; attempt++) {
    const used = new Set();
    const out = [];
    let ok = true;
    for (const spec of SHIPS) {
      let placed = false;
      for (let tries = 0; tries < 200 && !placed; tries++) {
        const dir = rng.float() < 0.5 ? 'h' : 'v';
        const r = rng.int(0, dir === 'v' ? SIZE - spec.len : SIZE - 1);
        const c = rng.int(0, dir === 'h' ? SIZE - spec.len : SIZE - 1);
        const cells = shipCells(r, c, spec.len, dir);
        if (!cells || cells.some((x) => used.has(x))) continue;
        cells.forEach((x) => used.add(x));
        out.push({ id: spec.id, r, c, dir });
        placed = true;
      }
      if (!placed) {
        ok = false;
        break;
      }
    }
    if (ok) return out;
  }
  // Deterministic fallback: stack the ships on separate rows.
  return SHIPS.map((s, i) => ({ id: s.id, r: i * 2, c: 0, dir: 'h' }));
}

export function status(state) {
  const scores = [
    state.shots[0].filter((v) => v === 2).length,
    state.shots[1].filter((v) => v === 2).length,
  ];
  if (state.winner !== null) {
    return makeStatus({ phase: 'over', turn: null, winner: state.winner, scores, reason: '적 함대 전멸' });
  }
  if (state.phase === 'setup') {
    return makeStatus({ phase: 'setup', turn: null, scores, reason: '함대 배치 중' });
  }
  return makeStatus({ phase: 'playing', turn: state.turn, scores });
}

export function legalMoves(state, seat) {
  if (state.phase !== 'playing' || state.turn !== seat) return [];
  const out = [];
  for (let i = 0; i < N; i++) if (state.shots[seat][i] === 0) out.push({ type: 'fire', idx: i });
  return out;
}

export function applyMove(state, seat, move) {
  if (state.winner !== null) return fail('이미 끝난 게임입니다.');
  if (!move || typeof move !== 'object') return fail('잘못된 요청입니다.');

  if (move.type === 'place') {
    if (state.phase !== 'setup') return fail('이미 배치가 끝났습니다.');
    if (state.ready[seat]) return fail('이미 배치를 확정했습니다.');
    const { fleet, error } = buildFleet(move.placements);
    if (error) return fail(error);
    const next = clone(state);
    next.fleets[seat] = fleet;
    next.ready[seat] = true;
    if (next.ready[0] && next.ready[1]) next.phase = 'playing';
    return done(next, [{ type: 'ready', seat }]);
  }

  if (move.type === 'fire') {
    if (state.phase !== 'playing') return fail('아직 배치 단계입니다.');
    if (seat !== state.turn) return fail('상대 차례입니다.');
    const cell = move.idx;
    if (!Number.isInteger(cell) || cell < 0 || cell >= N) return fail('바다 밖입니다.');
    if (state.shots[seat][cell] !== 0) return fail('이미 포격한 좌표입니다.');

    const next = clone(state);
    const target = other(seat);
    const shipId = next.fleets[target].cells[cell];
    const hit = Boolean(shipId);
    next.shots[seat][cell] = hit ? 2 : 1;
    next.last[seat] = cell;

    const events = [{ type: 'fire', seat, idx: cell, hit }];
    if (hit) {
      const ship = next.fleets[target].ships.find((s) => s.id === shipId);
      ship.hits++;
      if (ship.hits >= ship.len) {
        next.fleets[target].sunk.push({ id: ship.id, name: ship.name, cells: ship.cells });
        events.push({ type: 'sunk', seat, ship: ship.id, name: ship.name, cells: ship.cells });
      }
      if (next.shots[seat].filter((v) => v === 2).length >= TOTAL_CELLS) {
        next.winner = seat;
        next.turn = null;
        return done(next, events);
      }
    }
    next.turn = target;
    return done(next, events);
  }

  return fail('알 수 없는 동작입니다.');
}

/** Redact the opponent's fleet; reveal it once the match is over. */
export function view(state, seat) {
  if (state.winner !== null) return state;
  const opp = other(seat);
  const out = clone(state);
  const revealed = emptyFleet();
  revealed.sunk = out.fleets[opp].sunk;
  revealed.ships = out.fleets[opp].sunk.map((s) => ({ ...s, hidden: false }));
  // Only sunk hulls become visible; live ships stay off the wire entirely.
  revealed.cells = new Array(N).fill(null);
  for (const s of out.fleets[opp].sunk) for (const cell of s.cells) revealed.cells[cell] = s.id;
  out.fleets[opp] = revealed;
  return out;
}

/** Spectators see the shot grids and the wrecks, never a living hull. */
export function spectatorView(state) {
  if (state.winner !== null) return state;
  const out = clone(state);
  for (const seat of [0, 1]) {
    const sunk = out.fleets[seat].sunk;
    const cells = new Array(N).fill(null);
    for (const ship of sunk) for (const cell of ship.cells) cells[cell] = ship.id;
    out.fleets[seat] = { cells, ships: sunk.map((s) => ({ ...s })), sunk };
  }
  return out;
}

/* ── AI ───────────────────────────────────────────────────────────────────── */

/** Hunt/target strategy: chase adjacent cells after a hit, else parity search. */
export function ai(state, seat, level = 2) {
  if (state.phase === 'setup') {
    return { type: 'place', placements: randomPlacements() };
  }
  const shots = state.shots[seat];
  const open = [];
  for (let i = 0; i < N; i++) if (shots[i] === 0) open.push(i);
  if (!open.length) return null;
  if (level <= 1) return { type: 'fire', idx: open[Math.floor(Math.random() * open.length)] };

  const sunkCells = new Set();
  for (const s of state.fleets[other(seat)].sunk || []) for (const cell of s.cells) sunkCells.add(cell);

  // Target mode: extend from an unresolved hit.
  const targets = [];
  for (let i = 0; i < N; i++) {
    if (shots[i] !== 2 || sunkCells.has(i)) continue;
    const r = Math.floor(i / SIZE);
    const c = i % SIZE;
    for (const [dr, dc] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
      const rr = r + dr;
      const cc = c + dc;
      if (rr < 0 || cc < 0 || rr >= SIZE || cc >= SIZE) continue;
      const n = idx(rr, cc);
      if (shots[n] !== 0) continue;
      // Prefer continuing a straight line of hits.
      const back = idx(r - dr, c - dc);
      const inline = r - dr >= 0 && c - dc >= 0 && r - dr < SIZE && c - dc < SIZE && shots[back] === 2;
      targets.push({ idx: n, weight: inline ? 3 : 1 });
    }
  }
  if (targets.length) {
    targets.sort((a, b) => b.weight - a.weight);
    const top = targets.filter((t) => t.weight === targets[0].weight);
    return { type: 'fire', idx: top[Math.floor(Math.random() * top.length)].idx };
  }

  // Hunt mode: the smallest ship is 2 long, so a checkerboard finds everything.
  const parity = open.filter((i) => (Math.floor(i / SIZE) + (i % SIZE)) % 2 === 0);
  const pool = parity.length ? parity : open;
  return { type: 'fire', idx: pool[Math.floor(Math.random() * pool.length)] };
}
