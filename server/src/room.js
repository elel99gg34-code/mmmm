/**
 * A room is one table: two seats, any number of spectators, and at most one
 * match in progress.
 *
 * The room owns the authoritative game state. Clients send intents; the room
 * runs them through the shared engine and broadcasts the result. A client's
 * copy of the state is always something the server computed.
 */
import { getGame, viewFor, spectatorViewFor, tickOf } from '../../shared/games/index.js';
import { END_REASONS, LIMITS } from '../../shared/protocol.js';
import { randomSeed } from '../../shared/rng.js';
import { makeId, makeRoomCode, log } from './util.js';

/** How long a seat may stay empty mid-match before it is forfeited. */
export const DISCONNECT_GRACE_MS = 45_000;

export class Room {
  constructor({ id, name, gameId, hostId, isPrivate = false, config = {}, tournamentId = null, matchRef = null }) {
    this.id = id || makeId(6);
    this.code = makeRoomCode();
    this.name = name;
    this.gameId = gameId;
    this.hostId = hostId;
    this.isPrivate = isPrivate;
    this.config = config;
    this.tournamentId = tournamentId;
    this.matchRef = matchRef;

    this.seats = [null, null]; // client ids
    this.seatNames = [null, null]; // kept after a disconnect so results stay readable
    this.seatUsers = [null, null]; // account ids, for recording stats after the match
    this.spectators = new Set();
    this.ready = [false, false];
    this.rematchVotes = new Set();
    this.absentSince = [null, null];

    this.state = null;
    this.seed = null;
    this.phase = 'waiting'; // waiting | playing | over
    this.result = null;
    this.chat = [];
    this.createdAt = Date.now();
    this.startedAt = null;
    this.endedAt = null;
  }

  get game() {
    return getGame(this.gameId);
  }

  get playerCount() {
    return this.seats.filter(Boolean).length;
  }

  get isFull() {
    return this.playerCount >= 2;
  }

  seatOf(clientId) {
    const idx = this.seats.indexOf(clientId);
    return idx === -1 ? null : idx;
  }

  members() {
    return [...this.seats.filter(Boolean), ...this.spectators];
  }

  /* ── Membership ─────────────────────────────────────────────────────────── */

  /** Seat a client, or add them as a spectator when both seats are taken. */
  join(client, { asSpectator = false } = {}) {
    if (this.seatOf(client.id) !== null || this.spectators.has(client.id)) return { ok: true, role: 'already' };

    if (!asSpectator) {
      const free = this.seats.indexOf(null);
      if (free !== -1) {
        this.seats[free] = client.id;
        this.seatNames[free] = client.name;
        this.seatUsers[free] = client.userId ?? null;
        this.absentSince[free] = null;
        return { ok: true, role: 'player', seat: free };
      }
    }
    if (this.spectators.size >= LIMITS.maxSpectators) return { ok: false, error: '관전 인원이 가득 찼습니다.' };
    this.spectators.add(client.id);
    return { ok: true, role: 'spectator' };
  }

  /**
   * Remove a client. Mid-match this does not free the seat immediately — it
   * starts the reconnect grace period, so a dropped connection is a chance to
   * come back rather than an instant loss.
   */
  leave(clientId, { immediate = false } = {}) {
    if (this.spectators.delete(clientId)) return { role: 'spectator' };
    const seat = this.seatOf(clientId);
    if (seat === null) return { role: null };

    this.ready[seat] = false;
    this.rematchVotes.delete(clientId);

    if (this.phase === 'playing' && !immediate) {
      this.absentSince[seat] = Date.now();
      return { role: 'player', seat, pending: true };
    }
    this.seats[seat] = null;
    this.absentSince[seat] = null;
    if (this.phase !== 'playing') this.seatNames[seat] = null;
    if (this.hostId === clientId) this.hostId = this.seats.find(Boolean) || [...this.spectators][0] || null;
    return { role: 'player', seat };
  }

  /** Re-attach a returning client to the seat it was holding. */
  reclaim(client) {
    const seat = this.seats.indexOf(client.id);
    if (seat === -1) return null;
    this.absentSince[seat] = null;
    this.seatNames[seat] = client.name;
    this.seatUsers[seat] = client.userId ?? this.seatUsers[seat];
    return seat;
  }

  /* ── Match lifecycle ────────────────────────────────────────────────────── */

  canStart() {
    return this.phase !== 'playing' && this.isFull && this.ready[0] && this.ready[1];
  }

  start(now = Date.now()) {
    const game = this.game;
    if (!game) return { ok: false, error: '알 수 없는 게임입니다.' };
    this.seed = randomSeed();
    this.state = game.createState({ seed: this.seed, config: this.config, now });
    this.phase = 'playing';
    this.result = null;
    this.startedAt = now;
    this.endedAt = null;
    this.rematchVotes.clear();
    this.absentSince = [null, null];
    log.info('match started', { room: this.id, game: this.gameId });
    return { ok: true };
  }

