/**
 * Offline play: vs the computer, or two people on one device.
 *
 * This is what makes the GitHub Pages build a complete game rather than a
 * brochure with a "connect to a server" button. It runs the same engines the
 * server runs, so the rules, the scoring and the endings are identical —
 * the only difference is that the referee is in this tab.
 */
import { getGame, tickOf } from '../../shared/games/index.js';
import { randomSeed } from '../../shared/rng.js';
import { END_REASONS } from '../../shared/protocol.js';
import * as quizEngine from '../../shared/games/quiz.js';
import * as reactionEngine from '../../shared/games/reaction.js';
import * as wordchainEngine from '../../shared/games/wordchain.js';
import * as memoryEngine from '../../shared/games/memory.js';

const TICK_MS = 60;

/** Which offline modes a game supports. */
export function localModes(meta) {
  const modes = [];
  if (meta.ai) modes.push('ai');
  // Hidden-information games cannot be played by two people on one screen.
  if (meta.mode === 'turn' && !meta.hidden) modes.push('hotseat');
  if (meta.solo) modes.push('solo');
  return modes.length ? modes : ['solo'];
}

export const MODE_LABELS = {
  ai: '컴퓨터와 대결',
  hotseat: '한 기기에서 둘이',
  solo: '혼자 연습',
};

export const LEVEL_LABELS = { 1: '쉬움', 2: '보통', 3: '어려움' };

/**
 * How the bot decides *when* to act in games that have no turn order.
 * Turn-based games use a simple "think, then move" delay instead.
 */
const SIMULTANEOUS_BOTS = {
  quiz: {
    schedule(state, level) {
      // One decision per question, scheduled when that question opens.
      if (state.phase !== 'question') return null;
      return { key: `q${state.qi}`, at: state.phaseEndsAt - state.config.perQuestion + quizEngine.aiDelay(state, level) };
    },
  },
  reaction: {
    schedule(state, level) {
      if (state.phase !== 'go' && state.phase !== 'waiting') return null;
      return { key: `r${state.round}`, at: state.goAt + reactionEngine.aiReaction(level) };
    },
  },
  typing: {
    // Types continuously; no schedule, the engine returns null when it is ahead.
    continuous: true,
  },
};

export class LocalMatch {
  /**
   * @param {object} options
   * @param {string} options.gameId
   * @param {'ai'|'hotseat'|'solo'} options.mode
   * @param {1|2|3} options.level
   * @param {object} options.config
   * @param {(snapshot: object) => void} options.onUpdate
   * @param {(events: object[]) => void} [options.onEvents]
   */
  constructor({ gameId, mode = 'ai', level = 2, config = {}, onUpdate, onEvents }) {
    this.engine = getGame(gameId);
    if (!this.engine) throw new Error(`unknown game "${gameId}"`);
    this.gameId = gameId;
    this.mode = mode;
    this.level = level;
    this.config = config;
    this.onUpdate = onUpdate;
    this.onEvents = onEvents;

    this.humanSeat = 0;
    this.botSeat = mode === 'ai' ? 1 : null;
    this.names = this.buildNames();
    this.state = null;
    this.result = null;
    this.timer = null;
    this.botAction = null; // { key, at } for simultaneous games
    this.botTurnAt = null; // when the bot should play its turn
  }

  buildNames() {
    if (this.mode === 'ai') return ['나', `컴퓨터 (${LEVEL_LABELS[this.level]})`];
    if (this.mode === 'hotseat') return ['플레이어 1', '플레이어 2'];
    return ['나', '연습'];
  }

  start() {
    this.state = this.engine.createState({ seed: randomSeed(), config: this.config, now: Date.now() });
    this.result = null;
    this.botAction = null;
    this.botTurnAt = null;
    clearInterval(this.timer);
    this.timer = setInterval(() => this.tick(), TICK_MS);
    this.tick();
    this.publish();
  }

  destroy() {
    clearInterval(this.timer);
    this.timer = null;
  }

  /** The seat the person at this keyboard is controlling right now. */
  get activeSeat() {
    if (this.mode === 'hotseat') {
      const status = this.engine.status(this.state);
      return status.turn === null ? this.humanSeat : status.turn;
    }
    return this.humanSeat;
  }

