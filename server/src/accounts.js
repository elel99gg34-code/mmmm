/**
 * Accounts: registration, login, sessions and lifetime stats.
 *
 * Deliberately dependency-free and file-backed. A game hub of this size does
 * not need a database server, and not needing one is why `npm start` is the
 * whole setup. Records live in `<DATA_DIR>/accounts.json`, written atomically
 * (temp file + rename) and debounced so a busy lobby does not thrash the disk.
 *
 * Passwords are scrypt hashes with a per-user salt; the plaintext is never
 * stored, never logged, and never leaves the socket it arrived on. Sessions are
 * HMAC-signed tokens rather than server-side rows, so a restart does not log
 * everybody out — and a per-user `tokenVersion` still allows revoking them all.
 */
import { createHmac, randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { log } from './util.js';

const scrypt = promisify(scryptCb);

export const LIMITS = {
  usernameMin: 2,
  usernameMax: 16,
  passwordMin: 6,
  passwordMax: 200,
};

/** Letters (incl. Hangul), digits, underscore and hyphen. No spaces. */
const USERNAME_RE = /^[\p{L}\p{N}_-]+$/u;

const SCRYPT_KEYLEN = 64;
const SALT_BYTES = 16;
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const SAVE_DEBOUNCE_MS = 1500;

const b64url = (buf) => Buffer.from(buf).toString('base64url');

/** Compare two strings without leaking their difference through timing. */
function safeEqual(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

function emptyStats() {
  return { games: 0, wins: 0, losses: 0, draws: 0, byGame: {} };
}

export class Accounts {
  constructor({ dataDir, secret } = {}) {
    this.dataDir = dataDir || process.env.DATA_DIR || './data';
    this.file = join(this.dataDir, 'accounts.json');
    this.secret = secret || process.env.AUTH_SECRET || null;
    this.users = new Map(); // id -> record
    this.byName = new Map(); // lowercase username -> id
    this.attempts = new Map(); // lowercase username -> { count, until }
    this.dirty = false;
    this.saveTimer = null;
    this.loaded = false;
  }

  /* ── Persistence ────────────────────────────────────────────────────────── */

  async load() {
    await mkdir(this.dataDir, { recursive: true }).catch(() => {});
    let parsed = null;
    try {
      parsed = JSON.parse(await readFile(this.file, 'utf8'));
    } catch (err) {
      if (err.code !== 'ENOENT') log.warn('accounts file unreadable, starting empty', { err: String(err) });
    }

    if (parsed?.users) {
      for (const record of parsed.users) {
        this.users.set(record.id, record);
        this.byName.set(record.usernameLower, record.id);
      }
    }
    // Persist a generated secret so a restart does not invalidate every session.
    if (!this.secret) {
      this.secret = parsed?.secret || randomBytes(32).toString('hex');
      if (!parsed?.secret) this.dirty = true;
    }
    this.loaded = true;
    log.info('accounts loaded', { count: this.users.size, file: this.file });

    // Prove the store is writable at boot rather than discovering it the first
    // time someone registers. A read-only DATA_DIR is a configuration mistake
    // that otherwise looks exactly like everything working.
    this.writable = await this.probeWritable();
    if (!this.writable) {
      log.error(
        `accounts directory is not writable: ${this.dataDir} — sign-ups will work for this run but will NOT survive a restart. ` +
          'Point DATA_DIR at a writable (ideally persistent) path, or set ACCOUNTS=0.',
      );
    }
    // Never let a bad DATA_DIR stop the server from booting. Guests, and even
    // sign-ups, still work for this run — they just will not outlive it, and
    // the log above says exactly that.
    if (this.dirty) {
      await this.flush().catch((err) => log.error('initial accounts write failed', { err: String(err) }));
    }
    return this;
  }

  /** Can we actually write where we were told to? */
  async probeWritable() {
    const probe = `${this.file}.probe-${process.pid}`;
    try {
      await mkdir(this.dataDir, { recursive: true });
      await writeFile(probe, 'ok', { mode: 0o600 });
      await rm(probe, { force: true });
      return true;
    } catch {
      return false;
    }
  }

  scheduleSave() {
    this.dirty = true;
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      this.flush().catch((err) => log.error('accounts save failed', { err: String(err) }));
    }, SAVE_DEBOUNCE_MS);
    if (typeof this.saveTimer.unref === 'function') this.saveTimer.unref();
  }

  /** Write the file atomically so a crash mid-write cannot corrupt it. */
  async flush() {
    if (!this.dirty) return;
    // Clear the flag up front so concurrent callers do not both write, but put
    // it back if the write fails — otherwise a transient disk error would
    // silently discard everything registered since the last successful save.
    this.dirty = false;
    try {
      await this.writeNow();
    } catch (err) {
      this.dirty = true;
      throw err;
    }
  }

  async writeNow() {
    const payload = JSON.stringify(
      {
        version: 1,
        // Only kept here because there is nowhere else to keep it; set
        // AUTH_SECRET in the environment to control it yourself.
        secret: process.env.AUTH_SECRET ? undefined : this.secret,
        users: [...this.users.values()],
      },
      null,
      0,
    );
    const tmp = `${this.file}.${process.pid}.tmp`;
    await mkdir(this.dataDir, { recursive: true }).catch(() => {});
    await writeFile(tmp, payload, { mode: 0o600 });
    await rename(tmp, this.file);
  }

  async close() {
    clearTimeout(this.saveTimer);
    this.saveTimer = null;
    await this.flush().catch(() => {});
  }

  /* ── Validation ─────────────────────────────────────────────────────────── */

  /** Returns an error string, or null when the name is usable. */
  checkUsername(raw) {
    const name = String(raw ?? '').trim();
    if (name.length < LIMITS.usernameMin) return `아이디는 ${LIMITS.usernameMin}자 이상이어야 합니다.`;
    if (name.length > LIMITS.usernameMax) return `아이디는 ${LIMITS.usernameMax}자 이하여야 합니다.`;
    if (!USERNAME_RE.test(name)) return '아이디에는 한글·영문·숫자·밑줄·하이픈만 쓸 수 있습니다.';
    if (this.byName.has(name.toLowerCase())) return '이미 사용 중인 아이디입니다.';
    return null;
  }

  checkPassword(raw) {
    const password = String(raw ?? '');
    if (password.length < LIMITS.passwordMin) return `비밀번호는 ${LIMITS.passwordMin}자 이상이어야 합니다.`;
    if (password.length > LIMITS.passwordMax) return '비밀번호가 너무 깁니다.';
    return null;
  }

  /** True when a display name belongs to a registered account. */
  isNameTaken(name) {
    return this.byName.has(String(name ?? '').trim().toLowerCase());
  }

  /* ── Registration and login ─────────────────────────────────────────────── */

  async register({ username, password, avatar = 0 }) {
    const nameProblem = this.checkUsername(username);
    if (nameProblem) return { ok: false, error: nameProblem };
    const passProblem = this.checkPassword(password);
    if (passProblem) return { ok: false, error: passProblem };

    const name = String(username).trim();
    const salt = randomBytes(SALT_BYTES).toString('hex');
    const hash = (await scrypt(String(password), salt, SCRYPT_KEYLEN)).toString('hex');

    const record = {
      id: `u_${randomBytes(9).toString('base64url')}`,
      username: name,
      usernameLower: name.toLowerCase(),
      salt,
      hash,
      tokenVersion: 1,
      avatar: Number.isInteger(avatar) ? avatar : 0,
      createdAt: Date.now(),
      lastSeenAt: Date.now(),
      stats: emptyStats(),
    };
    this.users.set(record.id, record);
    this.byName.set(record.usernameLower, record.id);
    this.scheduleSave();
    log.info('account registered', { username: record.username });
    return { ok: true, user: record, token: this.mintToken(record) };
  }

  /**
   * Verify a password. Always does the scrypt work even for an unknown user,
   * so response time does not reveal which usernames exist.
   */
  async login({ username, password }) {
    const key = String(username ?? '').trim().toLowerCase();
    const blocked = this.attempts.get(key);
    if (blocked && blocked.until > Date.now()) {
      const seconds = Math.ceil((blocked.until - Date.now()) / 1000);
      return { ok: false, error: `로그인 시도가 너무 많습니다. ${seconds}초 후 다시 시도해 주세요.` };
    }

    const id = this.byName.get(key);
    const record = id ? this.users.get(id) : null;
    const salt = record?.salt ?? 'decoy-salt-for-constant-work';
    const derived = (await scrypt(String(password ?? ''), salt, SCRYPT_KEYLEN)).toString('hex');
    const good = Boolean(record) && safeEqual(derived, record.hash);

    if (!good) {
      const next = { count: (blocked?.count ?? 0) + 1, until: 0 };
      // Five wrong tries buys a cool-off that grows with each further attempt.
      if (next.count >= 5) next.until = Date.now() + Math.min(15 * 60_000, 2 ** (next.count - 5) * 30_000);
      this.attempts.set(key, next);
      return { ok: false, error: '아이디 또는 비밀번호가 올바르지 않습니다.' };
    }

    this.attempts.delete(key);
    record.lastSeenAt = Date.now();
    this.scheduleSave();
    return { ok: true, user: record, token: this.mintToken(record) };
  }

  /* ── Sessions ───────────────────────────────────────────────────────────── */

  sign(payload) {
    return b64url(createHmac('sha256', this.secret).update(payload).digest());
  }

  mintToken(record, ttlMs = SESSION_TTL_MS) {
    const payload = b64url(
      JSON.stringify({ u: record.id, v: record.tokenVersion, e: Date.now() + ttlMs }),
    );
    return `${payload}.${this.sign(payload)}`;
  }

  /** The account a token belongs to, or null when it is invalid or expired. */
  verifyToken(token) {
    if (typeof token !== 'string' || !token.includes('.')) return null;
    const [payload, signature] = token.split('.');
    if (!payload || !signature) return null;
    if (!safeEqual(signature, this.sign(payload))) return null;

    let claims;
    try {
      claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    } catch {
      return null;
    }
    if (!claims || typeof claims.u !== 'string') return null;
    if (!(claims.e > Date.now())) return null;

    const record = this.users.get(claims.u);
    if (!record) return null;
    if (claims.v !== record.tokenVersion) return null; // revoked
    return record;
  }

  /** Invalidate every existing session for a user. */
  revokeAll(userId) {
    const record = this.users.get(userId);
    if (!record) return false;
    record.tokenVersion += 1;
    this.scheduleSave();
    return true;
  }

  async changePassword({ userId, currentPassword, newPassword }) {
    const record = this.users.get(userId);
    if (!record) return { ok: false, error: '계정을 찾을 수 없습니다.' };
    const problem = this.checkPassword(newPassword);
    if (problem) return { ok: false, error: problem };

    const derived = (await scrypt(String(currentPassword ?? ''), record.salt, SCRYPT_KEYLEN)).toString('hex');
    if (!safeEqual(derived, record.hash)) return { ok: false, error: '현재 비밀번호가 올바르지 않습니다.' };

    record.salt = randomBytes(SALT_BYTES).toString('hex');
    record.hash = (await scrypt(String(newPassword), record.salt, SCRYPT_KEYLEN)).toString('hex');
    record.tokenVersion += 1; // every other device is logged out
    this.scheduleSave();
    return { ok: true, token: this.mintToken(record) };
  }

  /* ── Profile and stats ──────────────────────────────────────────────────── */

  touch(userId, patch = {}) {
    const record = this.users.get(userId);
    if (!record) return null;
    record.lastSeenAt = Date.now();
    if (Number.isInteger(patch.avatar)) record.avatar = patch.avatar;
    this.scheduleSave();
    return record;
  }

  /** Record a finished match. `outcome` is 'win' | 'loss' | 'draw'. */
  recordMatch(userId, gameId, outcome) {
    const record = this.users.get(userId);
    if (!record) return null;
    if (!['win', 'loss', 'draw'].includes(outcome)) return null;

    const stats = record.stats || (record.stats = emptyStats());
    stats.games += 1;
    if (outcome === 'win') stats.wins += 1;
    else if (outcome === 'loss') stats.losses += 1;
    else stats.draws += 1;

    const per = stats.byGame[gameId] || (stats.byGame[gameId] = { games: 0, wins: 0, losses: 0, draws: 0 });
    per.games += 1;
    if (outcome === 'win') per.wins += 1;
    else if (outcome === 'loss') per.losses += 1;
    else per.draws += 1;

    this.scheduleSave();
    return record;
  }

  /** Everything about an account that is safe to show other players. */
  publicProfile(userId) {
    const record = this.users.get(userId);
    if (!record) return null;
    return {
      id: record.id,
      username: record.username,
      avatar: record.avatar,
      createdAt: record.createdAt,
      lastSeenAt: record.lastSeenAt,
      stats: record.stats || emptyStats(),
    };
  }

  /** The shape the client stores as "the logged-in user". */
  selfProfile(userId) {
    const profile = this.publicProfile(userId);
    return profile ? { ...profile, authenticated: true } : null;
  }

  /**
   * Top players by wins. Ties break on win rate, then on fewer games — so a
   * steady winner outranks someone who ground out the same total.
   */
  leaderboard(limit = 20) {
    return [...this.users.values()]
      .filter((record) => (record.stats?.games ?? 0) > 0)
      .map((record) => {
        const stats = record.stats;
        return {
          id: record.id,
          username: record.username,
          avatar: record.avatar,
          games: stats.games,
          wins: stats.wins,
          losses: stats.losses,
          draws: stats.draws,
          winRate: stats.games ? stats.wins / stats.games : 0,
        };
      })
      .sort((a, b) => b.wins - a.wins || b.winRate - a.winRate || a.games - b.games)
      .slice(0, limit);
  }

  get size() {
    return this.users.size;
  }
}
