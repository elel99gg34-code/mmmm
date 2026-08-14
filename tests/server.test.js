/**
 * Hub integration tests.
 *
 * These drive the real `Hub` through fake sockets rather than real
 * WebSockets: the transport is `ws`'s problem, the interesting logic is ours.
 * Every assertion is about what a client is actually told.
 */
import { suite, test, assert, equal, deepEqual } from './harness.js';
import { Hub, GHOST_TTL_MS } from '../server/src/hub.js';
import { DISCONNECT_GRACE_MS } from '../server/src/room.js';
import { C2S, S2C } from '../shared/protocol.js';

/** Minimal stand-in for a WebSocket that records what the server sent. */
class FakeSocket {
  constructor() {
    this.readyState = 1;
    this.sent = [];
  }

  send(raw) {
    this.sent.push(JSON.parse(raw));
  }

  close() {
    this.readyState = 3;
  }

  /** The most recent message of a type, or undefined. */
  last(type) {
    for (let i = this.sent.length - 1; i >= 0; i--) if (this.sent[i].t === type) return this.sent[i];
    return undefined;
  }

  all(type) {
    return this.sent.filter((m) => m.t === type);
  }

  clear() {
    this.sent = [];
  }
}

/**
 * Connect a client and complete the handshake, including the lobby
 * subscription the real client sends the moment it is welcomed.
 */
function join(hub, name, extra = {}) {
  const socket = new FakeSocket();
  const client = hub.addConnection(socket, { ip: '127.0.0.1' });
  hub.handle(client, JSON.stringify({ t: C2S.HELLO, name, ...extra }));
  hub.handle(client, JSON.stringify({ t: C2S.LOBBY_SUB }));
  return { socket, client };
}

function say(hub, peer, type, payload = {}) {
  hub.handle(peer.client, JSON.stringify({ t: type, ...payload }));
}

/** Spin up a hub, run `fn`, always shut the hub's timer down. */
function withHub(fn) {
  const hub = new Hub();
  try {
    fn(hub);
  } finally {
    hub.stop();
  }
}

/** Seat two players in a room for `gameId` and start the match. */
function startMatch(hub, gameId = 'gomoku') {
  const a = join(hub, '가람');
  const b = join(hub, '나린');
  say(hub, a, C2S.ROOM_CREATE, { gameId });
  const roomId = a.socket.last(S2C.ROOM).room.id;
  say(hub, b, C2S.ROOM_JOIN, { roomId });
  say(hub, a, C2S.ROOM_READY, { ready: true });
  say(hub, b, C2S.ROOM_READY, { ready: true });
  return { a, b, room: hub.rooms.get(roomId) };
}

/* ── Handshake ────────────────────────────────────────────────────────────── */

suite('server: handshake');

test('hello returns the catalogue, limits and an id', () => {
  withHub((hub) => {
    const { socket } = join(hub, '가람');
    const welcome = socket.last(S2C.WELCOME);
    assert(welcome, 'no welcome sent');
    equal(welcome.name, '가람');
    equal(welcome.games.length, 15);
    assert(welcome.id && welcome.id.length >= 6);
    assert(welcome.limits && welcome.avatars.length > 0);
    assert(typeof welcome.serverNow === 'number');
  });
});

test('a nameless client still gets a usable guest name', () => {
  withHub((hub) => {
    const { socket } = join(hub, '');
    const welcome = socket.last(S2C.WELCOME);
    assert(welcome.name && welcome.name.length >= 1, `bad guest name ${welcome.name}`);
  });
});

test('messages before hello are refused', () => {
  withHub((hub) => {
    const socket = new FakeSocket();
    const client = hub.addConnection(socket, {});
    hub.handle(client, JSON.stringify({ t: C2S.ROOM_CREATE, gameId: 'gomoku' }));
    assert(socket.last(S2C.ERROR), 'should have been told to say hello first');
    equal(hub.rooms.size, 0);
  });
});

test('malformed frames produce an error, not a crash', () => {
  withHub((hub) => {
    const peer = join(hub, '가람');
    hub.handle(peer.client, 'not json at all');
    hub.handle(peer.client, JSON.stringify({ nope: true }));
    hub.handle(peer.client, JSON.stringify({ t: 'made.up.type' }));
    equal(peer.socket.all(S2C.ERROR).length, 3);
  });
});

