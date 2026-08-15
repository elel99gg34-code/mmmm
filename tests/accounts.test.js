/**
 * Account tests: registration, password handling, sessions, and stats.
 *
 * These use a throwaway data directory so nothing here touches a real
 * accounts.json. Async, because password hashing is (deliberately) slow.
 */
import { mkdtemp, rm, readFile, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { suite, testAsync, assert, equal } from './harness.js';
import { Accounts } from '../server/src/accounts.js';
import { Hub } from '../server/src/hub.js';
import { C2S, S2C } from '../shared/protocol.js';

const dirs = [];

async function freshAccounts() {
  const dir = await mkdtemp(join(tmpdir(), 'playhub-accounts-'));
  dirs.push(dir);
  return new Accounts({ dataDir: dir, secret: 'test-secret-do-not-use' }).load();
}

/* ── Registration ─────────────────────────────────────────────────────────── */

suite('accounts: registration');

await testAsync('registering returns a user and a working token', async () => {
  const accounts = await freshAccounts();
  const res = await accounts.register({ username: '가람', password: 'hunter22' });
  assert(res.ok, res.error);
  equal(res.user.username, '가람');
  assert(res.token, 'no token issued');
  equal(accounts.verifyToken(res.token)?.id, res.user.id);
});

await testAsync('the password is never stored in the clear', async () => {
  const accounts = await freshAccounts();
  await accounts.register({ username: 'plainly', password: 'sup3rsecret' });
  await accounts.flush();
  const raw = await readFile(accounts.file, 'utf8');
  equal(raw.includes('sup3rsecret'), false, 'the plaintext password is in the file');
  assert(raw.includes('"hash"'), 'expected a stored hash');
});

await testAsync('the accounts file is not world-readable', async () => {
  const accounts = await freshAccounts();
  await accounts.register({ username: 'modes', password: 'hunter22' });
  await accounts.flush();
  const info = await stat(accounts.file);
  equal(info.mode & 0o077, 0, 'group/other can read the account store');
});

await testAsync('duplicate usernames are refused, case-insensitively', async () => {
  const accounts = await freshAccounts();
  await accounts.register({ username: 'Nari', password: 'hunter22' });
  const again = await accounts.register({ username: 'nARI', password: 'hunter22' });
  equal(again.ok, false);
  assert(again.error.includes('이미'), again.error);
});

await testAsync('bad usernames and passwords are refused with a reason', async () => {
  const accounts = await freshAccounts();
  for (const username of ['', 'a', 'x'.repeat(17), 'has space', 'bad/slash', '<script>']) {
    const res = await accounts.register({ username, password: 'hunter22' });
    equal(res.ok, false, `accepted username ${JSON.stringify(username)}`);
    assert(typeof res.error === 'string' && res.error.length > 0);
  }
  const shortPass = await accounts.register({ username: 'okname', password: '123' });
  equal(shortPass.ok, false);
});

/* ── Login ────────────────────────────────────────────────────────────────── */

suite('accounts: login');

await testAsync('the right password logs in and the wrong one does not', async () => {
  const accounts = await freshAccounts();
  await accounts.register({ username: '가람', password: 'hunter22' });

  const good = await accounts.login({ username: '가람', password: 'hunter22' });
  assert(good.ok, good.error);
  equal(good.user.username, '가람');

  const bad = await accounts.login({ username: '가람', password: 'hunter23' });
  equal(bad.ok, false);
  assert(!bad.error.includes('hunter'), 'the error echoed the password back');
});

await testAsync('an unknown user fails the same way a wrong password does', async () => {
  const accounts = await freshAccounts();
  await accounts.register({ username: 'real', password: 'hunter22' });
  const missing = await accounts.login({ username: 'ghost', password: 'hunter22' });
  const wrong = await accounts.login({ username: 'real', password: 'nope123' });
  equal(missing.ok, false);
  equal(wrong.ok, false);
  // Identical wording, so the response cannot be used to enumerate accounts.
  equal(missing.error, wrong.error);
});

await testAsync('repeated failures trigger a cool-off', async () => {
  const accounts = await freshAccounts();
  await accounts.register({ username: 'target', password: 'hunter22' });
  for (let i = 0; i < 5; i++) await accounts.login({ username: 'target', password: `guess${i}` });
  const blocked = await accounts.login({ username: 'target', password: 'hunter22' });
  equal(blocked.ok, false, 'the correct password went through despite the lockout');
  assert(blocked.error.includes('시도'), blocked.error);
});

await testAsync('a successful login clears the failure counter', async () => {
  const accounts = await freshAccounts();
  await accounts.register({ username: 'clears', password: 'hunter22' });
  for (let i = 0; i < 3; i++) await accounts.login({ username: 'clears', password: 'wrong' });
  assert((await accounts.login({ username: 'clears', password: 'hunter22' })).ok);
  equal(accounts.attempts.has('clears'), false);
});

/* ── Sessions ─────────────────────────────────────────────────────────────── */

suite('accounts: sessions');

await testAsync('a tampered or foreign token is rejected', async () => {
  const accounts = await freshAccounts();
  const { token } = await accounts.register({ username: 'tok', password: 'hunter22' });
  const [payload, signature] = token.split('.');

  equal(accounts.verifyToken(`${payload}.${signature.slice(0, -2)}xy`), null, 'bad signature accepted');
  equal(accounts.verifyToken(`${Buffer.from('{"u":"u_x","v":1,"e":9999999999999}').toString('base64url')}.${signature}`), null);
  equal(accounts.verifyToken('nonsense'), null);
  equal(accounts.verifyToken(''), null);
  equal(accounts.verifyToken(null), null);

  const other = new Accounts({ dataDir: accounts.dataDir, secret: 'a-different-secret' });
  other.users = accounts.users;
  equal(other.verifyToken(token), null, 'a token signed by another server was accepted');
});

await testAsync('an expired token is rejected', async () => {
  const accounts = await freshAccounts();
  const { user } = await accounts.register({ username: 'expiry', password: 'hunter22' });
  const stale = accounts.mintToken(user, -1000);
  equal(accounts.verifyToken(stale), null);
});

await testAsync('revoking invalidates every issued token', async () => {
  const accounts = await freshAccounts();
  const { user, token } = await accounts.register({ username: 'revoke', password: 'hunter22' });
  assert(accounts.verifyToken(token));
  accounts.revokeAll(user.id);
  equal(accounts.verifyToken(token), null);
});

await testAsync('changing the password issues a new token and kills the old ones', async () => {
  const accounts = await freshAccounts();
  const { user, token } = await accounts.register({ username: 'rotate', password: 'hunter22' });

  const wrong = await accounts.changePassword({ userId: user.id, currentPassword: 'nope', newPassword: 'brandnew1' });
  equal(wrong.ok, false);

  const res = await accounts.changePassword({ userId: user.id, currentPassword: 'hunter22', newPassword: 'brandnew1' });
  assert(res.ok, res.error);
  equal(accounts.verifyToken(token), null, 'the old session survived a password change');
  assert(accounts.verifyToken(res.token), 'the new token does not work');
  assert((await accounts.login({ username: 'rotate', password: 'brandnew1' })).ok);
});

/* ── Persistence ──────────────────────────────────────────────────────────── */

suite('accounts: persistence');

await testAsync('accounts survive a restart', async () => {
  const accounts = await freshAccounts();
  await accounts.register({ username: '단풍', password: 'hunter22' });
  accounts.recordMatch([...accounts.users.values()][0].id, 'gomoku', 'win');
  await accounts.flush();

  const reopened = await new Accounts({ dataDir: accounts.dataDir, secret: 'test-secret-do-not-use' }).load();
  equal(reopened.size, 1);
  const res = await reopened.login({ username: '단풍', password: 'hunter22' });
  assert(res.ok, res.error);
  equal(res.user.stats.wins, 1, 'stats did not survive the restart');
});

await testAsync('a generated secret is reused so sessions survive a restart', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'playhub-secret-'));
  dirs.push(dir);
  const first = await new Accounts({ dataDir: dir }).load();
  const { token } = await first.register({ username: 'persist', password: 'hunter22' });
  await first.flush();

  const second = await new Accounts({ dataDir: dir }).load();
  assert(second.verifyToken(token), 'the session died because the secret changed');
});

