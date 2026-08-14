/**
 * 기억력 카드 (Memory / Concentration) — 4x6, twelve pairs, turn based.
 *
 * Match a pair and you keep the turn, which is what turns a children's game
 * into a real duel: a good player can clear half the board in one visit.
 */
import { clone, fail, done, other, makeStatus } from './_engine.js';
import { Rng } from '../rng.js';

export const ROWS = 4;
export const COLS = 6;
const N = ROWS * COLS;

export const SYMBOLS = ['🍎', '🍋', '🍇', '🍑', '🍉', '🥝', '🌵', '🌻', '🐙', '🦊', '🐢', '🦋', '⚽', '🎸', '🚀', '⛵', '🔔', '💎'];

export const meta = {
  id: 'memory',
  name: '기억력 카드',
  nameEn: 'Memory Match',
  emoji: '🃏',
  category: '두뇌',
  mode: 'turn',
  ai: true,
  timed: true,
  desc: '카드 두 장을 뒤집어 같은 그림을 찾습니다. 맞히면 한 번 더. 상대가 뒤집은 카드도 기억하세요.',
  rules: [
    '차례마다 카드 두 장을 뒤집습니다.',
    '두 장이 같은 그림이면 가져오고 한 번 더 뒤집습니다.',
    '다르면 잠시 보여준 뒤 다시 덮고 차례가 넘어갑니다.',
    '카드를 더 많이 가져온 사람이 승리합니다.',
  ],
};

export const DEFAULTS = { closeMs: 1100 };

export function createState(opts = {}) {
  const config = { ...DEFAULTS, ...(opts.config || {}) };
  const rng = new Rng(opts.seed || 'memory');
  const pairs = N / 2;
  const faces = rng.shuffle(SYMBOLS.slice()).slice(0, pairs);
  const deck = rng.shuffle([...faces, ...faces]);
  return {
    config,
    cards: deck,
    owner: new Array(N).fill(null), // seat that captured the card
    face: [], // currently face-up indices (0..2)
    seen: [], // every index that has ever been shown — what a fair memory holds
    closeAt: null,
    turn: 0,
    scores: [0, 0],
    flips: [0, 0],
    winner: null,
  };
}

export function status(state) {
  if (state.winner !== null) {
    return makeStatus({
      phase: 'over',
      turn: null,
      winner: state.winner,
      scores: state.scores,
      reason: `${state.scores[0]}쌍 : ${state.scores[1]}쌍`,
    });
  }
  return makeStatus({ phase: 'playing', turn: state.turn, scores: state.scores });
}

export function legalMoves(state, seat) {
  if (state.winner !== null || state.turn !== seat || state.closeAt !== null) return [];
  const out = [];
  for (let i = 0; i < N; i++) {
    if (state.owner[i] === null && !state.face.includes(i)) out.push({ type: 'flip', idx: i });
  }
  return out;
}

export function applyMove(state, seat, move, ctx = {}) {
  const now = ctx.now ?? Date.now();
  if (state.winner !== null) return fail('이미 끝난 게임입니다.');
  if (!move || move.type !== 'flip') return fail('알 수 없는 동작입니다.');
  if (seat !== state.turn) return fail('상대 차례입니다.');
  if (state.closeAt !== null) return fail('카드가 다시 덮이기를 기다리는 중입니다.');

  const idx = move.idx;
  if (!Number.isInteger(idx) || idx < 0 || idx >= N) return fail('없는 카드입니다.');
  if (state.owner[idx] !== null) return fail('이미 가져간 카드입니다.');
  if (state.face.includes(idx)) return fail('이미 뒤집은 카드입니다.');

  const next = clone(state);
  next.face.push(idx);
  next.flips[seat]++;
  if (!next.seen.includes(idx)) next.seen.push(idx);
  const events = [{ type: 'flip', seat, idx, symbol: next.cards[idx] }];

  if (next.face.length === 2) {
    const [a, b] = next.face;
    if (next.cards[a] === next.cards[b]) {
      next.owner[a] = seat;
      next.owner[b] = seat;
      next.scores[seat]++;
      next.face = [];
      events.push({ type: 'match', seat, idx: [a, b], symbol: next.cards[a] });
      if (next.owner.every((v) => v !== null)) {
        next.winner = next.scores[0] === next.scores[1] ? 'draw' : next.scores[0] > next.scores[1] ? 0 : 1;
        next.turn = null;
      }
    } else {
      // Leave them up long enough for both players to memorise them.
      next.closeAt = now + next.config.closeMs;
      events.push({ type: 'miss', seat, idx: [a, b] });
    }
  }
  return done(next, events);
}

export function tick(state, now = Date.now()) {
  if (state.winner !== null || state.closeAt === null) return { state, changed: false };
  if (now < state.closeAt) return { state, changed: false };
  const next = clone(state);
  next.face = [];
  next.closeAt = null;
  next.turn = other(next.turn);
  return { state: next, changed: true };
}

/** Face-down cards are dealt to the client as nulls; only what is visible ships. */
export function view(state) {
  const out = clone(state);
  out.cards = out.cards.map((sym, i) => (out.owner[i] !== null || out.face.includes(i) ? sym : null));
  return out;
}

/** Spectators see exactly what the players see — no more. */
export function spectatorView(state) {
  return view(state);
}

/* ── AI ───────────────────────────────────────────────────────────────────── */

/**
 * The bot remembers cards it has seen with probability `recall`, which is what
 * makes lower levels beatable rather than merely slower.
 */
function memoryOf(state, level) {
  const recall = [0, 0.35, 0.65, 0.95][Math.min(3, Math.max(1, level))];
  const known = new Map(); // symbol -> [indices]
  for (let i = 0; i < N; i++) {
    if (state.owner[i] !== null) continue;
    const sym = state.cards[i];
    if (!sym) continue;
    // Only cards that have actually been turned over count as "seen".
    if (!state.seen.includes(i) && !state.face.includes(i)) continue;
    if (Math.random() > recall) continue;
    if (!known.has(sym)) known.set(sym, []);
    known.get(sym).push(i);
  }
  return known;
}

export function ai(state, seat, level = 2) {
  const options = legalMoves(state, seat);
  if (!options.length) return null;
  const open = options.map((o) => o.idx);

  if (level >= 2) {
    const known = memoryOf(state, level);
    if (state.face.length === 1) {
      // Second flip: go for the partner of the card already showing.
      const target = state.cards[state.face[0]];
      const pair = (known.get(target) || []).find((i) => i !== state.face[0] && open.includes(i));
      if (pair !== undefined) return { type: 'flip', idx: pair };
    } else {
      // First flip: open a pair we already know both halves of.
      for (const [, idxs] of known) {
        const usable = idxs.filter((i) => open.includes(i));
        if (usable.length >= 2) return { type: 'flip', idx: usable[0] };
      }
    }
  }
  return { type: 'flip', idx: open[Math.floor(Math.random() * open.length)] };
}

export function aiDelay(level = 2) {
  const base = [0, 1300, 950, 650][Math.min(3, Math.max(1, level))];
  return base + Math.random() * 500;
}
