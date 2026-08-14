/**
 * The engine contract every game in `shared/games/` implements.
 *
 * Engines are pure, JSON-serialisable rule modules with no DOM and no network
 * access. The browser imports them to render and to play offline (local 2P or
 * vs AI); the Node server imports the exact same files to referee online
 * matches. One rulebook, two runtimes — a move the client draws is a move the
 * server already agreed to.
 *
 * ── Required exports ────────────────────────────────────────────────────────
 *
 *   meta                          Descriptive metadata, see `MetaShape` below.
 *   createState(opts) -> state    Fresh match state. `opts.seed` is a string;
 *                                 identical seeds MUST yield identical states.
 *                                 `opts.now` seeds clocks for timed games.
 *   status(state) -> Status       Whose turn it is / whether it is over.
 *   applyMove(state, seat, move, ctx)
 *                                 -> { ok: true, state, events? }
 *                                 |  { ok: false, error: '...' }
 *                                 MUST NOT mutate the state it is given.
 *                                 `ctx.now` is the authoritative timestamp:
 *                                 the server always supplies its own, so a
 *                                 client cannot claim it answered earlier
 *                                 than it did.
 *
 * ── Optional exports ────────────────────────────────────────────────────────
 *
 *   legalMoves(state, seat)       Used by the AI and by UI hinting.
 *   view(state, seat) -> state    Redacts information a seat must not see
 *                                 (e.g. the opponent's fleet in Battleship).
 *                                 Defaults to the identity function.
 *   ai(state, seat, level)        Picks a move for a bot. level: 1..3.
 *   tick(state, now) -> {state, changed}
 *                                 Advances clocks for timed games. The server
 *                                 calls this on an interval; it must be
 *                                 idempotent for a given `now`.
 *
 * `seat` is always 0 or 1. Seat 0 moves first in turn-based games.
 *
 * ── Status ──────────────────────────────────────────────────────────────────
 *
 *   {
 *     phase:  'setup' | 'playing' | 'over',
 *     turn:   0 | 1 | null,        // null when nobody is on the clock
 *     winner: 0 | 1 | 'draw' | null,
 *     scores: [number, number],
 *     reason: string               // human-readable, shown in the result card
 *   }
 */

/** @typedef {{
 *   id: string, name: string, nameEn: string, emoji: string,
 *   category: '보드'|'전략'|'순발력'|'두뇌'|'퍼즐'|'지식',
 *   mode: 'turn'|'simul'|'race',
 *   ai: boolean, hidden?: boolean, timed?: boolean,
 *   desc: string, rules: string[]
 * }} MetaShape */

/** Deep copy of a JSON-safe value. Engines use it to stay non-mutating. */
export function clone(value) {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) {
    const out = new Array(value.length);
    for (let i = 0; i < value.length; i++) out[i] = clone(value[i]);
    return out;
  }
  const out = {};
  for (const k in value) out[k] = clone(value[k]);
  return out;
}

/** `{ ok: false, error }` shorthand. */
export function fail(error) {
  return { ok: false, error };
}

/** `{ ok: true, state, events }` shorthand. */
export function done(state, events) {
  return events && events.length ? { ok: true, state, events } : { ok: true, state };
}

/** The other seat. */
export const other = (seat) => (seat === 0 ? 1 : 0);

/** Status object with sensible defaults. */
export function makeStatus(partial) {
  return {
    phase: 'playing',
    turn: null,
    winner: null,
    scores: [0, 0],
    reason: '',
    ...partial,
  };
}

/**
 * Generic negamax with alpha-beta, used by the smaller perfect-information
 * games. `game` supplies the search hooks so each engine only writes an
 * evaluator and a move generator.
 *
 * @param {{
 *   moves: (s: any, seat: number) => any[],
 *   apply: (s: any, seat: number, m: any) => any,
 *   terminal: (s: any) => number|null,   // score from seat 0's view, or null
 *   evaluate: (s: any) => number,        // heuristic, seat 0's view
 * }} game
 */
export function negamax(game, state, seat, depth, alpha = -Infinity, beta = Infinity) {
  const term = game.terminal(state);
  if (term !== null) {
    // Prefer faster wins / slower losses so the bot finishes games it has won.
    const signed = seat === 0 ? term : -term;
    return { score: signed * (1 + depth * 0.001), move: null };
  }
  if (depth === 0) {
    const evalScore = game.evaluate(state);
    return { score: seat === 0 ? evalScore : -evalScore, move: null };
  }

  const moves = game.moves(state, seat);
  if (moves.length === 0) return { score: seat === 0 ? game.evaluate(state) : -game.evaluate(state), move: null };

  let best = -Infinity;
  let bestMove = moves[0];
  for (const move of moves) {
    const next = game.apply(state, seat, move);
    const { score } = negamax(game, next, other(seat), depth - 1, -beta, -alpha);
    const value = -score;
    if (value > best) {
      best = value;
      bestMove = move;
    }
    if (value > alpha) alpha = value;
    if (alpha >= beta) break;
  }
  return { score: best, move: bestMove };
}