await testAsync('an unwritable data directory warns but does not stop the server', async () => {
  const base = await mkdtemp(join(tmpdir(), 'playhub-ro-'));
  dirs.push(base);
  // A regular file used as a directory: every write fails with ENOTDIR.
  const blocker = join(base, 'blocker');
  await writeFile(blocker, 'not a directory');

  const accounts = await new Accounts({ dataDir: join(blocker, 'data'), secret: 'test' }).load();
  equal(accounts.loaded, true, 'load() should not throw on an unwritable path');
  equal(accounts.writable, false, 'the writability probe should have failed');

  const res = await accounts.register({ username: 'ephemeral', password: 'hunter22' });
  assert(res.ok, 'sign-up should still work in memory');
  assert((await accounts.login({ username: 'ephemeral', password: 'hunter22' })).ok);
  // The pending write must stay pending rather than being silently dropped.
  equal(accounts.dirty, true);
});

/* ── Stats ────────────────────────────────────────────────────────────────── */

suite('accounts: stats');

await testAsync('results accumulate overall and per game', async () => {
  const accounts = await freshAccounts();
  const { user } = await accounts.register({ username: 'stats', password: 'hunter22' });
  accounts.recordMatch(user.id, 'gomoku', 'win');
  accounts.recordMatch(user.id, 'gomoku', 'loss');
  accounts.recordMatch(user.id, 'quiz', 'draw');
  accounts.recordMatch(user.id, 'quiz', 'bogus'); // ignored

  const profile = accounts.publicProfile(user.id);
  equal(profile.stats.games, 3);
  equal(profile.stats.wins, 1);
  equal(profile.stats.losses, 1);
  equal(profile.stats.draws, 1);
  equal(profile.stats.byGame.gomoku.games, 2);
  equal(profile.stats.byGame.quiz.draws, 1);
});