  /** Apply a player's move. Returns `{ ok, events?, error? }`. */
  move(clientId, move, now = Date.now()) {
    if (this.phase !== 'playing') return { ok: false, error: '진행 중인 게임이 없습니다.' };
    const seat = this.seatOf(clientId);
    if (seat === null) return { ok: false, error: '관전자는 참여할 수 없습니다.' };

    const res = this.game.applyMove(this.state, seat, move, { now });
    if (!res.ok) return res;
    this.state = res.state;
    this.checkFinished(now);
    return { ok: true, events: res.events || [] };
  }

  /** Advance timers. Returns true when anything changed. */
  tick(now = Date.now()) {
    if (this.phase !== 'playing') return false;

    // A seat that has been gone past the grace period forfeits.
    for (const seat of [0, 1]) {
      if (this.absentSince[seat] !== null && now - this.absentSince[seat] > DISCONNECT_GRACE_MS) {
        this.finish(seat === 0 ? 1 : 0, 'disconnect', now);
        return true;
      }
    }

    const res = tickOf(this.game, this.state, now);
    if (!res.changed) return false;
    this.state = res.state;
    this.checkFinished(now);
    return true;
  }

  checkFinished(now = Date.now()) {
    const st = this.game.status(this.state);
    if (st.phase !== 'over') return false;
    this.finish(st.winner, 'normal', now, st);
    return true;
  }

  /** End the match and freeze the result. Idempotent. */
  finish(winner, reason, now = Date.now(), status = null) {
    if (this.phase === 'over') return this.result;
    const st = status || this.game.status(this.state);
    this.phase = 'over';
    this.endedAt = now;
    this.ready = [false, false];
    this.result = {
      winner,
      reason,
      reasonText: END_REASONS[reason] || reason,
      detail: st.reason || '',
      scores: st.scores || [0, 0],
      names: [...this.seatNames],
      seats: [...this.seats],
      users: [...this.seatUsers],
      durationMs: this.startedAt ? now - this.startedAt : 0,
    };
    // A seat abandoned mid-match is released now that the result is locked in.
    for (const seat of [0, 1]) {
      if (this.absentSince[seat] !== null) {
        this.seats[seat] = null;
        this.absentSince[seat] = null;
      }
    }
    log.info('match ended', { room: this.id, game: this.gameId, winner, reason });
    return this.result;
  }

  /** Both players voting for a rematch resets the table. */
  voteRematch(clientId) {
    if (this.phase !== 'over') return { ok: false, error: '아직 게임이 끝나지 않았습니다.' };
    if (this.seatOf(clientId) === null) return { ok: false, error: '대국자만 재대결을 신청할 수 있습니다.' };
    this.rematchVotes.add(clientId);
    const both = this.seats.every((id) => id && this.rematchVotes.has(id));
    if (!both) return { ok: true, started: false, votes: this.rematchVotes.size };
    this.phase = 'waiting';
    this.ready = [true, true];
    this.rematchVotes.clear();
    return { ok: true, started: true };
  }

  /* ── Serialisation ──────────────────────────────────────────────────────── */

  /** The row shown in the lobby list. */
  summary(nameOf) {
    return {
      id: this.id,
      name: this.name,
      gameId: this.gameId,
      host: nameOf(this.hostId),
      players: this.seats.map((id, i) => (id ? { id, name: nameOf(id) || this.seatNames[i] } : null)),
      spectators: this.spectators.size,
      phase: this.phase,
      isPrivate: this.isPrivate,
      tournamentId: this.tournamentId,
      createdAt: this.createdAt,
    };
  }

  /** The full room payload for one member, with the game state they may see. */
  snapshotFor(clientId, nameOf) {
    const seat = this.seatOf(clientId);
    const isPlayer = seat !== null;
    let gameState = null;
    if (this.state) {
      if (this.phase === 'over') gameState = this.state; // nothing left to hide
      else gameState = isPlayer ? viewFor(this.game, this.state, seat) : spectatorViewFor(this.game, this.state);
    }
    return {
      id: this.id,
      code: this.isPrivate ? this.code : null,
      name: this.name,
      gameId: this.gameId,
      hostId: this.hostId,
      isPrivate: this.isPrivate,
      config: this.config,
      tournamentId: this.tournamentId,
      matchRef: this.matchRef,
      seat,
      role: isPlayer ? 'player' : 'spectator',
      phase: this.phase,
      ready: [...this.ready],
      absent: this.absentSince.map((v) => v !== null),
      players: this.seats.map((id, i) => (id ? { id, name: nameOf(id) || this.seatNames[i] } : null)),
      spectators: [...this.spectators].map((id) => ({ id, name: nameOf(id) })),
      state: gameState,
      status: this.state ? this.game.status(this.state) : null,
      result: this.result,
      rematchVotes: this.rematchVotes.size,
      serverNow: Date.now(),
    };
  }
}