test('a flood of messages is rate limited', () => {
  withHub((hub) => {
    const peer = join(hub, '가람');
    peer.socket.clear();
    for (let i = 0; i < 200; i++) say(hub, peer, C2S.PING, { echo: i });
    const errors = peer.socket.all(S2C.ERROR);
    assert(errors.length > 0, 'the limiter never kicked in');
    assert(peer.socket.all(S2C.PONG).length < 200, 'every ping was answered despite the limiter');
  });
});

/* ── Rooms ────────────────────────────────────────────────────────────────── */

suite('server: rooms');

test('creating a room seats the creator and lists it in the lobby', () => {
  withHub((hub) => {
    const peer = join(hub, '가람');
    say(hub, peer, C2S.ROOM_CREATE, { gameId: 'connect4', name: '테스트방' });
    const room = peer.socket.last(S2C.ROOM).room;
    equal(room.gameId, 'connect4');
    equal(room.seat, 0);
    equal(room.role, 'player');
    equal(room.phase, 'waiting');
    equal(hub.lobbyState().rooms.length, 1);
  });
});

test('a second player takes seat 1 and both readying starts the match', () => {
  withHub((hub) => {
    const { a, b, room } = startMatch(hub, 'gomoku');
    equal(room.phase, 'playing');
    equal(a.socket.last(S2C.ROOM).room.seat, 0);
    equal(b.socket.last(S2C.ROOM).room.seat, 1);
    assert(a.socket.last(S2C.ROOM).room.state, 'no game state delivered');
  });
});

test('a third player joins as a spectator', () => {
  withHub((hub) => {
    const { room } = startMatch(hub, 'gomoku');
    const c = join(hub, '다솜');
    say(hub, c, C2S.ROOM_JOIN, { roomId: room.id });
    equal(c.socket.last(S2C.ROOM).room.role, 'spectator');
    equal(c.socket.last(S2C.ROOM).room.seat, null);
    equal(room.spectators.size, 1);
  });
});

test('a private room is hidden from the lobby but joinable by code', () => {
  withHub((hub) => {
    const a = join(hub, '가람');
    say(hub, a, C2S.ROOM_CREATE, { gameId: 'gomoku', isPrivate: true });
    const room = a.socket.last(S2C.ROOM).room;
    assert(room.code && room.code.length === 4, `bad code ${room.code}`);
    equal(hub.lobbyState().rooms.length, 0, 'private room leaked into the lobby');

    const b = join(hub, '나린');
    say(hub, b, C2S.ROOM_JOIN, { code: room.code.toLowerCase() });
    equal(b.socket.last(S2C.ROOM).room.id, room.id);
  });
});

test('moves are refereed: out of turn and occupied points are refused', () => {
  withHub((hub) => {
    const { a, b, room } = startMatch(hub, 'gomoku');
    b.socket.clear();
    say(hub, b, C2S.GAME_MOVE, { move: 112 }); // seat 1 moving first
    assert(b.socket.last(S2C.ERROR), 'out-of-turn move was accepted');

    say(hub, a, C2S.GAME_MOVE, { move: 112 });
    equal(room.state.board[112], 1);

    b.socket.clear();
    say(hub, b, C2S.GAME_MOVE, { move: 112 }); // occupied
    assert(b.socket.last(S2C.ERROR), 'stacking a stone was accepted');
  });
});

test('a spectator cannot move', () => {
  withHub((hub) => {
    const { room } = startMatch(hub, 'gomoku');
    const c = join(hub, '다솜');
    say(hub, c, C2S.ROOM_JOIN, { roomId: room.id });
    c.socket.clear();
    say(hub, c, C2S.GAME_MOVE, { move: 40 });
    assert(c.socket.last(S2C.ERROR), 'a spectator moved');
    equal(room.state.board[40], 0);
  });
});

test('resigning ends the match and tells both players', () => {
  withHub((hub) => {
    const { a, b, room } = startMatch(hub, 'gomoku');
    say(hub, a, C2S.GAME_RESIGN);
    equal(room.phase, 'over');
    equal(room.result.winner, 1);
    equal(room.result.reason, 'resign');
    assert(a.socket.last(S2C.GAME_OVER), 'resigner was not told');
    assert(b.socket.last(S2C.GAME_OVER), 'opponent was not told');
  });
});

