/**
 * The Hub — everything that is not a game rule.
 *
 * Connections, identities, the lobby and its chat, room lifecycle, quick-match
 * queues, tournaments, and the 10 Hz timer that drives every timed game. Game
 * *rules* live in `shared/games/`; this file never decides who won anything.
 */
import { getGame, catalogue, gameIds } from '../../shared/games/index.js';
import { C2S, S2C, LIMITS, AVATARS, sanitizeName, sanitizeChat, guestName, PROTOCOL_VERSION } from '../../shared/protocol.js';
import { Rng, randomSeed } from '../../shared/rng.js';
import { Room } from './room.js';
import { Tournament, STATUS as T_STATUS } from './tournament.js';
import { makeId, log, RateLimiter, clampInt } from './util.js';

const TICK_MS = 100;
const LOBBY_CHAT_HISTORY = 60;
const ROOM_CHAT_HISTORY = 80;
/** How long a disconnected identity can still be resumed. */
export const GHOST_TTL_MS = 90_000;
/** Idle rooms are swept so the lobby stays honest. */
const EMPTY_ROOM_TTL_MS = 60_000;
const FINISHED_TOURNEY_TTL_MS = 30 * 60_000;

export class Hub {
  constructor() {
    this.clients = new Map(); // id -> client
    this.rooms = new Map();
    this.tournaments = new Map();
    this.queues = new Map(gameIds().map((id) => [id, []]));
    this.ghosts = new Map(); // id -> { name, avatar, roomId, tournamentId, expiresAt }
    this.lobbyChat = [];
    this.guestCounter = 0;
    this.startedAt = Date.now();
    this.stats = { connections: 0, matches: 0, messages: 0 };
    this.timer = setInterval(() => this.tick(), TICK_MS);
    if (typeof this.timer.unref === 'function') this.timer.unref();
  }

  stop() {
    clearInterval(this.timer);
  }

  /* ── Connection lifecycle ───────────────────────────────────────────────── */

  addConnection(ws, meta = {}) {
    const client = {
      id: makeId(10),
      ws,
      name: null,
      avatar: 0,
      roomId: null,
      tournamentId: null,
      queueGame: null,
      lobbySub: false,
      alive: true,
      ip: meta.ip || '',
      joinedAt: Date.now(),
      limiter: new RateLimiter(40, 12),
      chatLimiter: new RateLimiter(6, 1),
    };
    this.clients.set(client.id, client);
    this.stats.connections++;
    return client;
  }

  removeConnection(client) {
    if (!this.clients.has(client.id)) return;
    this.clients.delete(client.id);
    this.dequeue(client);

    const room = client.roomId ? this.rooms.get(client.roomId) : null;
    if (room) {
      const res = room.leave(client.id);
      if (res.pending) {
        // Mid-match: hold the seat open so they can come back.
        this.ghosts.set(client.id, {
          name: client.name,
          avatar: client.avatar,
          roomId: room.id,
          tournamentId: client.tournamentId,
          expiresAt: Date.now() + GHOST_TTL_MS,
        });
        this.systemChat(room, `${client.name} 님의 연결이 끊겼습니다. 재접속을 기다립니다…`);
      } else {
        this.systemChat(room, `${client.name} 님이 나갔습니다.`);
      }
      this.broadcastRoom(room);
      this.reapRoom(room);
    }

    if (client.tournamentId) {
      const tourney = this.tournaments.get(client.tournamentId);
      if (tourney && tourney.status === T_STATUS.LOBBY) {
        tourney.leave(client.id);
        this.broadcastTournament(tourney);
      }
    }
    this.broadcastLobby();
    log.debug('client disconnected', { id: client.id, name: client.name });
  }

  /* ── Sending ────────────────────────────────────────────────────────────── */

  send(client, type, payload = {}) {
    if (!client || !client.ws || client.ws.readyState !== 1) return;
    try {
      client.ws.send(JSON.stringify({ t: type, ...payload }));
    } catch (err) {
      log.warn('send failed', { id: client.id, err: String(err) });
    }
  }

  sendTo(clientId, type, payload) {
    const client = this.clients.get(clientId);
    if (client) this.send(client, type, payload);
  }

