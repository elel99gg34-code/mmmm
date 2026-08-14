/**
 * WebSocket client: connect, resume, reconnect, and keep the clock in sync.
 *
 * The socket is the only thing in the app that talks to the server, and it
 * writes everything it learns straight into the store. Views never see a raw
 * frame.
 */
import { C2S, S2C } from '../../shared/protocol.js';
import { store, setState } from './store.js';
import { loadSession, saveSession, loadProfile } from './config.js';
import { toast } from './ui.js';
import { sound } from './sound.js';

const PING_INTERVAL_MS = 12_000;
const BACKOFF = [800, 1600, 3200, 6000, 10_000];

let socket = null;
let pingTimer = null;
let reconnectTimer = null;
let attempts = 0;
let wanted = false; // did the user ask to be connected?
let targetUrl = '';
const handlers = new Map();

/** Register a handler for a server message type. Returns an unsubscribe fn. */
export function on(type, fn) {
  if (!handlers.has(type)) handlers.set(type, new Set());
  handlers.get(type).add(fn);
  return () => handlers.get(type)?.delete(fn);
}

function emit(type, msg) {
  for (const fn of handlers.get(type) || []) {
    try {
      fn(msg);
    } catch (err) {
      console.error(`handler for ${type} failed`, err);
    }
  }
}

export function isOnline() {
  return socket?.readyState === WebSocket.OPEN && store.connection === 'online';
}

/** Send a frame. Returns false when the socket is not open. */
export function send(type, payload = {}) {
  if (socket?.readyState !== WebSocket.OPEN) return false;
  socket.send(JSON.stringify({ t: type, ...payload }));
  return true;
}

/** Connect (or reconnect) to `url`. Safe to call repeatedly. */
export function connect(url) {
  targetUrl = url || targetUrl;
  if (!targetUrl) return;
  wanted = true;
  clearTimeout(reconnectTimer);

  if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) {
    if (socket.url === targetUrl) return;
    teardown();
  }

  setState({ connection: 'connecting', serverUrl: targetUrl, serverError: '' });

  try {
    socket = new WebSocket(targetUrl);
  } catch (err) {
    setState({ connection: 'error', serverError: '주소가 올바르지 않습니다.' });
    return;
  }

  socket.addEventListener('open', onOpen);
  socket.addEventListener('message', onMessage);
  socket.addEventListener('close', onClose);
  socket.addEventListener('error', () => {
    // `error` never carries a reason in browsers; `close` follows with one.
    if (store.connection === 'connecting') setState({ serverError: '서버에 연결할 수 없습니다.' });
  });
}

/** Disconnect and stop trying to come back. */
export function disconnect() {
  wanted = false;
  clearTimeout(reconnectTimer);
  teardown();
  setState({ connection: 'offline', room: null, tournament: null, queue: null });
}

function teardown() {
  clearInterval(pingTimer);
  pingTimer = null;
  if (!socket) return;
  socket.removeEventListener('open', onOpen);
  socket.removeEventListener('message', onMessage);
  socket.removeEventListener('close', onClose);
  try {
    socket.close();
  } catch {
    /* already closing */
  }
  socket = null;
}

function onOpen() {
  attempts = 0;
  const profile = loadProfile();
  send(C2S.HELLO, { name: profile.name || undefined, avatar: profile.avatar, resume: loadSession() || undefined });
  clearInterval(pingTimer);
  pingTimer = setInterval(ping, PING_INTERVAL_MS);
  ping();
}

function ping() {
  send(C2S.PING, { echo: Date.now() });
}

function onClose(event) {
  teardown();
  if (!wanted) {
    setState({ connection: 'offline' });
    return;
  }

  // 4003 is our own "origin not allowed" — retrying will not help.
  if (event.code === 4003) {
    setState({ connection: 'error', serverError: '이 서버는 현재 페이지의 접속을 허용하지 않습니다.' });
    return;
  }

  const delay = BACKOFF[Math.min(attempts, BACKOFF.length - 1)];
  attempts += 1;
  setState({
    connection: 'connecting',
    serverError: attempts > 1 ? `연결이 끊겼습니다. ${Math.round(delay / 1000)}초 후 다시 시도합니다…` : '',
  });
  reconnectTimer = setTimeout(() => connect(targetUrl), delay);
}

function onMessage(event) {
  let msg;
  try {
    msg = JSON.parse(event.data);
  } catch {
    return;
  }
  route(msg);
  emit(msg.t, msg);
}