test('both voting for a rematch restarts the board', () => {
  withHub((hub) => {
    const { a, b, room } = startMatch(hub, 'gomoku');
    say(hub, a, C2S.GAME_MOVE, { move: 112 });
    say(hub, a, C2S.GAME_RESIGN);
    equal(room.phase, 'over');

    say(hub, a, C2S.ROOM_REMATCH);
    equal(room.phase, 'over', 'one vote should not be enough');
    say(hub, b, C2S.ROOM_REMATCH);
    equal(room.phase, 'playing');
    equal(room.state.board.filter(Boolean).length, 0, 'the new board is not empty');
  });
});

test('leaving mid-match forfeits and frees the room', () => {
  withHub((hub) => {
    const { a, room } = startMatch(hub, 'gomoku');
    say(hub, a, C2S.ROOM_LEAVE);
    equal(room.phase, 'over');
    equal(room.result.winner, 1);
    equal(room.seatOf(a.client.id), null);
  });
});

test('room config is clamped to the values we intend to expose', () => {
  withHub((hub) => {
    const a = join(hub, '가람');
    say(hub, a, C2S.ROOM_CREATE, {
      gameId: 'quiz',
      config: { count: 9999, perQuestion: 1, categories: ['상식'], evil: true, maxDifficulty: 99 },
    });
    const room = hub.rooms.get(a.socket.last(S2C.ROOM).room.id);
    equal(room.config.count, 20, 'question count was not clamped');
    equal(room.config.perQuestion, 5000, 'question timer was not clamped');
    equal(room.config.maxDifficulty, 3);
    deepEqual(room.config.categories, ['상식']);
    equal(room.config.evil, undefined, 'an unknown config key was accepted');
  });
});

/* ── Information hiding ───────────────────────────────────────────────────── */

suite('server: information hiding');

test('a battleship opponent fleet never reaches the other client', () => {
  withHub((hub) => {
    const { a, b, room } = startMatch(hub, 'battleship');
    // Deliberately different layouts, so a coordinate found in A's payload
    // could only have come from B's fleet.
    const rowLayout = [
      { id: 'carrier', r: 0, c: 0, dir: 'h' },
      { id: 'battleship', r: 2, c: 0, dir: 'h' },
      { id: 'cruiser', r: 4, c: 0, dir: 'h' },
      { id: 'submarine', r: 6, c: 0, dir: 'h' },
      { id: 'destroyer', r: 8, c: 0, dir: 'h' },
    ];
    const columnLayout = [
      { id: 'carrier', r: 3, c: 9, dir: 'v' },
      { id: 'battleship', r: 4, c: 7, dir: 'v' },
      { id: 'cruiser', r: 5, c: 5, dir: 'v' },
      { id: 'submarine', r: 1, c: 3, dir: 'v' },
      { id: 'destroyer', r: 7, c: 1, dir: 'v' },
    ];
    say(hub, a, C2S.GAME_MOVE, { move: { type: 'place', placements: rowLayout } });
    say(hub, b, C2S.GAME_MOVE, { move: { type: 'place', placements: columnLayout } });
    equal(room.phase, 'playing');

    const seenByA = a.socket.last(S2C.ROOM).room.state;
    equal(seenByA.fleets[0].cells.filter(Boolean).length, 17, 'own fleet should be visible');
    equal(seenByA.fleets[1].cells.filter(Boolean).length, 0, 'opponent fleet leaked');
    equal(seenByA.fleets[1].ships.length, 0, 'opponent ship list leaked');

    // Nothing in any frame ever sent to A should name a square of B's fleet.
    const raw = JSON.stringify(a.socket.all(S2C.ROOM));
    const bCells = JSON.stringify(room.state.fleets[1].ships[0].cells);
    equal(raw.includes(bCells), false, 'opponent ship coordinates leaked');
  });
});

