/**
 * 반응속도 결투 (Reaction Duel) — five rounds of "click the instant it turns
 * green", best of five.
 *
 * Fairness note, because this is the game where fairness is hardest: the
 * server picks the GO moment and broadcasts it *in advance* as an absolute
 * timestamp. Each client, having measured its own clock offset against the
 * server, flips to green at the same wall-clock instant and measures the
 * reaction locally. The client reports that number, and the server clamps it
 * into the window its own arrival time makes physically possible. Latency
 * therefore shifts when you see green — identically for both players — rather
 * than being added to your score.
 */
import { clone, fail, done, makeStatus } from './_engine.js';
import { Rng } from '../rng.js';

export const meta = {
  id: 'reaction',
  name: '반응속도 결투',
  nameEn: 'Reaction Duel',
  emoji: '⚡',
  category: '순발력',
  mode: 'simul',
  ai: true,
  timed: true,
  desc: '화면이 초록으로 바뀌는 순간 누르세요. 5라운드 중 더 많이 이긴 사람이 승자입니다.',
  rules: [
    '빨간 화면이 초록으로 바뀌면 즉시 누릅니다.',
    '초록이 되기 전에 누르면 부정 출발로 그 라운드를 잃습니다.',
    '더 빠른 사람이 그 라운드를 가져갑니다.',
    '5라운드 중 더 많이 이긴 사람이 최종 승리합니다.',
    '두 사람의 화면은 서버 시각을 기준으로 동시에 바뀝니다.',
  ],
};

export const DEFAULTS = { rounds: 5, minDelay: 1600, maxDelay: 5200, roundLimit: 3000, resultMs: 1800 };
/** Below this is a guess, not a reaction. */
export const MIN_HUMAN_MS = 90;
/** How much network delay we are willing to forgive when clamping a report. */
export const LATENCY_ALLOWANCE_MS = 450;
export const FALSE_START = -1;

function delayFor(seed, round, config) {
  const rng = new Rng(`${seed}:round:${round}`);
  return rng.int(config.minDelay, config.maxDelay);
}

export function createState(opts = {}) {
  const config = { ...DEFAULTS, ...(opts.config || {}) };
  const now = opts.now ?? Date.now();
  const seed = opts.seed || 'reaction';
  return {
    config,
    seed,
    round: 0,
    phase: 'waiting', // waiting -> go -> result -> (next round | over)
    goAt: now + delayFor(seed, 0, config),
    phaseEndsAt: now + delayFor(seed, 0, config),
    times: [], // per round: [seat0Ms|null|FALSE_START, seat1Ms|...]
    current: [null, null],
    wins: [0, 0],
    winner: null,
    reason: '',
  };
}

export function status(state) {
  if (state.phase === 'over') {
    return makeStatus({
      phase: 'over',
      turn: null,
      winner: state.winner,
      scores: state.wins,
      reason: state.reason,
    });
  }
  return makeStatus({
    phase: 'playing',
    turn: null,
    scores: state.wins,
    reason: `${state.round + 1} / ${state.config.rounds} 라운드`,
  });
}

export function applyMove(state, seat, move, ctx = {}) {
  const now = ctx.now ?? Date.now();
  if (state.phase === 'over') return fail('이미 끝난 게임입니다.');
  if (!move || move.type !== 'react') return fail('알 수 없는 동작입니다.');
  if (state.phase === 'result') return fail('다음 라운드를 기다리는 중입니다.');
  if (state.current[seat] !== null) return fail('이미 이번 라운드를 눌렀습니다.');

  const next = clone(state);

  if (state.phase === 'waiting' || now < state.goAt) {
    next.current[seat] = FALSE_START;
  } else {
    const serverElapsed = now - state.goAt;
    const claimed = Number(move.rt);
    const floor = Math.max(MIN_HUMAN_MS, serverElapsed - LATENCY_ALLOWANCE_MS);
    const measured = Number.isFinite(claimed) ? claimed : serverElapsed;
    next.current[seat] = Math.round(Math.max(floor, Math.min(measured, serverElapsed)));
  }

  const events = [{ type: 'react', seat, rt: next.current[seat] }];
  if (next.current[0] !== null && next.current[1] !== null) {
    resolveRound(next, now);
    events.push({ type: 'round', round: next.round });
  }
  return done(next, events);
}

function score(value) {
  // Lower is better; a false start or a miss is worse than any real time.
  if (value === null) return Infinity;
  if (value === FALSE_START) return Infinity - 1;
  return value;
}

function resolveRound(next, now) {
  const [a, b] = next.current;
  next.times.push([a, b]);
  const sa = score(a);
  const sb = score(b);
  if (sa < sb) next.wins[0]++;
  else if (sb < sa) next.wins[1]++;
  next.phase = 'result';
  next.phaseEndsAt = now + next.config.resultMs;
}

export function tick(state, now = Date.now()) {
  if (state.phase === 'over') return { state, changed: false };
  const next = clone(state);

  if (next.phase === 'waiting') {
    if (now < next.goAt) return { state, changed: false };
    next.phase = 'go';
    next.phaseEndsAt = next.goAt + next.config.roundLimit;
    return { state: next, changed: true };
  }

  if (next.phase === 'go') {
    if (now < next.phaseEndsAt) return { state, changed: false };
    // Whoever never pressed simply misses the round.
    resolveRound(next, now);
    return { state: next, changed: true };
  }

  // phase === 'result'
  if (now < next.phaseEndsAt) return { state, changed: false };
  if (next.round + 1 >= next.config.rounds) {
    next.phase = 'over';
    next.winner = next.wins[0] === next.wins[1] ? 'draw' : next.wins[0] > next.wins[1] ? 0 : 1;
    const best = (seat) => {
      const valid = next.times.map((t) => t[seat]).filter((v) => typeof v === 'number' && v > 0);
      return valid.length ? Math.min(...valid) : null;
    };
    const b0 = best(0);
    const b1 = best(1);
    next.reason = `${next.wins[0]} : ${next.wins[1]} (최고 ${b0 ?? '-'}ms vs ${b1 ?? '-'}ms)`;
    return { state: next, changed: true };
  }

  next.round += 1;
  next.current = [null, null];
  next.phase = 'waiting';
  next.goAt = now + delayFor(next.seed, next.round, next.config);
  next.phaseEndsAt = next.goAt;
  return { state: next, changed: true };
}

/* ── AI ───────────────────────────────────────────────────────────────────── */

/** The reaction time the bot is aiming for this round, in milliseconds. */
export function aiReaction(level = 2) {
  const base = [0, 420, 300, 215][Math.min(3, Math.max(1, level))];
  const spread = base * 0.35;
  return Math.round(base + (Math.random() * 2 - 1) * spread);
}

export function ai(state, seat, level = 2) {
  if (state.phase !== 'go' || state.current[seat] !== null) return null;
  return { type: 'react', rt: aiReaction(level) };
}