  /** Submit a move on behalf of the local player. */
  move(move) {
    if (!this.state || this.result) return { ok: false, error: '진행 중인 게임이 없습니다.' };
    const seat = this.activeSeat;
    const res = this.engine.applyMove(this.state, seat, move, { now: Date.now() });
    if (!res.ok) return res;
    this.state = res.state;
    if (res.events?.length) this.onEvents?.(res.events);
    this.afterChange();
    return { ok: true };
  }

  resign() {
    if (!this.state || this.result) return;
    const seat = this.activeSeat;
    this.finish(seat === 0 ? 1 : 0, 'resign');
  }

  /* ── Loop ───────────────────────────────────────────────────────────────── */

  tick() {
    if (!this.state || this.result) return;
    const now = Date.now();

    const ticked = tickOf(this.engine, this.state, now);
    if (ticked.changed) {
      this.state = ticked.state;
      this.afterChange();
      if (this.result) return;
    }

    this.driveBot(now);
  }

  driveBot(now) {
    if (this.botSeat === null || typeof this.engine.ai !== 'function') return;
    const status = this.engine.status(this.state);
    if (status.phase === 'over') return;

    // Setup phases (Battleship placement) have no turn — act immediately.
    if (status.phase === 'setup') {
      this.applyBotMove(this.engine.ai(this.state, this.botSeat, this.level));
      return;
    }

    const bot = SIMULTANEOUS_BOTS[this.gameId];
    if (bot) {
      if (bot.continuous) {
        this.applyBotMove(this.engine.ai(this.state, this.botSeat, this.level, now));
        return;
      }
      const plan = bot.schedule(this.state, this.level);
      if (!plan) {
        this.botAction = null;
        return;
      }
      if (!this.botAction || this.botAction.key !== plan.key) this.botAction = plan;
      if (now < this.botAction.at) return;
      const move = this.engine.ai(this.state, this.botSeat, this.level);
      this.botAction = { ...this.botAction, at: Infinity }; // one shot per key
      this.applyBotMove(move);
      return;
    }

    // Turn-based: think for a beat so the bot does not feel instantaneous.
    if (status.turn !== this.botSeat) {
      this.botTurnAt = null;
      return;
    }
    if (this.botTurnAt === null) {
      this.botTurnAt = now + this.thinkTime();
      return;
    }
    if (now < this.botTurnAt) return;
    this.botTurnAt = null;
    this.applyBotMove(this.engine.ai(this.state, this.botSeat, this.level));
  }

  thinkTime() {
    if (this.gameId === 'wordchain') return wordchainEngine.aiDelay(this.state, this.level);
    if (this.gameId === 'memory') return memoryEngine.aiDelay(this.level);
    // Enough to read the last move, not enough to get bored.
    return 380 + Math.random() * 520;
  }

  applyBotMove(move) {
    if (!move) return;
    const res = this.engine.applyMove(this.state, this.botSeat, move, { now: Date.now() });
    if (!res.ok) return;
    this.state = res.state;
    if (res.events?.length) this.onEvents?.(res.events);
    this.afterChange();
  }

  afterChange() {
    const status = this.engine.status(this.state);
    if (status.phase === 'over' && !this.result) this.finish(status.winner, 'normal', status);
    this.publish();
  }

  finish(winner, reason, status = null) {
    const st = status || this.engine.status(this.state);
    this.result = {
      winner,
      reason,
      reasonText: END_REASONS[reason] || reason,
      detail: st.reason || '',
      scores: st.scores || [0, 0],
      names: [...this.names],
    };
    clearInterval(this.timer);
    this.timer = null;
    this.publish();
  }

  /** Everything the match surface needs to draw a frame. */
  snapshot() {
    const status = this.engine.status(this.state);
    const seat = this.activeSeat;
    const view = typeof this.engine.view === 'function' ? this.engine.view(this.state, seat) : this.state;
    return {
      state: view,
      status,
      seat,
      interactive: !this.result,
      names: this.names,
      avatars: this.mode === 'ai' ? ['🙂', '🤖'] : ['🙂', '😎'],
      result: this.result,
      isLocal: true,
    };
  }

  publish() {
    this.onUpdate?.(this.snapshot());
  }
}
