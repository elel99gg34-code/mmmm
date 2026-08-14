/**
 * Single-elimination bracket — the "대결퀴즈 대회" engine.
 *
 * Any 1v1 game can host one; Quiz Battle is the headline. The bracket is
 * padded to the next power of two with byes, seeds are shuffled once at start,
 * and each round's matches run in ordinary rooms so spectators, chat and
 * reconnects all work exactly as they do elsewhere.
 */
import { makeId, log } from './util.js';

export const STATUS = { LOBBY: 'lobby', RUNNING: 'running', DONE: 'done' };

/** Smallest power of two that fits `n`, at least 2. */
function bracketSize(n) {
  let size = 2;
  while (size < n) size *= 2;
  return size;
}

export class Tournament {
  constructor({ id, name, gameId, size, hostId, config = {} }) {
    this.id = id || makeId(6);
    this.name = name;
    this.gameId = gameId;
    this.size = size; // the advertised cap: 4, 8 or 16
    this.hostId = hostId;
    this.config = config;
    this.status = STATUS.LOBBY;
    this.players = []; // { id, name, avatar }
    this.rounds = []; // rounds[r] = [{ a, b, winner, roomId, done }]
    this.round = 0;
    this.champion = null;
    this.createdAt = Date.now();
    this.startedAt = null;
    this.endedAt = null;
  }

  has(clientId) {
    return this.players.some((p) => p.id === clientId);
  }

  join(client) {
    if (this.status !== STATUS.LOBBY) return { ok: false, error: '이미 시작된 대회입니다.' };
    if (this.has(client.id)) return { ok: true };
    if (this.players.length >= this.size) return { ok: false, error: '참가 인원이 가득 찼습니다.' };
    this.players.push({ id: client.id, name: client.name, avatar: client.avatar });
    return { ok: true };
  }

  leave(clientId) {
    if (this.status === STATUS.LOBBY) {
      this.players = this.players.filter((p) => p.id !== clientId);
      if (this.hostId === clientId) this.hostId = this.players[0]?.id ?? null;
      return { ok: true };
    }
    // Mid-tournament a walkout is a forfeit, resolved by the hub.
    return { ok: true, forfeit: true };
  }

  /** Shuffle the field and build round one. `rng` is injected so tests can pin it. */
  start(rng) {
    if (this.status !== STATUS.LOBBY) return { ok: false, error: '이미 시작되었습니다.' };
    if (this.players.length < 2) return { ok: false, error: '참가자가 2명 이상이어야 합니다.' };

    const seeds = rng ? rng.shuffle(this.players.slice()) : this.players.slice();
    const slots = bracketSize(seeds.length);
    const padded = [...seeds.map((p) => p.id)];
    while (padded.length < slots) padded.push(null); // byes

    const first = [];
    for (let i = 0; i < slots; i += 2) {
      first.push(this.makeMatch(padded[i], padded[i + 1]));
    }
    this.rounds = [first];
    this.round = 0;
    this.status = STATUS.RUNNING;
    this.startedAt = Date.now();
    log.info('tournament started', { id: this.id, game: this.gameId, players: seeds.length });
    return { ok: true };
  }

  makeMatch(a, b) {
    const match = { id: makeId(4), a, b, winner: null, roomId: null, done: false };
    // A bye resolves the instant it is created.
    if (a && !b) {
      match.winner = a;
      match.done = true;
      match.bye = true;
    } else if (!a && b) {
      match.winner = b;
      match.done = true;
      match.bye = true;
    } else if (!a && !b) {
      match.done = true;
      match.bye = true;
    }
    return match;
  }

  currentMatches() {
    return this.rounds[this.round] || [];
  }

  /** Matches in the current round that still need a room. */
  pendingMatches() {
    return this.currentMatches().filter((m) => !m.done && !m.roomId);
  }

  findMatch(matchId) {
    for (const round of this.rounds) {
      const found = round.find((m) => m.id === matchId);
      if (found) return found;
    }
    return null;
  }

  matchForPlayer(clientId) {
    return this.currentMatches().find((m) => !m.done && (m.a === clientId || m.b === clientId)) || null;
  }

  /**
   * Record a result. Returns `{ advanced }` when the round completed, so the
   * hub knows to open the next set of rooms.
   */
  report(matchId, winnerId) {
    const match = this.findMatch(matchId);
    if (!match || match.done) return { ok: false };
    match.winner = winnerId;
    match.done = true;
    if (!this.currentMatches().every((m) => m.done)) return { ok: true, advanced: false };
    return { ok: true, advanced: true, ...this.advance() };
  }

  /** Build the next round, or crown the champion. */
  advance() {
    const winners = this.currentMatches().map((m) => m.winner);
    const alive = winners.filter(Boolean);

    if (alive.length <= 1) {
      this.status = STATUS.DONE;
      this.champion = alive[0] ?? null;
      this.endedAt = Date.now();
      log.info('tournament finished', { id: this.id, champion: this.champion });
      return { finished: true, champion: this.champion };
    }

    const next = [];
    for (let i = 0; i < winners.length; i += 2) next.push(this.makeMatch(winners[i], winners[i + 1] ?? null));
    this.rounds.push(next);
    this.round += 1;

    // A round made entirely of byes needs no rooms — resolve it immediately.
    if (next.every((m) => m.done)) return this.advance();
    return { finished: false };
  }

  /** Human-readable name for the current round: 결승 / 4강 / 8강 … */
  roundLabel(index = this.round) {
    const matches = (this.rounds[index] || []).length;
    if (matches === 1) return '결승';
    if (matches === 2) return '4강';
    if (matches === 4) return '8강';
    if (matches === 8) return '16강';
    return `${index + 1}라운드`;
  }

  nameOf(clientId, fallbackLookup) {
    if (!clientId) return null;
    const player = this.players.find((p) => p.id === clientId);
    return player ? player.name : fallbackLookup?.(clientId) || null;
  }

  /** Wire payload. `nameOf` resolves live client names for the bracket labels. */
  snapshot(nameOf) {
    return {
      id: this.id,
      name: this.name,
      gameId: this.gameId,
      size: this.size,
      hostId: this.hostId,
      status: this.status,
      round: this.round,
      roundLabel: this.roundLabel(),
      champion: this.champion,
      championName: this.nameOf(this.champion, nameOf),
      players: this.players.map((p) => ({ ...p })),
      rounds: this.rounds.map((round, r) =>
        round.map((m) => ({
          ...m,
          aName: this.nameOf(m.a, nameOf),
          bName: this.nameOf(m.b, nameOf),
          winnerName: this.nameOf(m.winner, nameOf),
          roundLabel: this.roundLabel(r),
        })),
      ),
      createdAt: this.createdAt,
    };
  }

  /** The row shown in the tournament list. */
  summary() {
    return {
      id: this.id,
      name: this.name,
      gameId: this.gameId,
      size: this.size,
      status: this.status,
      joined: this.players.length,
      roundLabel: this.status === STATUS.RUNNING ? this.roundLabel() : null,
      championName: this.champion ? this.nameOf(this.champion) : null,
    };
  }
}
