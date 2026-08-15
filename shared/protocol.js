/**
 * The wire protocol, shared verbatim by the server and the browser client.
 *
 * Every frame is JSON: `{ t: <type>, ...payload }`. Types are namespaced by
 * area so a glance at a log line tells you which subsystem owns it.
 */

export const PROTOCOL_VERSION = 1;

/** Client -> server. */
export const C2S = {
  HELLO: 'hello',
  PING: 'ping',
  PROFILE: 'profile',

  AUTH_REGISTER: 'auth.register',
  AUTH_LOGIN: 'auth.login',
  AUTH_LOGOUT: 'auth.logout',
  AUTH_PASSWORD: 'auth.password',
  PROFILE_GET: 'profile.get',
  LEADERBOARD: 'leaderboard.get',

  LOBBY_SUB: 'lobby.subscribe',
  LOBBY_UNSUB: 'lobby.unsubscribe',
  CHAT: 'chat.send',

  ROOM_CREATE: 'room.create',
  ROOM_JOIN: 'room.join',
  ROOM_LEAVE: 'room.leave',
  ROOM_READY: 'room.ready',
  ROOM_REMATCH: 'room.rematch',
  ROOM_CONFIG: 'room.config',
  ROOM_KICK: 'room.kick',

  QUEUE_JOIN: 'queue.join',
  QUEUE_LEAVE: 'queue.leave',

  GAME_MOVE: 'game.move',
  GAME_RESIGN: 'game.resign',

  TOURNEY_CREATE: 'tourney.create',
  TOURNEY_JOIN: 'tourney.join',
  TOURNEY_LEAVE: 'tourney.leave',
  TOURNEY_START: 'tourney.start',
  TOURNEY_LIST: 'tourney.list',
};

/** Server -> client. */
export const S2C = {
  WELCOME: 'welcome',
  PONG: 'pong',
  ERROR: 'error',
  NOTICE: 'notice',

  AUTH: 'auth.state',
  AUTH_ERROR: 'auth.error',
  PROFILE: 'profile.data',
  LEADERBOARD: 'leaderboard.data',

  LOBBY: 'lobby.state',
  CHAT: 'chat.msg',
  PRESENCE: 'presence',

  ROOM: 'room.state',
  ROOM_LEFT: 'room.left',

  QUEUE: 'queue.state',
  MATCH_FOUND: 'match.found',

  GAME: 'game.state',
  GAME_EVENTS: 'game.events',
  GAME_OVER: 'game.over',

  TOURNEY: 'tourney.state',
  TOURNEY_LIST: 'tourney.list',
};

/** Limits enforced on the server and mirrored in the UI. */
export const LIMITS = {
  nameMin: 1,
  nameMax: 16,
  chatMax: 300,
  roomNameMax: 32,
  maxRoomsPerClient: 1,
  maxSpectators: 30,
  tournamentSizes: [4, 8, 16],
  usernameMin: 2,
  usernameMax: 16,
  passwordMin: 6,
};

/** Same rule the server enforces, so the form can complain before sending. */
export const USERNAME_PATTERN = /^[\p{L}\p{N}_-]+$/u;

/** Client-side mirror of the server's username check. Returns an error or null. */
export function checkUsername(raw) {
  const name = String(raw ?? '').trim();
  if (name.length < LIMITS.usernameMin) return `아이디는 ${LIMITS.usernameMin}자 이상이어야 합니다.`;
  if (name.length > LIMITS.usernameMax) return `아이디는 ${LIMITS.usernameMax}자 이하여야 합니다.`;
  if (!USERNAME_PATTERN.test(name)) return '아이디에는 한글·영문·숫자·밑줄·하이픈만 쓸 수 있습니다.';
  return null;
}

/** Client-side mirror of the server's password check. */
export function checkPassword(raw) {
  const password = String(raw ?? '');
  if (password.length < LIMITS.passwordMin) return `비밀번호는 ${LIMITS.passwordMin}자 이상이어야 합니다.`;
  return null;
}

/** Avatars a player can pick. Index is what travels on the wire. */
export const AVATARS = ['🦊', '🐼', '🐧', '🐙', '🦁', '🐸', '🦉', '🐯', '🐨', '🦈', '🐺', '🦄', '🐳', '🦅', '🐝', '🐢'];

/** Reasons a match can end, for consistent copy on both ends. */
export const END_REASONS = {
  normal: '정상 종료',
  resign: '기권',
  disconnect: '상대 연결 끊김',
  timeout: '시간 초과',
  abandoned: '중단됨',
};

// Control characters plus the bidi overrides that would let a name redraw the
// text around it.
const CONTROL_CHARS = /[\u0000-\u001f\u007f\u200b-\u200f\u2028\u2029\u202a-\u202e\ufeff]/g;

/** Trim and clamp a display name; returns null when unusable. */
export function sanitizeName(raw) {
  if (typeof raw !== 'string') return null;
  const name = raw.replace(CONTROL_CHARS, '').trim().slice(0, LIMITS.nameMax);
  return name.length >= LIMITS.nameMin ? name : null;
}

/** Trim and clamp a chat line; returns null when there is nothing to send. */
export function sanitizeChat(raw) {
  if (typeof raw !== 'string') return null;
  const text = raw.replace(CONTROL_CHARS, ' ').trim().slice(0, LIMITS.chatMax);
  return text.length ? text : null;
}

/** A random guest name, used when someone joins without setting one. */
export function guestName(n) {
  const words = ['별빛', '바람', '파랑', '노을', '구름', '달빛', '산들', '초록', '햇살', '새벽', '은하', '단풍'];
  return `${words[n % words.length]}${100 + (n % 900)}`;
}
