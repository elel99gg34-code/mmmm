/**
 * The client's single source of truth, plus a ~30 line pub/sub.
 *
 * Views subscribe to the keys they care about and re-render when those change.
 * No framework, no virtual DOM — the app is small enough that "recompute this
 * panel when this key changes" is the whole architecture.
 */

const listeners = new Map(); // key -> Set<fn>

export const store = {
  /* Connection */
  connection: 'offline', // offline | connecting | online | error
  serverUrl: '',
  serverError: '',
  clockOffset: 0, // serverNow - clientNow, in milliseconds
  latency: 0,

  /* Identity */
  me: null, // { id, name, avatar }
  avatars: [],
  limits: null,

  /* Account (null while playing as a guest) */
  user: null, // { id, username, avatar, stats, authenticated }
  accountsEnabled: false,
  authError: '',
  leaderboard: [],
  viewedProfile: null,

  /* Catalogue */
  games: [],

  /* Lobby */
  lobby: { rooms: [], players: [], online: 0, queues: {}, tournaments: [] },
  lobbyChat: [],

  /* Current room */
  room: null,
  roomChat: [],
  lastEvents: null,

  /* Queue + tournament */
  queue: null, // { gameId, waiting }
  tournament: null,
  tournamentList: [],

  /* Local (offline) match */
  local: null,
};

/** Subscribe to one or more keys. Returns an unsubscribe function. */
export function subscribe(keys, fn) {
  const list = Array.isArray(keys) ? keys : [keys];
  for (const key of list) {
    if (!listeners.has(key)) listeners.set(key, new Set());
    listeners.get(key).add(fn);
  }
  return () => {
    for (const key of list) listeners.get(key)?.delete(fn);
  };
}

/** Merge a patch into the store and notify anyone watching the changed keys. */
export function setState(patch) {
  const changed = [];
  for (const [key, value] of Object.entries(patch)) {
    if (store[key] === value) continue;
    store[key] = value;
    changed.push(key);
  }
  if (!changed.length) return;
  const seen = new Set();
  for (const key of changed) {
    for (const fn of listeners.get(key) || []) {
      if (seen.has(fn)) continue; // one notification per listener per batch
      seen.add(fn);
      try {
        fn(store, changed);
      } catch (err) {
        console.error('store listener failed', err);
      }
    }
  }
}

/** Force a notification for a key whose contents mutated in place. */
export function touch(key) {
  for (const fn of listeners.get(key) || []) {
    try {
      fn(store, [key]);
    } catch (err) {
      console.error('store listener failed', err);
    }
  }
}

/**
 * The server's clock, estimated from the last ping. Every timed game reads
 * this instead of `Date.now()`, so a player whose laptop clock is four minutes
 * fast does not see a permanently expired timer.
 */
export function serverNow() {
  return Date.now() + store.clockOffset;
}
