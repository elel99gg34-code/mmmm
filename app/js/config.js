/**
 * Where the client should look for a PlayHub server.
 *
 * Three sources, in priority order:
 *   1. `?server=wss://…` in the URL — handy for sharing a one-off server.
 *   2. Whatever the player last typed, remembered in localStorage.
 *   3. The same origin as this page, if a PlayHub server answers there.
 *
 * On GitHub Pages the third source does not exist, so the client asks once and
 * then remembers. If you fork this repo and run your own server, set
 * DEFAULT_SERVER below and everyone who opens your Pages site connects to it
 * with no setup at all.
 */

/** Set this to e.g. 'wss://playhub.example.com/ws' to ship a default server. */
export const DEFAULT_SERVER = '';

const STORAGE_KEY = 'playhub.server';
const PROFILE_KEY = 'playhub.profile';
const THEME_KEY = 'playhub.theme';
const SESSION_KEY = 'playhub.session';

function safeStorage() {
  try {
    const probe = '__playhub__';
    window.localStorage.setItem(probe, '1');
    window.localStorage.removeItem(probe);
    return window.localStorage;
  } catch {
    // Private mode, or storage disabled — fall back to an in-memory shim.
    const map = new Map();
    return {
      getItem: (k) => (map.has(k) ? map.get(k) : null),
      setItem: (k, v) => map.set(k, String(v)),
      removeItem: (k) => map.delete(k),
    };
  }
}

export const storage = safeStorage();

/** Normalise anything a human might type into a `ws://` or `wss://` URL. */
export function normalizeServerUrl(input) {
  const raw = String(input || '').trim();
  if (!raw) return '';
  let url = raw;
  if (!/^wss?:\/\//i.test(url)) {
    if (/^https:\/\//i.test(url)) url = url.replace(/^https:/i, 'wss:');
    else if (/^http:\/\//i.test(url)) url = url.replace(/^http:/i, 'ws:');
    else url = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${url.replace(/^\/+/, '')}`;
  }
  try {
    const parsed = new URL(url);
    if (parsed.pathname === '/' || parsed.pathname === '') parsed.pathname = '/ws';
    return parsed.toString().replace(/\/$/, '');
  } catch {
    return '';
  }
}

/** The WebSocket URL for the origin serving this page. */
export function sameOriginServer() {
  if (!location.origin || location.origin === 'null') return '';
  const scheme = location.protocol === 'https:' ? 'wss' : 'ws';
  return `${scheme}://${location.host}/ws`;
}

const PROBE_KEY = 'playhub.sameorigin';
/**
 * How long to trust "there is no server here".
 *
 * On a static host (GitHub Pages) the probe 404s, and a 404 prints a console
 * error no matter how carefully it is caught. Remembering the answer keeps
 * that to once an hour per browser instead of once per page load. The value is
 * stored in localStorage, which is already per-origin, so a cached "no" for
 * a Pages site never suppresses the probe on localhost.
 */
const PROBE_TTL_MS = 60 * 60 * 1000;

/**
 * True when a PlayHub server is answering at this page's own origin.
 * Pass `{ fresh: true }` to ignore the cache — used by the connect dialog, so
 * someone who just started a local server can find it without waiting an hour.
 */
export async function probeSameOrigin({ timeoutMs = 2500, fresh = false } = {}) {
  if (!location.origin || location.origin === 'null' || location.protocol === 'file:') return false;

  if (!fresh) {
    try {
      const cached = JSON.parse(storage.getItem(PROBE_KEY) || 'null');
      if (cached && Date.now() - cached.at < PROBE_TTL_MS) return cached.ok;
    } catch {
      /* corrupt entry — fall through and probe */
    }
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let ok = false;
  try {
    const res = await fetch('./healthz', { signal: controller.signal, cache: 'no-store' });
    if (res.ok) {
      const body = await res.json();
      ok = Boolean(body && body.ok === true && typeof body.games === 'number');
    }
  } catch {
    ok = false;
  } finally {
    clearTimeout(timer);
  }
  storage.setItem(PROBE_KEY, JSON.stringify({ ok, at: Date.now() }));
  return ok;
}

export function savedServer() {
  return storage.getItem(STORAGE_KEY) || '';
}

export function saveServer(url) {
  if (url) storage.setItem(STORAGE_KEY, url);
  else storage.removeItem(STORAGE_KEY);
}

/** Resolve the server URL to try first, without connecting. */
export async function resolveServer() {
  const params = new URLSearchParams(location.search);
  const fromQuery = normalizeServerUrl(params.get('server'));
  if (fromQuery) {
    saveServer(fromQuery);
    return { url: fromQuery, source: 'url' };
  }

  const saved = savedServer();
  if (saved) return { url: saved, source: 'saved' };

  if (DEFAULT_SERVER) return { url: normalizeServerUrl(DEFAULT_SERVER), source: 'default' };

  if (await probeSameOrigin()) return { url: sameOriginServer(), source: 'same-origin' };

  return { url: '', source: 'none' };
}

/* ── Player profile ───────────────────────────────────────────────────────── */

export function loadProfile() {
  try {
    const parsed = JSON.parse(storage.getItem(PROFILE_KEY) || '{}');
    return {
      name: typeof parsed.name === 'string' ? parsed.name : '',
      avatar: Number.isInteger(parsed.avatar) ? parsed.avatar : Math.floor(Math.random() * 16),
      sound: parsed.sound !== false,
    };
  } catch {
    return { name: '', avatar: 0, sound: true };
  }
}

export function saveProfile(profile) {
  storage.setItem(PROFILE_KEY, JSON.stringify(profile));
}

/* ── Session resume token ─────────────────────────────────────────────────── */

export function loadSession() {
  return storage.getItem(SESSION_KEY) || '';
}

export function saveSession(id) {
  if (id) storage.setItem(SESSION_KEY, id);
  else storage.removeItem(SESSION_KEY);
}

/* ── Theme ────────────────────────────────────────────────────────────────── */

export function loadTheme() {
  return storage.getItem(THEME_KEY) || 'dark';
}

export function saveTheme(theme) {
  storage.setItem(THEME_KEY, theme);
}