function route(msg) {
  switch (msg.t) {
    case S2C.WELCOME: {
      saveSession(msg.id);
      setState({
        connection: 'online',
        serverError: '',
        me: { id: msg.id, name: msg.name, avatar: msg.avatar },
        games: msg.games || store.games,
        avatars: msg.avatars || store.avatars,
        limits: msg.limits || store.limits,
        clockOffset: msg.serverNow - Date.now(),
      });
      send(C2S.LOBBY_SUB);
      if (msg.resumed) toast('이전 게임에 다시 연결했습니다.', 'good');
      break;
    }

    case S2C.PONG: {
      if (typeof msg.echo === 'number') {
        const rtt = Date.now() - msg.echo;
        // Assume the trip is symmetric: the server's "now" was one leg ago.
        setState({ latency: rtt, clockOffset: msg.serverNow + rtt / 2 - Date.now() });
      }
      break;
    }

    case S2C.LOBBY:
      setState({ lobby: msg });
      break;

    case S2C.CHAT: {
      if (msg.scope === 'lobby') {
        if (msg.history) setState({ lobbyChat: msg.history });
        else setState({ lobbyChat: [...store.lobbyChat, msg.message].slice(-80) });
      } else if (msg.scope === 'room') {
        setState({ roomChat: [...store.roomChat, msg.message].slice(-120) });
      }
      break;
    }

    case S2C.ROOM: {
      const previous = store.room;
      if (msg.chat) setState({ roomChat: msg.chat });
      else if (!previous || previous.id !== msg.room.id) setState({ roomChat: [] });
      setState({ room: msg.room, queue: null });
      if (previous?.phase !== 'playing' && msg.room.phase === 'playing') sound.start();
      break;
    }

    case S2C.ROOM_LEFT:
      if (store.room?.id === msg.roomId) setState({ room: null, roomChat: [], lastEvents: null });
      break;

    case S2C.QUEUE:
      setState({ queue: msg.queued ? { gameId: msg.gameId, waiting: msg.waiting } : null });
      break;

    case S2C.MATCH_FOUND:
      sound.notify();
      toast('상대를 찾았습니다!', 'good');
      break;

    case S2C.GAME_EVENTS:
      setState({ lastEvents: { roomId: msg.roomId, events: msg.events, at: Date.now() } });
      break;

    case S2C.GAME_OVER: {
      const seat = store.room?.seat;
      if (seat === 0 || seat === 1) {
        if (msg.result.winner === 'draw') sound.draw();
        else if (msg.result.winner === seat) sound.win();
        else sound.lose();
      }
      break;
    }

    case S2C.TOURNEY:
      setState({ tournament: msg.tournament });
      break;

    case S2C.TOURNEY_LIST:
      setState({ tournamentList: msg.tournaments || [] });
      break;

    case S2C.NOTICE:
      toast(msg.message, msg.kind === 'champion' ? 'good' : msg.kind === 'match' ? 'match' : 'info', 5200);
      sound.notify();
      break;

    case S2C.ERROR:
      toast(msg.message, 'bad');
      break;

    default:
      break;
  }
}

/* ── Convenience wrappers used by the views ───────────────────────────────── */

export const api = {
  setProfile: (name, avatar) => send(C2S.PROFILE, { name, avatar }),
  chat: (text, scope = 'lobby') => send(C2S.CHAT, { text, scope }),

  createRoom: (gameId, options = {}) => send(C2S.ROOM_CREATE, { gameId, ...options }),
  joinRoom: (roomId, options = {}) => send(C2S.ROOM_JOIN, { roomId, ...options }),
  joinByCode: (code) => send(C2S.ROOM_JOIN, { code }),
  leaveRoom: () => send(C2S.ROOM_LEAVE),
  ready: (value) => send(C2S.ROOM_READY, { ready: value }),
  rematch: () => send(C2S.ROOM_REMATCH),
  setRoomConfig: (config) => send(C2S.ROOM_CONFIG, { config }),

  queueJoin: (gameId) => send(C2S.QUEUE_JOIN, { gameId }),
  queueLeave: () => send(C2S.QUEUE_LEAVE),

  move: (move) => send(C2S.GAME_MOVE, { move }),
  resign: () => send(C2S.GAME_RESIGN),

  createTournament: (gameId, options = {}) => send(C2S.TOURNEY_CREATE, { gameId, ...options }),
  joinTournament: (tournamentId) => send(C2S.TOURNEY_JOIN, { tournamentId }),
  leaveTournament: () => send(C2S.TOURNEY_LEAVE),
  startTournament: () => send(C2S.TOURNEY_START),
  listTournaments: () => send(C2S.TOURNEY_LIST),
};