await testAsync('a public profile carries no secrets', async () => {
  const accounts = await freshAccounts();
  const { user } = await accounts.register({ username: 'private', password: 'hunter22' });
  const profile = accounts.publicProfile(user.id);
  equal(profile.hash, undefined, 'the hash leaked');
  equal(profile.salt, undefined, 'the salt leaked');
  equal(profile.tokenVersion, undefined);
  const raw = JSON.stringify(profile);
  equal(raw.includes(user.hash), false);
});

await testAsync('the leaderboard ranks by wins then win rate', async () => {
  const accounts = await freshAccounts();
  const make = async (name, wins, losses) => {
    const { user } = await accounts.register({ username: name, password: 'hunter22' });
    for (let i = 0; i < wins; i++) accounts.recordMatch(user.id, 'gomoku', 'win');
    for (let i = 0; i < losses; i++) accounts.recordMatch(user.id, 'gomoku', 'loss');
  };
  await make('steady', 5, 1);
  await make('grinder', 5, 20);
  await make('rookie', 1, 0);
  await make('idle', 0, 0);

  const rows = accounts.leaderboard();
  equal(rows.length, 3, 'a player with no games should not be ranked');
  equal(rows[0].username, 'steady', 'the better win rate should break the tie');
  equal(rows[1].username, 'grinder');
  equal(rows[2].username, 'rookie');
});

/* ── Hub integration ──────────────────────────────────────────────────────── */

suite('accounts: hub integration');

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

  last(type) {
    for (let i = this.sent.length - 1; i >= 0; i--) if (this.sent[i].t === type) return this.sent[i];
    return undefined;
  }
}

