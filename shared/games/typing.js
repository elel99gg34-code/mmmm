/**
 * 타이핑 레이스 (Typing Race) — same passage, side-by-side progress bars.
 *
 * The client owns the keystrokes (it has to — the server cannot see a
 * keyboard) and reports how much of the passage it has typed *correctly*.
 * The server enforces the rules that matter: progress only ever goes forward,
 * never past the end of the text, and never faster than a human can type.
 * A client that claims 300 characters per second is simply clamped.
 */
import { clone, fail, done, makeStatus } from './_engine.js';
import { Rng } from '../rng.js';
import { TEXTS, textById } from '../data/typing-texts.js';

export const meta = {
  id: 'typing',
  name: '타이핑 레이스',
  nameEn: 'Typing Race',
  emoji: '⌨️',
  category: '순발력',
  mode: 'simul',
  ai: true,
  timed: true,
  desc: '같은 지문을 누가 더 빨리, 더 정확하게. 오타는 지우고 다시 쳐야 진도가 나갑니다.',
  rules: [
    '두 사람에게 같은 지문이 주어집니다.',
    '앞에서부터 정확히 입력한 글자 수만 진도로 인정됩니다.',
    '오타가 나면 지우고 다시 입력해야 진도가 올라갑니다.',
    '먼저 지문을 끝낸 사람이 승리합니다.',
    '제한 시간이 끝나면 더 많이 입력한 사람이 승리합니다.',
  ],
};

export const DEFAULTS = { timeLimit: 120000, textId: null };
/** Nobody types faster than this; anything above is a lying client. */
export const MAX_CPS = 22;

export function createState(opts = {}) {
  const config = { ...DEFAULTS, ...(opts.config || {}) };
  const rng = new Rng(opts.seed || 'typing');
  const now = opts.now ?? Date.now();
  const passage = config.textId ? textById(config.textId) : rng.pick(TEXTS);
  return {
    config,
    text: passage.body,
    title: passage.title,
    lang: passage.lang,
    startedAt: now,
    deadline: now + config.timeLimit,
    progress: [0, 0],
    errors: [0, 0],
    finished: [null, null],
    winner: null,
    reason: '',
  };
}

export function status(state) {
  if (state.winner !== null) {
    return makeStatus({
      phase: 'over',
      turn: null,
      winner: state.winner,
      scores: state.progress,
      reason: state.reason,
    });
  }
  return makeStatus({ phase: 'playing', turn: null, scores: state.progress });
}

/** Words-per-minute for a seat, using the standard 5-characters-per-word rule. */
export function wpm(state, seat, now = Date.now()) {
  const elapsed = (state.finished[seat] ?? now - state.startedAt) / 60000;
  if (elapsed <= 0) return 0;
  return Math.round(state.progress[seat] / 5 / elapsed);
}

function settle(next, now) {
  const [a, b] = next.finished;
  if (a !== null && b !== null) {
    next.winner = a === b ? 'draw' : a < b ? 0 : 1;
    next.reason = `${(Math.min(a, b) / 1000).toFixed(1)}초 vs ${(Math.max(a, b) / 1000).toFixed(1)}초`;
    return true;
  }
  if (now >= next.deadline) {
    if (a !== null) {
      next.winner = 0;
      next.reason = '시간 내 완주';
    } else if (b !== null) {
      next.winner = 1;
      next.reason = '시간 내 완주';
    } else {
      const [p, q] = next.progress;
      next.winner = p === q ? 'draw' : p > q ? 0 : 1;
      next.reason = `시간 종료 — ${p}자 vs ${q}자`;
    }
    return true;
  }
  return false;
}

export function applyMove(state, seat, move, ctx = {}) {
  const now = ctx.now ?? Date.now();
  if (state.winner !== null) return fail('이미 끝난 게임입니다.');
  if (!move || move.type !== 'progress') return fail('알 수 없는 동작입니다.');
  if (state.finished[seat] !== null) return fail('이미 완주했습니다.');

  const claimed = Number(move.chars);
  if (!Number.isFinite(claimed) || claimed < 0) return fail('진도 값이 올바르지 않습니다.');

  const elapsed = Math.max(1, now - state.startedAt);
  const ceiling = Math.min(state.text.length, Math.floor((elapsed / 1000) * MAX_CPS) + 5);
  const chars = Math.max(state.progress[seat], Math.min(Math.floor(claimed), ceiling));

  const next = clone(state);
  next.progress[seat] = chars;
  if (Number.isFinite(move.errors) && move.errors >= 0) next.errors[seat] = Math.floor(move.errors);
  if (chars >= next.text.length) next.finished[seat] = now - next.startedAt;

  settle(next, now);
  return done(next, [{ type: 'progress', seat, chars }]);
}

export function tick(state, now = Date.now()) {
  if (state.winner !== null) return { state, changed: false };
  if (now < state.deadline) return { state, changed: false };
  const next = clone(state);
  settle(next, now);
  return { state: next, changed: next.winner !== null };
}

/* ── AI ───────────────────────────────────────────────────────────────────── */

/** Target speed for the practice bot, in characters per second. */
export function aiSpeed(level = 2) {
  return [0, 2.6, 4.4, 6.6][Math.min(3, Math.max(1, level))];
}

/** Bot progress for the current moment — driven by the client's animation loop. */
export function ai(state, seat, level = 2, now = Date.now()) {
  if (state.winner !== null || state.finished[seat] !== null) return null;
  const elapsed = (now - state.startedAt) / 1000;
  // A little jitter so the bot does not look like a metronome.
  const wobble = 1 + Math.sin(elapsed * 1.7) * 0.12;
  const chars = Math.min(state.text.length, Math.floor(elapsed * aiSpeed(level) * wobble));
  if (chars <= state.progress[seat]) return null;
  return { type: 'progress', chars };
}
