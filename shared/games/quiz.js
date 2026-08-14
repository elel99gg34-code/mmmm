/**
 * 퀴즈 배틀 (Quiz Battle) — the hub's headline 1v1 event, and the game the
 * tournament bracket runs on.
 *
 * Both players see the same question at the same time and answer
 * simultaneously; there is no turn order. Points are correctness plus a speed
 * bonus plus a streak bonus, so a fast player can lose to an accurate one but
 * a slow-and-right player never loses to a fast-and-wrong one.
 *
 * All timing is measured from `ctx.now`. Online, that value comes from the
 * server clock, so "I clicked first" is decided by the referee and not by the
 * two clients arguing about their own `Date.now()`.
 */
import { clone, fail, done, makeStatus } from './_engine.js';
import { Rng } from '../rng.js';
import { filterQuestions } from '../data/quiz-bank.js';

export const meta = {
  id: 'quiz',
  name: '퀴즈 배틀',
  nameEn: 'Quiz Battle',
  emoji: '🧠',
  category: '지식',
  mode: 'simul',
  ai: true,
  timed: true,
  hidden: true,
  featured: true,
  desc: '같은 문제, 같은 순간. 정확하게 그리고 빠르게 답해야 이깁니다. 대회(토너먼트)도 이 게임으로 열립니다.',
  rules: [
    '두 사람에게 같은 문제가 동시에 출제됩니다.',
    '정답 100점 + 남은 시간에 비례한 스피드 보너스 최대 100점.',
    '연속 정답 시 25점씩 추가 보너스(최대 75점).',
    '오답이나 시간 초과는 0점이며 연속 정답이 끊깁니다.',
    '모든 문제가 끝났을 때 총점이 높은 쪽이 승리합니다.',
  ],
};

export const DEFAULTS = {
  count: 10,
  perQuestion: 15000,
  revealMs: 2600,
  categories: [],
  maxDifficulty: 3,
};

export const BASE_POINTS = 100;
export const MAX_SPEED_BONUS = 100;
export const STREAK_BONUS = 25;
export const MAX_STREAK_STEPS = 3;

/** Draw and shuffle the question set for a match. Deterministic in `seed`. */
export function buildQuestions(seed, config) {
  const rng = new Rng(seed);
  const pool = filterQuestions(config);
  const picked = rng.shuffle(pool.slice()).slice(0, Math.min(config.count, pool.length));
  return picked.map((item) => {
    const order = rng.shuffle([0, 1, 2, 3]);
    return {
      q: item.q,
      a: order.map((i) => item.a[i]),
      c: order.indexOf(item.c),
      cat: item.cat,
      d: item.d,
    };
  });
}

export function createState(opts = {}) {
  const config = { ...DEFAULTS, ...(opts.config || {}) };
  const now = opts.now ?? Date.now();
  const questions = buildQuestions(opts.seed || 'quiz', config);
  return {
    config,
    questions,
    qi: 0,
    phase: questions.length ? 'question' : 'over',
    phaseEndsAt: now + config.perQuestion,
    answers: questions.map(() => [null, null]),
    scores: [0, 0],
    streak: [0, 0],
    correct: [0, 0],
    winner: questions.length ? null : 'draw',
  };
}

export function status(state) {
  if (state.phase === 'over') {
    return makeStatus({
      phase: 'over',
      turn: null,
      winner: state.winner,
      scores: state.scores,
      reason: `${state.scores[0]} : ${state.scores[1]} (정답 ${state.correct[0]}/${state.questions.length} vs ${state.correct[1]}/${state.questions.length})`,
    });
  }
  return makeStatus({
    phase: 'playing',
    turn: null, // simultaneous — nobody is "on the clock" alone
    scores: state.scores,
    reason: `${state.qi + 1} / ${state.questions.length}`,
  });
}

export function legalMoves(state, seat) {
  if (state.phase !== 'question' || state.answers[state.qi][seat]) return [];
  return [0, 1, 2, 3].map((choice) => ({ type: 'answer', qi: state.qi, choice }));
}

function scoreAnswer(state, seat, correct, remainingMs) {
  if (!correct) return 0;
  const fraction = Math.max(0, Math.min(1, remainingMs / state.config.perQuestion));
  const speed = Math.round(MAX_SPEED_BONUS * fraction);
  const steps = Math.min(state.streak[seat], MAX_STREAK_STEPS);
  return BASE_POINTS + speed + STREAK_BONUS * steps;
}