test('a spectator sees neither fleet', () => {
  withHub((hub) => {
    const { a, b, room } = startMatch(hub, 'battleship');
    const placements = [
      { id: 'carrier', r: 0, c: 0, dir: 'h' },
      { id: 'battleship', r: 2, c: 0, dir: 'h' },
      { id: 'cruiser', r: 4, c: 0, dir: 'h' },
      { id: 'submarine', r: 6, c: 0, dir: 'h' },
      { id: 'destroyer', r: 8, c: 0, dir: 'h' },
    ];
    say(hub, a, C2S.GAME_MOVE, { move: { type: 'place', placements } });
    say(hub, b, C2S.GAME_MOVE, { move: { type: 'place', placements } });

    const c = join(hub, '다솜');
    say(hub, c, C2S.ROOM_JOIN, { roomId: room.id });
    const seen = c.socket.last(S2C.ROOM).room.state;
    equal(seen.fleets[0].cells.filter(Boolean).length, 0, 'spectator saw seat 0 fleet');
    equal(seen.fleets[1].cells.filter(Boolean).length, 0, 'spectator saw seat 1 fleet');
  });
});

test('the quiz answer key is not sent while the question is open', () => {
  withHub((hub) => {
    const { a, room } = startMatch(hub, 'quiz');
    const seen = a.socket.last(S2C.ROOM).room.state;
    equal(seen.questions[0].c, -1, 'answer key leaked');
    equal(seen.questions[1].q, '', 'an unasked question leaked');
    assert(room.state.questions[0].c >= 0, 'the server should still know the answer');
  });
});

/* ── Quick match ──────────────────────────────────────────────────────────── */

suite('server: quick match');

test('two queued players are paired into a room', () => {
  withHub((hub) => {
    const a = join(hub, '가람');
    const b = join(hub, '나린');
    say(hub, a, C2S.QUEUE_JOIN, { gameId: 'reversi' });
    equal(hub.rooms.size, 0, 'paired with nobody');
    say(hub, b, C2S.QUEUE_JOIN, { gameId: 'reversi' });

    equal(hub.rooms.size, 1);
    assert(a.socket.last(S2C.MATCH_FOUND), 'A was not told');
    assert(b.socket.last(S2C.MATCH_FOUND), 'B was not told');
    const room = hub.rooms.get(a.socket.last(S2C.MATCH_FOUND).roomId);
    equal(room.playerCount, 2);
  });
});

test('leaving the queue removes you from it', () => {
  withHub((hub) => {
    const a = join(hub, '가람');
    say(hub, a, C2S.QUEUE_JOIN, { gameId: 'reversi' });
    equal(hub.queues.get('reversi').length, 1);
    say(hub, a, C2S.QUEUE_LEAVE);
    equal(hub.queues.get('reversi').length, 0);
  });
});

test('a queued player who disconnects is not matched', () => {
  withHub((hub) => {
    const a = join(hub, '가람');
    const b = join(hub, '나린');
    say(hub, a, C2S.QUEUE_JOIN, { gameId: 'reversi' });
    hub.removeConnection(a.client);
    say(hub, b, C2S.QUEUE_JOIN, { gameId: 'reversi' });
    equal(hub.rooms.size, 0, 'matched against a ghost');
    equal(hub.queues.get('reversi').length, 1, 'B should still be waiting');
  });
});

/* ── Disconnect and resume ────────────────────────────────────────────────── */

suite('server: disconnect handling');

test('dropping mid-match holds the seat and reconnecting resumes it', () => {
  withHub((hub) => {
    const { a, room } = startMatch(hub, 'gomoku');
    say(hub, a, C2S.GAME_MOVE, { move: 112 });
    const id = a.client.id;

    hub.removeConnection(a.client);
    equal(room.phase, 'playing', 'the match should not end immediately');
    equal(room.seats[0], id, 'the seat was released too early');
    assert(hub.ghosts.has(id), 'no resume token was kept');

    const back = join(hub, '가람', { resume: id });
    equal(back.client.id, id, 'the client did not get its identity back');
    equal(back.socket.last(S2C.WELCOME).resumed, true);
    const room2 = back.socket.last(S2C.ROOM).room;
    equal(room2.seat, 0);
    equal(room2.state.board[112], 1, 'the position was lost');
  });
});

test('a seat left empty past the grace period forfeits', () => {
  withHub((hub) => {
    const { a, room } = startMatch(hub, 'gomoku');
    hub.removeConnection(a.client);
    equal(room.phase, 'playing');

    // Pretend the grace period has elapsed.
    room.absentSince[0] = Date.now() - DISCONNECT_GRACE_MS - 1;
    room.tick(Date.now());
    equal(room.phase, 'over');
    equal(room.result.winner, 1);
    equal(room.result.reason, 'disconnect');
  });
});