/** Connect a client, optionally presenting a token. */
function connect(hub, name, extra = {}) {
  const socket = new FakeSocket();
  const client = hub.addConnection(socket, {});
  hub.handle(client, JSON.stringify({ t: C2S.HELLO, name, ...extra }));
  hub.handle(client, JSON.stringify({ t: C2S.LOBBY_SUB }));
  return { socket, client };
}

/**
 * Auth handlers are async and scrypt is deliberately slow, so a microtask tick
 * is not enough — poll until the effect actually lands.
 */
async function waitFor(check, label = 'condition', timeoutMs = 5000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`timed out waiting for ${label}`);
}

/** Register through the hub and wait until the connection is signed in. */
async function signUp(hub, peer, username, password = 'hunter22') {
  hub.handle(peer.client, JSON.stringify({ t: C2S.AUTH_REGISTER, username, password }));
  await waitFor(() => peer.client.userId, `${username} to be registered`);
}

await testAsync('registering through the hub signs the connection in', async () => {
  const accounts = await freshAccounts();
  const hub = new Hub({ accounts });
  try {
    const peer = connect(hub, '손님');
    await signUp(hub, peer, '별빛');

    const auth = peer.socket.last(S2C.AUTH);
    assert(auth, 'no auth reply');
    assert(auth.token, 'no token');
    equal(auth.user.username, '별빛');
    equal(peer.client.userId, auth.user.id);
    equal(peer.client.name, '별빛', 'the display name should follow the account');
  } finally {
    hub.stop();
  }
});

await testAsync('a token on hello restores the account', async () => {
  const accounts = await freshAccounts();
  const { token } = await accounts.register({ username: '노을', password: 'hunter22' });
  const hub = new Hub({ accounts });
  try {
    const peer = connect(hub, '아무개', { token });
    const welcome = peer.socket.last(S2C.WELCOME);
    equal(welcome.name, '노을');
    equal(welcome.user?.username, '노을');
    equal(welcome.accountsEnabled, true);
  } finally {
    hub.stop();
  }
});

await testAsync('a rejected token is reported so the client can clear it', async () => {
  const accounts = await freshAccounts();
  const hub = new Hub({ accounts });
  try {
    const peer = connect(hub, '아무개', { token: 'clearly.invalid' });
    const welcome = peer.socket.last(S2C.WELCOME);
    equal(welcome.tokenRejected, true);
    equal(welcome.user, null);
  } finally {
    hub.stop();
  }
});

await testAsync('a guest cannot wear a registered name', async () => {
  const accounts = await freshAccounts();
  await accounts.register({ username: '별빛', password: 'hunter22' });
  const hub = new Hub({ accounts });
  try {
    const peer = connect(hub, '별빛');
    assert(peer.client.name !== '별빛', 'a guest took a registered name at hello');

    hub.handle(peer.client, JSON.stringify({ t: C2S.PROFILE, name: '별빛' }));
    assert(peer.socket.last(S2C.ERROR), 'renaming into a registered name was allowed');
    assert(peer.client.name !== '별빛');
  } finally {
    hub.stop();
  }
});

await testAsync('the same account cannot be signed in twice at once', async () => {
  const accounts = await freshAccounts();
  await accounts.register({ username: '단짝', password: 'hunter22' });
  const hub = new Hub({ accounts });
  try {
    const first = connect(hub, 'a');
    hub.handle(first.client, JSON.stringify({ t: C2S.AUTH_LOGIN, username: '단짝', password: 'hunter22' }));
    await waitFor(() => first.client.userId, 'the first login');
    equal(first.client.name, '단짝');

    const second = connect(hub, 'b');
    hub.handle(second.client, JSON.stringify({ t: C2S.AUTH_LOGIN, username: '단짝', password: 'hunter22' }));
    await waitFor(() => second.socket.last(S2C.AUTH_ERROR), 'the second login to be refused');
    equal(second.client.userId, null);
  } finally {
    hub.stop();
  }
});

