/**
 * 끝말잇기 (Korean Word Chain).
 *
 * Say a word beginning with the last syllable of the previous word, inside the
 * time limit, without repeating. 두음법칙 is honoured — 력 opens 역, 라 opens
 * 나 — because refusing it is the single most common complaint about digital
 * 끝말잇기.
 */
import { clone, fail, done, other, makeStatus } from './_engine.js';
import { Rng } from '../rng.js';
import { isHangulWord, allowedStarts } from '../hangul.js';
import { WORDS, isKnownWord, wordsStartingWith } from '../data/korean-words.js';

export const meta = {
  id: 'wordchain',
  name: '끝말잇기',
  nameEn: 'Word Chain',
  emoji: '🔤',
  category: '지식',
  mode: 'turn',
  ai: true,
  timed: true,
  desc: '앞 단어의 끝 글자로 시작하는 단어를 제한 시간 안에. 두음법칙도 인정합니다.',
  rules: [
    '앞 단어의 마지막 글자로 시작하는 두 글자 이상의 낱말을 입력합니다.',
    '두음법칙을 인정합니다. 예) 심리 → 이발소, 도로 → 노래.',
    '이미 나온 단어는 다시 쓸 수 없습니다.',
    '제한 시간(기본 15초) 안에 답하지 못하면 패배합니다.',
    '엄격 모드에서는 내장 사전에 있는 낱말만 인정합니다.',
  ],
};

export const DEFAULTS = { turnMs: 15000, strict: true, minLength: 2 };

export function createState(opts = {}) {
  const config = { ...DEFAULTS, ...(opts.config || {}) };
  const rng = new Rng(opts.seed || 'wordchain');
  const now = opts.now ?? Date.now();
  // Open with a word that has plenty of continuations so nobody is dead on
  // arrival at move one.
  const openers = WORDS.filter((w) => w.length >= 2 && wordsStartingWith(allowedStarts(w[w.length - 1])).length >= 6);
  const first = rng.pick(openers.length ? openers : WORDS);
  return {
    config,
    chain: [{ word: first, seat: null }],
    used: [first],
    turn: 0,
    deadline: now + config.turnMs,
    winner: null,
    reason: '',
  };
}

export function lastWord(state) {
  return state.chain[state.chain.length - 1].word;
}

/** The syllables the next word may start with. */
export function nextStarts(state) {
  const word = lastWord(state);
  return [...allowedStarts(word[word.length - 1])];
}

export function status(state) {
  if (state.winner !== null) {
    return makeStatus({
      phase: 'over',
      turn: null,
      winner: state.winner,
      scores: [
        state.chain.filter((c) => c.seat === 0).length,
        state.chain.filter((c) => c.seat === 1).length,
      ],
      reason: state.reason,
    });
  }
  return makeStatus({
    phase: 'playing',
    turn: state.turn,
    scores: [state.chain.filter((c) => c.seat === 0).length, state.chain.filter((c) => c.seat === 1).length],
  });
}

/** Validate a candidate without mutating anything. Returns an error or null. */
export function checkWord(state, word) {
  if (typeof word !== 'string') return '낱말을 입력해 주세요.';
  const clean = word.trim();
  if (clean.length < state.config.minLength) return `${state.config.minLength}글자 이상이어야 합니다.`;
  if (!isHangulWord(clean)) return '한글 낱말만 입력할 수 있습니다.';
  if (state.used.includes(clean)) return '이미 나온 낱말입니다.';
  const starts = allowedStarts(lastWord(state)[lastWord(state).length - 1]);
  if (!starts.has(clean[0])) return `"${[...starts].join('" 또는 "')}"(으)로 시작해야 합니다.`;
  if (state.config.strict && !isKnownWord(clean)) return '사전에 없는 낱말입니다.';
  return null;
}

export function legalMoves(state) {
  if (state.winner !== null) return [];
  const starts = allowedStarts(lastWord(state)[lastWord(state).length - 1]);
  return wordsStartingWith(starts)
    .filter((w) => !state.used.includes(w))
    .map((word) => ({ type: 'word', word }));
}

export function applyMove(state, seat, move, ctx = {}) {
  const now = ctx.now ?? Date.now();
  if (state.winner !== null) return fail('이미 끝난 게임입니다.');
  if (seat !== state.turn) return fail('상대 차례입니다.');
  if (!move || move.type !== 'word') return fail('알 수 없는 동작입니다.');
  if (now > state.deadline + 1500) return fail('시간이 지났습니다.');

  const word = String(move.word || '').trim();
  const problem = checkWord(state, word);
  if (problem) return fail(problem);

  const next = clone(state);
  next.chain.push({ word, seat, at: now });
  next.used.push(word);
  next.turn = other(seat);
  next.deadline = now + next.config.turnMs;

  // If the opponent has literally nothing to say, the chain ends here.
  if (next.config.strict && legalMoves(next).length === 0) {
    next.winner = seat;
    next.turn = null;
    next.reason = `"${word}"로 이어갈 낱말이 없습니다.`;
  }
  return done(next, [{ type: 'word', word, seat }]);
}

/** Times out the player on the clock. */
export function tick(state, now = Date.now()) {
  if (state.winner !== null) return { state, changed: false };
  if (now <= state.deadline) return { state, changed: false };
  const next = clone(state);
  next.winner = other(next.turn);
  next.reason = '시간 초과';
  next.turn = null;
  return { state: next, changed: true };
}

/* ── AI ───────────────────────────────────────────────────────────────────── */

export function ai(state, seat, level = 2) {
  const options = legalMoves(state);
  if (!options.length) return null;
  if (level <= 1) return options[Math.floor(Math.random() * options.length)];

  // Prefer words whose ending leaves the opponent the fewest replies.
  const scored = options.map((opt) => {
    const ending = opt.word[opt.word.length - 1];
    const replies = wordsStartingWith(allowedStarts(ending)).filter(
      (w) => !state.used.includes(w) && w !== opt.word,
    ).length;
    return { opt, replies };
  });
  scored.sort((a, b) => a.replies - b.replies);
  const pool = level >= 3 ? scored.slice(0, 3) : scored.slice(0, Math.max(3, Math.floor(scored.length / 2)));
  return pool[Math.floor(Math.random() * pool.length)].opt;
}

/** How long the bot waits before answering, in milliseconds. */
export function aiDelay(state, level = 2) {
  const base = [0, 5000, 3200, 1800][Math.min(3, Math.max(1, level))];
  return base + Math.random() * 1500;
}