  error(client, message) {
    this.send(client, S2C.ERROR, { message });
  }

  notice(client, message, kind = 'info') {
    this.send(client, S2C.NOTICE, { message, kind });
  }

  nameOf(clientId) {
    if (!clientId) return null;
    const client = this.clients.get(clientId);
    if (client) return client.name;
    const ghost = this.ghosts.get(clientId);
    return ghost ? ghost.name : null;
  }

  avatarOf(clientId) {
    const client = this.clients.get(clientId);
    if (client) return client.avatar;
    return this.ghosts.get(clientId)?.avatar ?? 0;
  }

  /* ── Message routing ────────────────────────────────────────────────────── */

  handle(client, raw) {
    this.stats.messages++;
    if (!client.limiter.take()) {
      this.error(client, '요청이 너무 빠릅니다. 잠시 후 다시 시도해 주세요.');
      return;
    }

    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      this.error(client, '잘못된 형식의 메시지입니다.');
      return;
    }
    if (!msg || typeof msg.t !== 'string') return this.error(client, '메시지 형식이 올바르지 않습니다.');

    // `hello` is the only message allowed before an identity exists.
    if (!client.name && msg.t !== C2S.HELLO) return this.error(client, '먼저 접속 인사를 보내야 합니다.');

    const handler = this.routes[msg.t];
    if (!handler) return this.error(client, `알 수 없는 요청입니다: ${msg.t}`);
    try {
      handler.call(this, client, msg);
    } catch (err) {
      log.error('handler threw', { t: msg.t, err: err.stack });
      this.error(client, '서버에서 오류가 발생했습니다.');
    }
  }

  get routes() {
    if (this._routes) return this._routes;
    this._routes = {
      [C2S.HELLO]: this.onHello,
      [C2S.PING]: this.onPing,
      [C2S.PROFILE]: this.onProfile,
      [C2S.LOBBY_SUB]: this.onLobbySubscribe,
      [C2S.LOBBY_UNSUB]: this.onLobbyUnsubscribe,
      [C2S.CHAT]: this.onChat,
      [C2S.ROOM_CREATE]: this.onRoomCreate,
      [C2S.ROOM_JOIN]: this.onRoomJoin,
      [C2S.ROOM_LEAVE]: this.onRoomLeave,
      [C2S.ROOM_READY]: this.onRoomReady,
      [C2S.ROOM_REMATCH]: this.onRoomRematch,
      [C2S.ROOM_CONFIG]: this.onRoomConfig,
      [C2S.QUEUE_JOIN]: this.onQueueJoin,
      [C2S.QUEUE_LEAVE]: this.onQueueLeave,
      [C2S.GAME_MOVE]: this.onGameMove,
      [C2S.GAME_RESIGN]: this.onGameResign,
      [C2S.TOURNEY_CREATE]: this.onTourneyCreate,
      [C2S.TOURNEY_JOIN]: this.onTourneyJoin,
      [C2S.TOURNEY_LEAVE]: this.onTourneyLeave,
      [C2S.TOURNEY_START]: this.onTourneyStart,
      [C2S.TOURNEY_LIST]: this.onTourneyList,
    };
    return this._routes;
  }

  /* ── Identity ───────────────────────────────────────────────────────────── */

  onHello(client, msg) {
    if (client.name) return this.error(client, '이미 접속했습니다.');

    client.name = sanitizeName(msg.name) || guestName(this.guestCounter++);
    client.avatar = clampInt(msg.avatar, 0, AVATARS.length - 1, Math.floor(Math.random() * AVATARS.length));

    // Resume a dropped session if the token still points at a live seat.
    let resumedRoom = null;
    const ghost = msg.resume ? this.ghosts.get(msg.resume) : null;
    if (ghost && ghost.expiresAt > Date.now() && !this.clients.has(msg.resume)) {
      this.clients.delete(client.id);
      client.id = msg.resume;
      client.name = ghost.name || client.name;
      client.avatar = ghost.avatar ?? client.avatar;
      client.tournamentId = ghost.tournamentId ?? null;
      this.clients.set(client.id, client);
      this.ghosts.delete(msg.resume);

      const room = ghost.roomId ? this.rooms.get(ghost.roomId) : null;
      if (room && room.reclaim(client) !== null) {
        client.roomId = room.id;
        resumedRoom = room;
        this.systemChat(room, `${client.name} 님이 다시 연결되었습니다.`);
      }
    }

    this.send(client, S2C.WELCOME, {
      id: client.id,
      name: client.name,
      avatar: client.avatar,
      protocol: PROTOCOL_VERSION,
      serverNow: Date.now(),
      games: catalogue(),
      limits: LIMITS,
      avatars: AVATARS,
      resumed: Boolean(resumedRoom),
    });

    if (resumedRoom) {
      this.broadcastRoom(resumedRoom);
    }
    log.debug('client hello', { id: client.id, name: client.name });
    this.broadcastLobby();
  }

  onPing(client, msg) {
    // `echo` lets the client compute round-trip time and its clock offset.
    this.send(client, S2C.PONG, { serverNow: Date.now(), echo: msg.echo ?? null });
  }

  onProfile(client, msg) {
    const name = sanitizeName(msg.name);
    if (!name) return this.error(client, '이름은 1~16자여야 합니다.');
    client.name = name;
    if (Number.isInteger(msg.avatar)) client.avatar = clampInt(msg.avatar, 0, AVATARS.length - 1, client.avatar);
    this.send(client, S2C.WELCOME, {
      id: client.id,
      name: client.name,
      avatar: client.avatar,
      protocol: PROTOCOL_VERSION,
      serverNow: Date.now(),
      games: catalogue(),
      limits: LIMITS,
      avatars: AVATARS,
      resumed: false,
    });
    const room = client.roomId ? this.rooms.get(client.roomId) : null;
    if (room) {
      const seat = room.seatOf(client.id);
      if (seat !== null) room.seatNames[seat] = client.name;
      this.broadcastRoom(room);
    }
    this.broadcastLobby();
  }

  /* ── Lobby & chat ───────────────────────────────────────────────────────── */

  onLobbySubscribe(client) {
    client.lobbySub = true;
    this.send(client, S2C.LOBBY, this.lobbyState());
    this.send(client, S2C.CHAT, { scope: 'lobby', history: this.lobbyChat });
  }

  onLobbyUnsubscribe(client) {
    client.lobbySub = false;
  }

  onChat(client, msg) {
    const text = sanitizeChat(msg.text);
    if (!text) return;
    if (!client.chatLimiter.take()) return this.error(client, '채팅이 너무 빠릅니다.');

    const entry = {
      id: makeId(6),
      from: client.id,
      name: client.name,
      avatar: client.avatar,
      text,
      at: Date.now(),
    };

    if (msg.scope === 'room') {
      const room = client.roomId ? this.rooms.get(client.roomId) : null;
      if (!room) return this.error(client, '참여 중인 방이 없습니다.');
      room.chat.push(entry);
      if (room.chat.length > ROOM_CHAT_HISTORY) room.chat.shift();
      for (const memberId of room.members()) {
        this.sendTo(memberId, S2C.CHAT, { scope: 'room', roomId: room.id, message: entry });
      }
      return;
    }

    this.lobbyChat.push(entry);
    if (this.lobbyChat.length > LOBBY_CHAT_HISTORY) this.lobbyChat.shift();
    for (const other of this.clients.values()) {
      if (other.lobbySub) this.send(other, S2C.CHAT, { scope: 'lobby', message: entry });
    }
  }

  /** A server-authored line in a room's chat log. */
  systemChat(room, text) {
    const entry = { id: makeId(6), from: null, name: null, system: true, text, at: Date.now() };
    room.chat.push(entry);
    if (room.chat.length > ROOM_CHAT_HISTORY) room.chat.shift();
    for (const memberId of room.members()) {
      this.sendTo(memberId, S2C.CHAT, { scope: 'room', roomId: room.id, message: entry });
    }
  }

  lobbyState() {
    const nameOf = (id) => this.nameOf(id);
    const rooms = [...this.rooms.values()]
      .filter((r) => !r.isPrivate && !r.tournamentId)
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, 60)
      .map((r) => r.summary(nameOf));

    const players = [...this.clients.values()]
      .filter((c) => c.name)
      .map((c) => ({ id: c.id, name: c.name, avatar: c.avatar, inRoom: Boolean(c.roomId) }));

    return {
      rooms,
      players: players.slice(0, 120),
      online: players.length,
      queues: Object.fromEntries([...this.queues].map(([gameId, list]) => [gameId, list.length])),
      tournaments: [...this.tournaments.values()]
        .filter((t) => t.status !== T_STATUS.DONE)
        .map((t) => t.summary()),
      uptimeMs: Date.now() - this.startedAt,
      serverNow: Date.now(),
    };
  }

  broadcastLobby() {
    if (this._lobbyPending) return;
    // Coalesce bursts — joins and leaves often arrive together.
    this._lobbyPending = setTimeout(() => {
      this._lobbyPending = null;
      const payload = this.lobbyState();
      for (const client of this.clients.values()) {
        if (client.lobbySub) this.send(client, S2C.LOBBY, payload);
      }
    }, 80);
    if (typeof this._lobbyPending.unref === 'function') this._lobbyPending.unref();
  }

  /* ── Rooms ──────────────────────────────────────────────────────────────── */

  broadcastRoom(room) {
    const nameOf = (id) => this.nameOf(id);
    for (const memberId of room.members()) {
      const client = this.clients.get(memberId);
      if (!client) continue;
      this.send(client, S2C.ROOM, { room: room.snapshotFor(memberId, nameOf) });
    }
  }

  /** Delete a room nobody is using. */
  reapRoom(room) {
    if (room.members().length > 0) return false;
    if (room.tournamentId && room.phase === 'playing') return false;
    if (Date.now() - room.createdAt < 1500 && room.phase === 'waiting') return false;
    this.rooms.delete(room.id);
    this.broadcastLobby();
    return true;
  }

  leaveCurrentRoom(client, { silent = false } = {}) {
    const room = client.roomId ? this.rooms.get(client.roomId) : null;
    client.roomId = null;
    if (!room) return;
    const res = room.leave(client.id, { immediate: true });
    if (res.role === 'player' && room.phase === 'playing') {
      room.finish(res.seat === 0 ? 1 : 0, 'abandoned');
      this.onMatchOver(room);
    }
    if (!silent) this.systemChat(room, `${client.name} 님이 나갔습니다.`);
    this.send(client, S2C.ROOM_LEFT, { roomId: room.id });
    this.broadcastRoom(room);
    this.reapRoom(room);
    this.broadcastLobby();
  }

  onRoomCreate(client, msg) {
    const game = getGame(msg.gameId);
    if (!game) return this.error(client, '알 수 없는 게임입니다.');
    this.dequeue(client);
    this.leaveCurrentRoom(client);

    const name = sanitizeName(msg.name)?.slice(0, LIMITS.roomNameMax) || `${client.name}의 방`;
    const room = new Room({
      name,
      gameId: msg.gameId,
      hostId: client.id,
      isPrivate: Boolean(msg.isPrivate),
      config: this.sanitizeConfig(msg.gameId, msg.config),
    });
    this.rooms.set(room.id, room);
    room.join(client);
    client.roomId = room.id;

    this.send(client, S2C.ROOM, { room: room.snapshotFor(client.id, (id) => this.nameOf(id)), chat: room.chat });
    this.broadcastLobby();
    log.info('room created', { room: room.id, game: room.gameId, by: client.name });
  }

  onRoomJoin(client, msg) {
    const room = this.findRoom(msg.roomId, msg.code);
    if (!room) return this.error(client, '방을 찾을 수 없습니다.');
    if (room.tournamentId) return this.error(client, '대회 경기는 직접 참여할 수 없습니다.');
    if (client.roomId === room.id) return this.broadcastRoom(room);

    this.dequeue(client);
    this.leaveCurrentRoom(client);

    const res = room.join(client, { asSpectator: Boolean(msg.spectate) });
    if (!res.ok) return this.error(client, res.error);
    client.roomId = room.id;

    this.send(client, S2C.ROOM, { room: room.snapshotFor(client.id, (id) => this.nameOf(id)), chat: room.chat });
    this.systemChat(room, `${client.name} 님이 ${res.role === 'spectator' ? '관전' : '입장'}했습니다.`);
    this.broadcastRoom(room);
    this.broadcastLobby();
  }

  findRoom(roomId, code) {
    if (roomId && this.rooms.has(roomId)) return this.rooms.get(roomId);
    if (!code) return null;
    const wanted = String(code).trim().toUpperCase();
    return [...this.rooms.values()].find((r) => r.code === wanted) || null;
  }

  onRoomLeave(client) {
    this.leaveCurrentRoom(client);
  }

  onRoomReady(client, msg) {
    const room = client.roomId ? this.rooms.get(client.roomId) : null;
    if (!room) return this.error(client, '참여 중인 방이 없습니다.');
    const seat = room.seatOf(client.id);
    if (seat === null) return this.error(client, '관전자는 준비할 수 없습니다.');
    if (room.phase === 'playing') return this.error(client, '이미 진행 중입니다.');

    room.ready[seat] = msg.ready === undefined ? !room.ready[seat] : Boolean(msg.ready);
    if (room.canStart()) this.startMatch(room);
    else this.broadcastRoom(room);
  }

  startMatch(room) {
    const res = room.start();
    if (!res.ok) {
      this.systemChat(room, res.error);
      return;
    }
    this.stats.matches++;
    this.systemChat(room, '게임이 시작되었습니다. 좋은 승부 되세요!');
    this.broadcastRoom(room);
    this.broadcastLobby();
  }

  onRoomRematch(client) {
    const room = client.roomId ? this.rooms.get(client.roomId) : null;
    if (!room) return this.error(client, '참여 중인 방이 없습니다.');
    const res = room.voteRematch(client.id);
    if (!res.ok) return this.error(client, res.error);
    if (res.started) {
      this.systemChat(room, '두 분 모두 재대결에 동의했습니다.');
      this.startMatch(room);
    } else {
      this.systemChat(room, `${client.name} 님이 재대결을 신청했습니다.`);
      this.broadcastRoom(room);
    }
  }

  onRoomConfig(client, msg) {
    const room = client.roomId ? this.rooms.get(client.roomId) : null;
    if (!room) return this.error(client, '참여 중인 방이 없습니다.');
    if (room.hostId !== client.id) return this.error(client, '방장만 설정을 바꿀 수 있습니다.');
    if (room.phase === 'playing') return this.error(client, '진행 중에는 바꿀 수 없습니다.');
    room.config = this.sanitizeConfig(room.gameId, msg.config);
    room.ready = [false, false];
    this.systemChat(room, '방 설정이 변경되었습니다.');
    this.broadcastRoom(room);
  }

  /** Only let clients set the knobs we intend to expose, within safe bounds. */
  sanitizeConfig(gameId, raw) {
    if (!raw || typeof raw !== 'object') return {};
    const out = {};
    const num = (key, min, max) => {
      if (raw[key] === undefined) return;
      const value = clampInt(raw[key], min, max, undefined);
      if (value !== undefined) out[key] = value;
    };
    switch (gameId) {
      case 'quiz':
        num('count', 3, 20);
        num('perQuestion', 5000, 40000);
        num('maxDifficulty', 1, 3);
        if (Array.isArray(raw.categories)) out.categories = raw.categories.filter((c) => typeof c === 'string').slice(0, 9);
        break;
      case 'wordchain':
        num('turnMs', 5000, 60000);
        if (typeof raw.strict === 'boolean') out.strict = raw.strict;
        break;
      case 'typing':
        num('timeLimit', 30000, 300000);
        if (typeof raw.textId === 'string') out.textId = raw.textId.slice(0, 32);
        break;
      case 'reaction':
        num('rounds', 3, 9);
        break;
      case 'minesweeper':
        num('rows', 8, 24);
        num('cols', 8, 24);
        num('mines', 5, 120);
        break;
      case 'g2048':
      case 'snake':
        num('timeLimit', 30000, 600000);
        break;
      default:
        break;
    }
    return out;
  }

  /* ── Quick match ────────────────────────────────────────────────────────── */

  dequeue(client) {
    if (!client.queueGame) return;
    const list = this.queues.get(client.queueGame);
    if (list) {
      const i = list.indexOf(client.id);
      if (i !== -1) list.splice(i, 1);
    }
    client.queueGame = null;
  }

  onQueueJoin(client, msg) {
    const game = getGame(msg.gameId);
    if (!game) return this.error(client, '알 수 없는 게임입니다.');
    this.leaveCurrentRoom(client);
    this.dequeue(client);

    const list = this.queues.get(msg.gameId);
    list.push(client.id);
    client.queueGame = msg.gameId;
    this.send(client, S2C.QUEUE, { gameId: msg.gameId, waiting: list.length, queued: true });
    this.tryMatch(msg.gameId);
    this.broadcastLobby();
  }

  onQueueLeave(client) {
    const gameId = client.queueGame;
    this.dequeue(client);
    this.send(client, S2C.QUEUE, { gameId, waiting: 0, queued: false });
    this.broadcastLobby();
  }

  /** Pair the two longest-waiting players for a game. */
  tryMatch(gameId) {
    const list = this.queues.get(gameId);
    while (list.length >= 2) {
      const a = this.clients.get(list.shift());
      const b = this.clients.get(list.shift());
      if (!a || !b) {
        // A queued client vanished; put the survivor back at the front.
        if (a && this.clients.has(a.id)) list.unshift(a.id);
        if (b && this.clients.has(b.id)) list.unshift(b.id);
        continue;
      }
      a.queueGame = null;
      b.queueGame = null;

      const room = new Room({
        name: `빠른 대전 · ${getGame(gameId).meta.name}`,
        gameId,
        hostId: a.id,
      });
      this.rooms.set(room.id, room);
      for (const client of [a, b]) {
        room.join(client);
        client.roomId = room.id;
        this.send(client, S2C.MATCH_FOUND, { roomId: room.id, gameId });
        this.send(client, S2C.ROOM, { room: room.snapshotFor(client.id, (id) => this.nameOf(id)), chat: room.chat });
      }
      this.systemChat(room, '상대를 찾았습니다! 두 분 다 준비를 누르면 시작합니다.');
      this.broadcastRoom(room);
      log.info('quick match', { room: room.id, game: gameId });
    }
    this.broadcastLobby();
  }

  /* ── Gameplay ───────────────────────────────────────────────────────────── */

  onGameMove(client, msg) {
    const room = client.roomId ? this.rooms.get(client.roomId) : null;
    if (!room) return this.error(client, '참여 중인 방이 없습니다.');

    const res = room.move(client.id, msg.move, Date.now());
    if (!res.ok) return this.error(client, res.error);

    if (res.events?.length) {
      for (const memberId of room.members()) {
        this.sendTo(memberId, S2C.GAME_EVENTS, { roomId: room.id, events: res.events });
      }
    }
    this.broadcastRoom(room);
    if (room.phase === 'over') this.onMatchOver(room);
  }

  onGameResign(client) {
    const room = client.roomId ? this.rooms.get(client.roomId) : null;
    if (!room || room.phase !== 'playing') return this.error(client, '진행 중인 게임이 없습니다.');
    const seat = room.seatOf(client.id);
    if (seat === null) return this.error(client, '대국자만 기권할 수 있습니다.');
    room.finish(seat === 0 ? 1 : 0, 'resign');
    this.systemChat(room, `${client.name} 님이 기권했습니다.`);
    this.broadcastRoom(room);
    this.onMatchOver(room);
  }

  /** Fan-out after any match ends, including reporting into a bracket. */
  onMatchOver(room) {
    const result = room.result;
    if (!result) return;
    for (const memberId of room.members()) {
      this.sendTo(memberId, S2C.GAME_OVER, { roomId: room.id, result });
    }
    this.broadcastLobby();

    if (!room.tournamentId || !room.matchRef) return;
    const tourney = this.tournaments.get(room.tournamentId);
    if (!tourney) return;

    const winnerId = result.winner === 0 || result.winner === 1 ? result.seats[result.winner] : null;
    // A drawn bracket match advances the first seat, which the bracket treats
    // as the higher seed. Better a decision than a tournament that never ends.
    const advanceId = winnerId || result.seats[0] || result.seats[1];
    const report = tourney.report(room.matchRef, advanceId);
    if (!report.ok) return;

    this.systemChat(room, `대회 경기 결과가 기록되었습니다: ${this.nameOf(advanceId)} 진출`);
    this.broadcastTournament(tourney);
    if (report.advanced) {
      if (report.finished) this.finishTournament(tourney);
      else setTimeout(() => this.openTournamentRooms(tourney), 4000);
    }
  }

  /* ── Tournaments ────────────────────────────────────────────────────────── */

  onTourneyCreate(client, msg) {
    const game = getGame(msg.gameId);
    if (!game) return this.error(client, '알 수 없는 게임입니다.');
    const size = LIMITS.tournamentSizes.includes(msg.size) ? msg.size : 8;
    if (client.tournamentId) return this.error(client, '이미 참가 중인 대회가 있습니다.');

    const tourney = new Tournament({
      name: sanitizeName(msg.name)?.slice(0, LIMITS.roomNameMax) || `${game.meta.name} 대회`,
      gameId: msg.gameId,
      size,
      hostId: client.id,
      config: this.sanitizeConfig(msg.gameId, msg.config),
    });
    this.tournaments.set(tourney.id, tourney);
    tourney.join(client);
    client.tournamentId = tourney.id;

    this.send(client, S2C.TOURNEY, { tournament: tourney.snapshot((id) => this.nameOf(id)) });
    this.broadcastTournamentList();
    this.broadcastLobby();
    log.info('tournament created', { id: tourney.id, game: tourney.gameId, size });
  }

  onTourneyJoin(client, msg) {
    const tourney = this.tournaments.get(msg.tournamentId);
    if (!tourney) return this.error(client, '대회를 찾을 수 없습니다.');
    if (client.tournamentId && client.tournamentId !== tourney.id) {
      return this.error(client, '이미 다른 대회에 참가 중입니다.');
    }
    const res = tourney.join(client);
    if (!res.ok) return this.error(client, res.error);
    client.tournamentId = tourney.id;
    this.broadcastTournament(tourney);
    this.broadcastTournamentList();
  }

  onTourneyLeave(client) {
    const tourney = client.tournamentId ? this.tournaments.get(client.tournamentId) : null;
    client.tournamentId = null;
    if (!tourney) return;
    const res = tourney.leave(client.id);
    this.send(client, S2C.TOURNEY, { tournament: null });
    if (res.forfeit) {
      const match = tourney.matchForPlayer(client.id);
      if (match) {
        const opponent = match.a === client.id ? match.b : match.a;
        const report = tourney.report(match.id, opponent);
        if (report.advanced && report.finished) this.finishTournament(tourney);
        else if (report.advanced) setTimeout(() => this.openTournamentRooms(tourney), 2000);
      }
    }
    this.broadcastTournament(tourney);
    this.broadcastTournamentList();
  }

  onTourneyStart(client) {
    const tourney = client.tournamentId ? this.tournaments.get(client.tournamentId) : null;
    if (!tourney) return this.error(client, '참가 중인 대회가 없습니다.');
    if (tourney.hostId !== client.id) return this.error(client, '대회 개설자만 시작할 수 있습니다.');
    const res = tourney.start(new Rng(randomSeed()));
    if (!res.ok) return this.error(client, res.error);
    this.broadcastTournament(tourney);
    this.openTournamentRooms(tourney);
    this.broadcastTournamentList();
  }

  onTourneyList(client) {
    this.send(client, S2C.TOURNEY_LIST, {
      tournaments: [...this.tournaments.values()].map((t) => t.summary()),
    });
  }

  /** Create and seat rooms for every unplayed match in the current round. */
  openTournamentRooms(tourney) {
    if (tourney.status !== T_STATUS.RUNNING) return;
    const game = getGame(tourney.gameId);

    for (const match of tourney.pendingMatches()) {
      const a = this.clients.get(match.a);
      const b = this.clients.get(match.b);

      // Someone left between rounds: award the walkover rather than hang.
      if (!a || !b) {
        const survivor = a?.id || b?.id || null;
        const report = tourney.report(match.id, survivor);
        if (report.advanced && report.finished) this.finishTournament(tourney);
        else if (report.advanced) setTimeout(() => this.openTournamentRooms(tourney), 1500);
        continue;
      }

      const room = new Room({
        name: `${tourney.name} · ${tourney.roundLabel()}`,
        gameId: tourney.gameId,
        hostId: a.id,
        isPrivate: true,
        config: tourney.config,
        tournamentId: tourney.id,
        matchRef: match.id,
      });
      this.rooms.set(room.id, room);
      match.roomId = room.id;

      for (const client of [a, b]) {
        this.leaveCurrentRoom(client, { silent: true });
        room.join(client);
        client.roomId = room.id;
        this.send(client, S2C.ROOM, { room: room.snapshotFor(client.id, (id) => this.nameOf(id)), chat: room.chat });
        this.notice(client, `${tourney.roundLabel()} 경기가 배정되었습니다. 준비를 눌러 주세요!`, 'match');
      }
      this.systemChat(room, `${tourney.name} — ${tourney.roundLabel()}: ${a.name} vs ${b.name}`);
      this.broadcastRoom(room);
      log.info('tournament match room', { tourney: tourney.id, room: room.id, match: match.id });
    }
    this.broadcastTournament(tourney);
  }

  finishTournament(tourney) {
    const champion = this.nameOf(tourney.champion);
    for (const player of tourney.players) {
      const client = this.clients.get(player.id);
      if (!client) continue;
      client.tournamentId = null;
      this.notice(client, `🏆 ${tourney.name} 우승: ${champion}`, 'champion');
    }
    this.broadcastTournament(tourney);
    this.broadcastTournamentList();
  }

  broadcastTournament(tourney) {
    const snapshot = tourney.snapshot((id) => this.nameOf(id));
    const audience = new Set(tourney.players.map((p) => p.id));
    if (tourney.hostId) audience.add(tourney.hostId);
    for (const id of audience) this.sendTo(id, S2C.TOURNEY, { tournament: snapshot });
  }

  broadcastTournamentList() {
    const payload = { tournaments: [...this.tournaments.values()].map((t) => t.summary()) };
    for (const client of this.clients.values()) {
      if (client.lobbySub) this.send(client, S2C.TOURNEY_LIST, payload);
    }
    this.broadcastLobby();
  }

  /* ── The clock ──────────────────────────────────────────────────────────── */

  tick() {
    const now = Date.now();

    for (const room of this.rooms.values()) {
      if (room.tick(now)) {
        this.broadcastRoom(room);
        if (room.phase === 'over') this.onMatchOver(room);
      }
    }

    // Housekeeping runs once a second, not 10 times.
    if (now - (this._lastSweep || 0) < 1000) return;
    this._lastSweep = now;

    for (const [id, ghost] of this.ghosts) {
      if (ghost.expiresAt <= now) this.ghosts.delete(id);
    }
    for (const room of [...this.rooms.values()]) {
      const empty = room.members().length === 0;
      const stale = now - (room.endedAt || room.createdAt) > EMPTY_ROOM_TTL_MS;
      if (empty && stale) {
        this.rooms.delete(room.id);
        this.broadcastLobby();
      }
    }
    for (const tourney of [...this.tournaments.values()]) {
      if (tourney.status === T_STATUS.DONE && now - (tourney.endedAt || 0) > FINISHED_TOURNEY_TTL_MS) {
        this.tournaments.delete(tourney.id);
      }
    }
  }

  /** `/healthz` payload. */
  health() {
    return {
      ok: true,
      uptimeMs: Date.now() - this.startedAt,
      online: this.clients.size,
      rooms: this.rooms.size,
      tournaments: this.tournaments.size,
      games: gameIds().length,
      stats: this.stats,
    };
  }
}