await testAsync('finishing a match credits both accounts', async () => {
  const accounts = await freshAccounts();
  const hub = new Hub({ accounts });
  try {
    const a = connect(hub, 'a');
    const b = connect(hub, 'b');
    await signUp(hub, a, '가람');
    await signUp(hub, b, '나린');

    hub.handle(a.client, JSON.stringify({ t: C2S.ROOM_CREATE, gameId: 'gomoku' }));
    const roomId = a.socket.last(S2C.ROOM).room.id;
    hub.handle(b.client, JSON.stringify({ t: C2S.ROOM_JOIN, roomId }));
    hub.handle(a.client, JSON.stringify({ t: C2S.ROOM_READY, ready: true }));
    hub.handle(b.client, JSON.stringify({ t: C2S.ROOM_READY, ready: true }));
    equal(hub.rooms.get(roomId).phase, 'playing');

    hub.handle(b.client, JSON.stringify({ t: C2S.GAME_RESIGN }));

    equal(accounts.publicProfile(a.client.userId).stats.wins, 1);
    equal(accounts.publicProfile(b.client.userId).stats.losses, 1);
    equal(accounts.publicProfile(a.client.userId).stats.byGame.gomoku.wins, 1);
  } finally {
    hub.stop();
  }
});

await testAsync('a match against a guest still records the signed-in player', async () => {
  const accounts = await freshAccounts();
  const hub = new Hub({ accounts });
  try {
    const a = connect(hub, 'a');
    const guest = connect(hub, '손님하나');
    await signUp(hub, a, '가람');

    hub.handle(a.client, JSON.stringify({ t: C2S.ROOM_CREATE, gameId: 'gomoku' }));
    const roomId = a.socket.last(S2C.ROOM).room.id;
    hub.handle(guest.client, JSON.stringify({ t: C2S.ROOM_JOIN, roomId }));
    hub.handle(a.client, JSON.stringify({ t: C2S.ROOM_READY, ready: true }));
    hub.handle(guest.client, JSON.stringify({ t: C2S.ROOM_READY, ready: true }));
    hub.handle(guest.client, JSON.stringify({ t: C2S.GAME_RESIGN }));

    equal(accounts.publicProfile(a.client.userId).stats.wins, 1);
  } finally {
    hub.stop();
  }
});

await testAsync('logging out during a game is refused', async () => {
  const accounts = await freshAccounts();
  const hub = new Hub({ accounts });
  try {
    const a = connect(hub, 'a');
    const b = connect(hub, 'b');
    await signUp(hub, a, '가람');

    hub.handle(a.client, JSON.stringify({ t: C2S.ROOM_CREATE, gameId: 'gomoku' }));
    const roomId = a.socket.last(S2C.ROOM).room.id;
    hub.handle(b.client, JSON.stringify({ t: C2S.ROOM_JOIN, roomId }));
    hub.handle(a.client, JSON.stringify({ t: C2S.ROOM_READY, ready: true }));
    hub.handle(b.client, JSON.stringify({ t: C2S.ROOM_READY, ready: true }));

    hub.handle(a.client, JSON.stringify({ t: C2S.AUTH_LOGOUT }));
    assert(a.socket.last(S2C.AUTH_ERROR), 'logging out mid-match was allowed');
    assert(a.client.userId, 'the account was detached mid-match');
  } finally {
    hub.stop();
  }
});

await testAsync('a server without accounts still serves guests', async () => {
  const hub = new Hub({ accounts: null });
  try {
    const peer = connect(hub, '손님');
    equal(peer.socket.last(S2C.WELCOME).accountsEnabled, false);
    hub.handle(peer.client, JSON.stringify({ t: C2S.AUTH_LOGIN, username: 'x', password: 'yyyyyy' }));
    assert(peer.socket.last(S2C.AUTH_ERROR), 'expected a clear refusal');

    hub.handle(peer.client, JSON.stringify({ t: C2S.ROOM_CREATE, gameId: 'gomoku' }));
    assert(peer.socket.last(S2C.ROOM), 'guests should still be able to play');
  } finally {
    hub.stop();
  }
});

/* ── Cleanup ──────────────────────────────────────────────────────────────── */

for (const dir of dirs) await rm(dir, { recursive: true, force: true });
