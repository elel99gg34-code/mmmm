/**
 * 지뢰찾기 듀얼 (Minesweeper Duel) — identical board, two racers.
 *
 * Both players get the same seeded 16x16 field with 40 mines and the same
 * opening region already cleared, so the race is pure skill and no one is
 * handed a lucky first click. Every reveal is replayed on the server, which
 * means the board itself never leaves the server: a client only ever learns
 * the numbers under the squares it has actually opened.
 */
import { clone, fail, done, makeStatus } from './_engine.js';
import { Rng } from '../rng.js';

export const meta = {
  id: 'minesweeper',
  name: '지뢰찾기 듀얼',
  nameEn: 'Minesweeper Duel',
  emoji: '💣',
  category: '퍼즐',
  mode: 'race',
  ai: false,
  solo: true,
  hidden: true,
  desc: '완전히 같은 지뢰밭을 둘이 동시에. 먼저 다 여는 쪽이 이깁니다. 밟으면 그 자리에서 끝.',
  rules: [
    '두 사람에게 똑같은 지뢰밭이 주어지고, 시작 지점도 똑같이 열려 있습니다.',
    '숫자는 주변 8칸의 지뢰 개수입니다.',
    '지뢰가 아닌 칸을 모두 열면 승리합니다.',
    '지뢰를 밟으면 그 자리에서 탈락합니다.',
    '둘 다 탈락하면 더 많이 연 사람이 승리합니다.',
  ],
};

export const DEFAULTS = { rows: 16, cols: 16, mines: 40, timeLimit: 600000 };

const neighbours = (idx, rows, cols) => {
  const r = Math.floor(idx / cols);
  const c = idx % cols;
  const out = [];
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      if (!dr && !dc) continue;
      const rr = r + dr;
      const cc = c + dc;
      if (rr < 0 || cc < 0 || rr >= rows || cc >= cols) continue;
      out.push(rr * cols + cc);
    }
  }
  return out;
};

/** Lay mines, count numbers, and find an opening square with no neighbours. */
function buildField(seed, config) {
  const { rows, cols, mines } = config;
  const n = rows * cols;
  for (let attempt = 0; attempt < 40; attempt++) {
    const rng = new Rng(`${seed}:field:${attempt}`);
    const mineSet = new Set(rng.sample(n, Math.min(mines, n - 9)));
    const numbers = new Array(n).fill(0);
    for (let i = 0; i < n; i++) {
      if (mineSet.has(i)) {
        numbers[i] = -1;
        continue;
      }
      numbers[i] = neighbours(i, rows, cols).filter((j) => mineSet.has(j)).length;
    }
    const opening = numbers.findIndex((v) => v === 0);
    if (opening >= 0) return { mineSet, numbers, opening };
  }
  // Statistically unreachable at 40/256, but never ship a maybe.
  const numbers = new Array(n).fill(0);
  return { mineSet: new Set(), numbers, opening: 0 };
}

/** Flood-fill from a zero square. Mutates `revealed`, returns how many opened. */
function flood(revealed, numbers, start, config) {
  const { rows, cols } = config;
  const stack = [start];
  let opened = 0;
  while (stack.length) {
    const idx = stack.pop();
    if (revealed[idx]) continue;
    revealed[idx] = true;
    opened++;
    if (numbers[idx] === 0) {
      for (const nb of neighbours(idx, rows, cols)) if (!revealed[nb] && numbers[nb] >= 0) stack.push(nb);
    }
  }
  return opened;
}

export function createState(opts = {}) {
  const config = { ...DEFAULTS, ...(opts.config || {}) };
  const now = opts.now ?? Date.now();
  const n = config.rows * config.cols;
  const { mineSet, numbers, opening } = buildField(opts.seed || 'minesweeper', config);

  const revealed = [new Array(n).fill(false), new Array(n).fill(false)];
  const counts = [0, 0];
  for (const seat of [0, 1]) counts[seat] = flood(revealed[seat], numbers, opening, config);

  return {
    config,
    mines: [...mineSet],
    numbers,
    revealed,
    flags: [new Array(n).fill(false), new Array(n).fill(false)],
    opened: counts,
    dead: [false, false],
    finishedAt: [null, null],
    startedAt: now,
    deadline: now + config.timeLimit,
    safeTotal: n - mineSet.size,
    winner: null,
    reason: '',
  };
}

export function status(state) {
  if (state.winner !== null) {
    return makeStatus({ phase: 'over', turn: null, winner: state.winner, scores: state.opened, reason: state.reason });
  }
  return makeStatus({ phase: 'playing', turn: null, scores: state.opened });
}