export function applyMove(state, seat, move, ctx = {}) {
  const now = ctx.now ?? Date.now();
  if (state.phase === 'over') return fail('이미 끝난 게임입니다.');
  if (!move || move.type !== 'answer') return fail('알 수 없는 동작입니다.');
  if (state.phase !== 'question') return fail('지금은 정답 공개 중입니다.');
  if (move.qi !== state.qi) return fail('이미 지나간 문제입니다.');
  if (state.answers[state.qi][seat]) return fail('이미 답을 제출했습니다.');
  const choice = move.choice;
  if (!Number.isInteger(choice) || choice < 0 || choice > 3) return fail('없는 보기입니다.');

  const next = clone(state);
  const question = next.questions[next.qi];
  const isCorrect = choice === question.c;
  const remaining = Math.max(0, next.phaseEndsAt - now);
  const points = scoreAnswer(next, seat, isCorrect, remaining);

  next.answers[next.qi][seat] = { choice, correct: isCorrect, points, ms: state.config.perQuestion - remaining };
  next.scores[seat] += points;
  if (isCorrect) {
    next.streak[seat] += 1;
    next.correct[seat] += 1;
  } else {
    next.streak[seat] = 0;
  }

  const events = [{ type: 'answered', seat, correct: isCorrect, points }];
  // Both in? Reveal immediately rather than burning the rest of the clock.
  if (next.answers[next.qi][0] && next.answers[next.qi][1]) {
    next.phase = 'reveal';
    next.phaseEndsAt = now + next.config.revealMs;
    events.push({ type: 'reveal', qi: next.qi });
  }
  return done(next, events);
}

/** Drives the question -> reveal -> next question clock. Idempotent per `now`. */
export function tick(state, now = Date.now()) {
  if (state.phase === 'over') return { state, changed: false };
  if (now < state.phaseEndsAt) return { state, changed: false };

  const next = clone(state);
  if (next.phase === 'question') {
    // Time is up: unanswered seats score nothing and lose their streak.
    for (const seat of [0, 1]) {
      if (!next.answers[next.qi][seat]) {
        next.answers[next.qi][seat] = { choice: null, correct: false, points: 0, ms: next.config.perQuestion };
        next.streak[seat] = 0;
      }
    }
    next.phase = 'reveal';
    next.phaseEndsAt = now + next.config.revealMs;
    return { state: next, changed: true };
  }

  // phase === 'reveal'
  if (next.qi + 1 >= next.questions.length) {
    next.phase = 'over';
    next.winner = next.scores[0] === next.scores[1] ? 'draw' : next.scores[0] > next.scores[1] ? 0 : 1;
    next.phaseEndsAt = now;
    return { state: next, changed: true };
  }
  next.qi += 1;
  next.phase = 'question';
  next.phaseEndsAt = now + next.config.perQuestion;
  return { state: next, changed: true };
}

/** Hide the answer key, the opponent's pick, and every unasked question. */
export function view(state, seat) {
  const out = clone(state);
  const opp = seat === 0 ? 1 : 0;

  if (out.phase === 'question') {
    const q = out.questions[out.qi];
    if (q) out.questions[out.qi] = { ...q, c: -1 };
    const row = out.answers[out.qi];
    if (row && row[opp]) {
      // They have locked in — that much is fair to show. What they picked is not.
      row[opp] = { locked: true };
    }
  }

  // Questions that have not been asked yet never leave the server.
  out.questions = out.questions.map((q, i) =>
    i > out.qi ? { q: '', a: ['', '', '', ''], c: -1, cat: q.cat, d: q.d } : q,
  );
  return out;
}

/** Spectators get the question, never the key and never either pick. */
export function spectatorView(state) {
  const out = clone(state);
  if (out.phase === 'question') {
    const q = out.questions[out.qi];
    if (q) out.questions[out.qi] = { ...q, c: -1 };
    out.answers[out.qi] = out.answers[out.qi].map((a) => (a ? { locked: true } : null));
  }
  out.questions = out.questions.map((q, i) =>
    i > out.qi ? { q: '', a: ['', '', '', ''], c: -1, cat: q.cat, d: q.d } : q,
  );
  return out;
}

/* ── AI ───────────────────────────────────────────────────────────────────── */

/**
 * The bot answers after a human-ish delay, and its accuracy depends on level
 * and question difficulty. It is a practice partner, not an oracle.
 */
export function ai(state, seat, level = 2) {
  if (state.phase !== 'question') return null;
  if (state.answers[state.qi][seat]) return null;
  const question = state.questions[state.qi];
  if (!question) return null;

  const skill = [0, 0.45, 0.7, 0.88][Math.min(3, Math.max(1, level))];
  const penalty = (question.d - 1) * 0.12;
  const hit = Math.random() < Math.max(0.2, skill - penalty);
  const choice = hit ? question.c : [0, 1, 2, 3].filter((i) => i !== question.c)[Math.floor(Math.random() * 3)];
  return { type: 'answer', qi: state.qi, choice };
}

/** How long the bot should "think" before answering, in milliseconds. */
export function aiDelay(state, level = 2) {
  const base = [0, 6000, 4000, 2500][Math.min(3, Math.max(1, level))];
  return base + Math.random() * base * 0.8;
}