test('an expired resume token is not honoured', () => {
  withHub((hub) => {
    const { a } = startMatch(hub, 'gomoku');
    const id = a.client.id;
    hub.removeConnection(a.client);
    hub.ghosts.get(id).expiresAt = Date.now() - 1;

    const back = join(hub, '가람', { resume: id });
    assert(back.client.id !== id, 'an expired token was accepted');
    equal(back.socket.last(S2C.WELCOME).resumed, false);
  });
});

test('a resume token cannot be stolen while its owner is still connected', () => {
  withHub((hub) => {
    const a = join(hub, '가람');
    const attacker = join(hub, '침입자', { resume: a.client.id });
    assert(attacker.client.id !== a.client.id, 'a live session was hijacked');
    assert(hub.clients.has(a.client.id), 'the original client was evicted');
  });
});

test('ghosts are swept once they expire', () => {
  withHub((hub) => {
    const { a } = startMatch(hub, 'gomoku');
    hub.removeConnection(a.client);
    hub.ghosts.get(a.client.id).expiresAt = Date.now() - 1;
    hub._lastSweep = 0;
    hub.tick();
    equal(hub.ghosts.size, 0);
    assert(GHOST_TTL_MS > 0);
  });
});

/* ── Chat ─────────────────────────────────────────────────────────────────── */

suite('server: chat');

test('lobby chat reaches every subscriber', () => {
  withHub((hub) => {
    const a = join(hub, '가람');
    const b = join(hub, '나린');
    b.socket.clear();
    say(hub, a, C2S.CHAT, { text: '안녕하세요', scope: 'lobby' });
    const received = b.socket.last(S2C.CHAT);
    equal(received.message.text, '안녕하세요');
    equal(received.message.name, '가람');
  });
});

test('room chat stays inside the room', () => {
  withHub((hub) => {
    const { a, b } = startMatch(hub, 'gomoku');
    const outsider = join(hub, '다솜');
    outsider.socket.clear();
    b.socket.clear();
    say(hub, a, C2S.CHAT, { text: '잘 부탁해요', scope: 'room' });
    equal(b.socket.last(S2C.CHAT).message.text, '잘 부탁해요');
    equal(outsider.socket.last(S2C.CHAT), undefined, 'room chat leaked to the lobby');
  });
});

test('empty and control-character-only chat is dropped', () => {
  withHub((hub) => {
    const a = join(hub, '가람');
    const b = join(hub, '나린');
    b.socket.clear();
    say(hub, a, C2S.CHAT, { text: '   ', scope: 'lobby' });
    say(hub, a, C2S.CHAT, { text: ' ‮', scope: 'lobby' });
    equal(b.socket.all(S2C.CHAT).length, 0);
  });
});

/* ── Tournaments ──────────────────────────────────────────────────────────── */

suite('server: tournaments');

test('a tournament pairs its players and opens a room per match', () => {
  withHub((hub) => {
    const peers = ['가람', '나린', '다솜', '라온'].map((name) => join(hub, name));
    say(hub, peers[0], C2S.TOURNEY_CREATE, { gameId: 'quiz', size: 4, name: '테스트 대회' });
    const id = peers[0].socket.last(S2C.TOURNEY).tournament.id;
    for (const peer of peers.slice(1)) say(hub, peer, C2S.TOURNEY_JOIN, { tournamentId: id });

    const tourney = hub.tournaments.get(id);
    equal(tourney.players.length, 4);

    say(hub, peers[0], C2S.TOURNEY_START);
    equal(tourney.status, 'running');
    equal(tourney.currentMatches().length, 2);
    equal(hub.rooms.size, 2, 'a room should exist per live match');
    for (const peer of peers) assert(peer.client.roomId, `${peer.client.name} was not seated`);
  });
});

test('only the host can start, and not with one player', () => {
  withHub((hub) => {
    const a = join(hub, '가람');
    const b = join(hub, '나린');
    say(hub, a, C2S.TOURNEY_CREATE, { gameId: 'quiz', size: 4 });
    const id = a.socket.last(S2C.TOURNEY).tournament.id;

    a.socket.clear();
    say(hub, a, C2S.TOURNEY_START);
    assert(a.socket.last(S2C.ERROR), 'started with a single player');

    say(hub, b, C2S.TOURNEY_JOIN, { tournamentId: id });
    b.socket.clear();
    say(hub, b, C2S.TOURNEY_START);
    assert(b.socket.last(S2C.ERROR), 'a non-host started the tournament');
    equal(hub.tournaments.get(id).status, 'lobby');
  });
});