function settle(next, now) {
  const [f0, f1] = next.finishedAt;
  if (f0 !== null && f1 !== null) {
    next.winner = f0 === f1 ? 'draw' : f0 < f1 ? 0 : 1;
    next.reason = `${(Math.min(f0, f1) / 1000).toFixed(1)}초 완료`;
    return true;
  }
  if (f0 !== null && next.dead[1]) {
    next.winner = 0;
    next.reason = '상대가 지뢰를 밟았습니다.';
    return true;
  }
  if (f1 !== null && next.dead[0]) {
    next.winner = 1;
    next.reason = '상대가 지뢰를 밟았습니다.';
    return true;
  }
  if (next.dead[0] && next.dead[1]) {
    const [a, b] = next.opened;
    next.winner = a === b ? 'draw' : a > b ? 0 : 1;
    next.reason = `둘 다 지뢰를 밟음 — ${a}칸 vs ${b}칸`;
    return true;
  }
  if (now >= next.deadline) {
    const [a, b] = next.opened;
    next.winner = a === b ? 'draw' : a > b ? 0 : 1;
    next.reason = `시간 종료 — ${a}칸 vs ${b}칸`;
    return true;
  }
  return false;
}

export function applyMove(state, seat, move, ctx = {}) {
  const now = ctx.now ?? Date.now();
  if (state.winner !== null) return fail('이미 끝난 게임입니다.');
  if (!move || typeof move !== 'object') return fail('알 수 없는 동작입니다.');
  if (state.dead[seat]) return fail('이미 탈락했습니다.');
  if (state.finishedAt[seat] !== null) return fail('이미 완료했습니다.');

  const { rows, cols } = state.config;
  const n = rows * cols;
  const idx = move.idx;
  if (!Number.isInteger(idx) || idx < 0 || idx >= n) return fail('판 밖입니다.');

  const next = clone(state);
  const revealed = next.revealed[seat];
  const flags = next.flags[seat];
  const events = [];

  if (move.type === 'flag') {
    if (revealed[idx]) return fail('이미 열린 칸입니다.');
    flags[idx] = !flags[idx];
    return done(next, [{ type: 'flag', seat, idx, on: flags[idx] }]);
  }

  if (move.type === 'reveal' || move.type === 'chord') {
    let targets = [idx];
    if (move.type === 'chord') {
      // Open every unflagged neighbour, but only when the flag count matches.
      if (!revealed[idx] || next.numbers[idx] <= 0) return fail('숫자 칸에서만 사용할 수 있습니다.');
      const nb = neighbours(idx, rows, cols);
      if (nb.filter((j) => flags[j]).length !== next.numbers[idx]) return fail('깃발 개수가 숫자와 다릅니다.');
      targets = nb.filter((j) => !flags[j] && !revealed[j]);
      if (!targets.length) return fail('열 칸이 없습니다.');
    } else {
      if (revealed[idx]) return fail('이미 열린 칸입니다.');
      if (flags[idx]) return fail('깃발이 꽂힌 칸입니다.');
    }

    for (const target of targets) {
      if (revealed[target]) continue;
      if (next.numbers[target] === -1) {
        revealed[target] = true;
        next.dead[seat] = true;
        events.push({ type: 'boom', seat, idx: target });
        break;
      }
      next.opened[seat] += flood(revealed, next.numbers, target, next.config);
      events.push({ type: 'reveal', seat, idx: target });
    }

    if (!next.dead[seat] && next.opened[seat] >= next.safeTotal) {
      next.finishedAt[seat] = now - next.startedAt;
      events.push({ type: 'clear', seat, ms: next.finishedAt[seat] });
    }
    settle(next, now);
    return done(next, events);
  }

  return fail('알 수 없는 동작입니다.');
}

export function tick(state, now = Date.now()) {
  if (state.winner !== null) return { state, changed: false };
  if (now < state.deadline) return { state, changed: false };
  const next = clone(state);
  settle(next, now);
  return { state: next, changed: next.winner !== null };
}

/**
 * The board is the secret here. A seat receives numbers only for squares it
 * has opened; mines appear only where it detonated one, or once the match is
 * decided and there is nothing left to protect.
 */
export function view(state, seat) {
  const out = clone(state);
  const over = out.winner !== null;
  if (!over) {
    out.mines = out.dead[seat] ? out.mines : [];
    out.numbers = out.numbers.map((v, i) => (out.revealed[seat][i] ? v : null));
  }
  return out;
}

/** Spectators watch the two reveal grids fill in; the field itself stays sealed. */
export function spectatorView(state) {
  if (state.winner !== null) return state;
  const out = clone(state);
  out.mines = [];
  out.numbers = out.numbers.map((v, i) => (out.revealed[0][i] || out.revealed[1][i] ? v : null));
  return out;
}