test('an odd field gets a bye and the bracket still resolves', () => {
  withHub((hub) => {
    const peers = ['가람', '나린', '다솜'].map((name) => join(hub, name));
    say(hub, peers[0], C2S.TOURNEY_CREATE, { gameId: 'gomoku', size: 4 });
    const id = peers[0].socket.last(S2C.TOURNEY).tournament.id;
    for (const peer of peers.slice(1)) say(hub, peer, C2S.TOURNEY_JOIN, { tournamentId: id });
    say(hub, peers[0], C2S.TOURNEY_START);

    const tourney = hub.tournaments.get(id);
    const byes = tourney.currentMatches().filter((m) => m.bye);
    equal(byes.length, 1, 'a three-player bracket needs exactly one bye');
    assert(byes[0].winner, 'the bye did not advance anyone');
  });
});

test('a finished match reports into the bracket', () => {
  withHub((hub) => {
    const peers = ['가람', '나린'].map((name) => join(hub, name));
    say(hub, peers[0], C2S.TOURNEY_CREATE, { gameId: 'gomoku', size: 4 });
    const id = peers[0].socket.last(S2C.TOURNEY).tournament.id;
    say(hub, peers[1], C2S.TOURNEY_JOIN, { tournamentId: id });
    say(hub, peers[0], C2S.TOURNEY_START);

    const tourney = hub.tournaments.get(id);
    const room = [...hub.rooms.values()].find((r) => r.tournamentId === id);
    assert(room, 'no match room was created');

    say(hub, peers[0], C2S.ROOM_READY, { ready: true });
    say(hub, peers[1], C2S.ROOM_READY, { ready: true });
    equal(room.phase, 'playing');

    const loser = room.seats[1] === peers[1].client.id ? peers[1] : peers[0];
    say(hub, loser, C2S.GAME_RESIGN);

    equal(tourney.status, 'done', 'a two-player bracket ends after one match');
    assert(tourney.champion && tourney.champion !== loser.client.id, 'the wrong player advanced');
  });
});

test('walking out mid-tournament forfeits instead of stalling the bracket', () => {
  withHub((hub) => {
    const peers = ['가람', '나린'].map((name) => join(hub, name));
    say(hub, peers[0], C2S.TOURNEY_CREATE, { gameId: 'gomoku', size: 4 });
    const id = peers[0].socket.last(S2C.TOURNEY).tournament.id;
    say(hub, peers[1], C2S.TOURNEY_JOIN, { tournamentId: id });
    say(hub, peers[0], C2S.TOURNEY_START);

    say(hub, peers[1], C2S.TOURNEY_LEAVE);
    const tourney = hub.tournaments.get(id);
    equal(tourney.status, 'done');
    equal(tourney.champion, peers[0].client.id);
  });
});

/* ── Housekeeping ─────────────────────────────────────────────────────────── */

suite('server: housekeeping');

test('health reports something a probe can use', () => {
  withHub((hub) => {
    join(hub, '가람');
    const health = hub.health();
    equal(health.ok, true);
    equal(health.games, 15);
    equal(health.online, 1);
    assert(typeof health.uptimeMs === 'number');
  });
});

test('an empty stale room is swept', () => {
  withHub((hub) => {
    const a = join(hub, '가람');
    say(hub, a, C2S.ROOM_CREATE, { gameId: 'gomoku' });
    const room = hub.rooms.get(a.socket.last(S2C.ROOM).room.id);
    say(hub, a, C2S.ROOM_LEAVE);

    room.createdAt = Date.now() - 10 * 60_000;
    hub._lastSweep = 0;
    hub.tick();
    equal(hub.rooms.size, 0);
  });
});

test('disconnecting cleans the client out of every index', () => {
  withHub((hub) => {
    const a = join(hub, '가람');
    say(hub, a, C2S.QUEUE_JOIN, { gameId: 'gomoku' });
    hub.removeConnection(a.client);
    equal(hub.clients.size, 0);
    equal(hub.queues.get('gomoku').length, 0);
    equal(hub.lobbyState().online, 0);
  });
});
