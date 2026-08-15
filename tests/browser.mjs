#!/usr/bin/env node
/**
 * End-to-end browser test.
 *
 * Boots a real server, opens real Chromium windows, and plays a real match
 * between two of them. This is the only test that can catch "the rules are
 * right but nothing is clickable", so it checks the things unit tests cannot:
 * every game view mounts, a move made in one browser appears in the other, and
 * the server refuses a move made out of turn even when the UI is bypassed.
 *
 *   npm run test:browser
 *
 * Requires Playwright (`npm i -D playwright`). Set PLAYWRIGHT_CHROMIUM_PATH to
 * use a Chromium that is already on the machine instead of a downloaded one.
 */
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { mkdirSync } from 'node:fs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const PORT = Number(process.env.PORT || 8231);
const BASE = `http://127.0.0.1:${PORT}`;
const SHOTS = process.env.SHOT_DIR || resolve(ROOT, '.screenshots');

let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch {
  console.error('playwright is not installed — run `npm i -D playwright` first.');
  process.exit(2);
}

mkdirSync(SHOTS, { recursive: true });

const problems = [];
const step = (msg) => console.log(`  → ${msg}`);

function watch(page, label) {
  page.on('console', (msg) => {
    if (msg.type() === 'error') problems.push(`[${label}] console: ${msg.text()}`);
  });
  page.on('pageerror', (err) => problems.push(`[${label}] pageerror: ${err.message}`));
  page.on('requestfailed', (req) => {
    if (req.url().startsWith('ws')) return; // websocket teardown is not a failure
    problems.push(`[${label}] requestfailed: ${req.url()} ${req.failure()?.errorText}`);
  });
}

/* ── Boot a server for the test ───────────────────────────────────────────── */

const server = spawn(process.execPath, ['server/src/index.js'], {
  cwd: ROOT,
  env: { ...process.env, PORT: String(PORT), LOG_LEVEL: 'warn' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
server.stderr.on('data', (chunk) => process.stderr.write(`[server] ${chunk}`));

async function waitForServer() {
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(`${BASE}/healthz`);
      if (res.ok) return;
    } catch {
      /* not up yet */
    }
    await sleep(250);
  }
  throw new Error('server never became healthy');
}

await waitForServer();

const launchOptions = process.env.PLAYWRIGHT_CHROMIUM_PATH
  ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH }
  : {};
const browser = await chromium.launch(launchOptions);

try {
  /* ── 1. The hub loads and finds its server ─────────────────────────────── */
  console.log('\n1. hub loads');
  const ctxA = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const a = await ctxA.newPage();
  watch(a, 'A');
  await a.goto(BASE, { waitUntil: 'networkidle' });

  const cards = await a.locator('.game-card').count();
  step(`game cards rendered: ${cards}`);
  if (cards !== 15) problems.push(`expected 15 game cards, saw ${cards}`);

  await a.waitForFunction(() => document.querySelector('#conn-chip')?.dataset.state === 'online', { timeout: 10000 });
  step('connected to the same-origin server automatically');
  await a.screenshot({ path: `${SHOTS}/01-hub.png` });

  /* ── 2. Every game view mounts ─────────────────────────────────────────── */
  console.log('\n2. all 15 game views mount');
  const ids = await a.evaluate(async () => {
    const mod = await import('./shared/games/index.js');
    return mod.gameIds();
  });
  if (ids.length !== 15) problems.push(`registry reports ${ids.length} games`);
  for (const id of ids) {
    await a.goto(`${BASE}/#/game/${id}`, { waitUntil: 'domcontentloaded' });
    await a.waitForSelector('.match-title h1', { timeout: 8000 });
    await a.locator('.side-panel button.primary').first().click();
    await a.waitForSelector('.board-stage > *', { timeout: 8000 });
    if ((await a.locator('.board-stage > *').count()) === 0) problems.push(`${id}: board stage stayed empty`);
    step(`${id}: ok`);
  }

  /* ── 3. The bot actually plays ─────────────────────────────────────────── */
  console.log('\n3. local match vs the computer');
  await a.goto(`${BASE}/#/game/connect4`, { waitUntil: 'domcontentloaded' });
  await a.locator('.side-panel button.primary').first().click();
  await a.waitForSelector('.c4-drop', { timeout: 8000 });
  await a.locator('.c4-drop').nth(3).click();
  await a.waitForFunction(() => document.querySelectorAll('.c4-board .stone').length >= 2, { timeout: 8000 });
  step('the bot replied to a human move');
  await a.screenshot({ path: `${SHOTS}/02-local-connect4.png` });

  /* ── 4. Two browsers play each other ───────────────────────────────────── */
  console.log('\n4. online 1v1 across two browser contexts');
  const ctxB = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const b = await ctxB.newPage();
  watch(b, 'B');
  await b.goto(BASE, { waitUntil: 'networkidle' });
  await b.waitForFunction(() => document.querySelector('#conn-chip')?.dataset.state === 'online', { timeout: 10000 });

  await a.goto(`${BASE}/#/game/gomoku`, { waitUntil: 'domcontentloaded' });
  await a.locator('button:has-text("방 만들기")').first().click();
  await a.waitForSelector('.match-head h1', { timeout: 8000 });
  step('A created a room');

  await b.goto(`${BASE}/#/lobby`, { waitUntil: 'domcontentloaded' });
  await b.waitForSelector('.room-row', { timeout: 8000 });
  await b.locator('.room-row button:has-text("입장")').first().click();
  await b.waitForSelector('.match-head h1', { timeout: 8000 });
  step('B joined from the lobby');

  await a.waitForFunction(() => !document.body.textContent.includes('상대 대기 중'), { timeout: 8000 });
  await a.locator('.match-actions button:has-text("준비")').first().click();
  await b.locator('.match-actions button:has-text("준비")').first().click();
  await a.waitForSelector('.goban', { timeout: 8000 });
  await b.waitForSelector('.goban', { timeout: 8000 });
  step('match started on both clients');

  await a.locator('.goban .cell').nth(112).click();
  await b.waitForFunction(() => document.querySelectorAll('.goban .stone').length === 1, { timeout: 8000 });
  step('A move appeared on B');

  await b.locator('.goban .cell').nth(113).click();
  await a.waitForFunction(() => document.querySelectorAll('.goban .stone').length === 2, { timeout: 8000 });
  step('B move appeared on A');

  // The UI disables the board off-turn; force past it and check the referee.
  const before = await a.locator('.goban .stone').count();
  await b.locator('.goban .cell').nth(50).click({ force: true });
  await b.waitForTimeout(700);
  if ((await a.locator('.goban .stone').count()) !== before) problems.push('an out-of-turn move was accepted');
  else step('the server refused a forced out-of-turn move');

  await a.screenshot({ path: `${SHOTS}/03-online-gomoku.png` });

  /* ── 4b. Accounts ──────────────────────────────────────────────────────── */
  console.log('\n4b. sign up, persistence, and the leaderboard');
  const account = `테스터${Date.now().toString(36).slice(-4)}`;

  await a.goto(`${BASE}/#/lobby`, { waitUntil: 'domcontentloaded' });
  await a.locator('button:has-text("회원가입")').first().click();
  await a.waitForSelector('.modal', { timeout: 6000 });
  await a.locator('.modal input[type="text"]').fill(account);
  await a.locator('.modal input[type="password"]').first().fill('hunter22');
  await a.locator('.modal input[type="password"]').nth(1).fill('hunter22');
  await a.locator('.modal button[type="submit"]').click();
  await a.waitForSelector('#profile-btn.signed-in', { timeout: 8000 });
  step(`registered and signed in as ${account}`);

  // A reload must not sign you out — the token lives in localStorage.
  await a.reload({ waitUntil: 'networkidle' });
  await a.waitForSelector('#profile-btn.signed-in', { timeout: 8000 });
  const chipName = await a.locator('#profile-btn .profile-name').innerText();
  if (chipName.trim() !== account) problems.push(`after reload the chip read "${chipName}", expected "${account}"`);
  step('still signed in after a reload');

  // A guest must not be able to wear a registered name.
  await b.evaluate((name) => {
    localStorage.setItem('playhub.profile', JSON.stringify({ name, avatar: 1, sound: false }));
  }, account);
  await b.reload({ waitUntil: 'networkidle' });
  await b.waitForFunction(() => document.querySelector('#conn-chip')?.dataset.state === 'online', { timeout: 10000 });
  const guestName = await b.locator('#profile-btn .profile-name').innerText();
  if (guestName.trim() === account) problems.push('a guest was allowed to take a registered name');
  else step(`guest asking for "${account}" got "${guestName.trim()}" instead`);

  await a.screenshot({ path: `${SHOTS}/07-signed-in.png` });

  /* ── 5. Chat ───────────────────────────────────────────────────────────── */
  console.log('\n5. room chat');
  await a.locator('.chat-form input').fill('안녕하세요!');
  await a.locator('.chat-form button').click();
  await b.waitForFunction(() => document.body.textContent.includes('안녕하세요!'), { timeout: 8000 });
  step('chat delivered A → B');

  /* ── 6. Tournament ─────────────────────────────────────────────────────── */
  console.log('\n6. tournament');
  await a.goto(`${BASE}/#/tournaments`, { waitUntil: 'domcontentloaded' });
  await a.locator('button:has-text("대회 열기")').first().click();
  await a.waitForSelector('.modal', { timeout: 6000 });
  await a.locator('.modal button.primary:has-text("열기")').click();
  await a.waitForSelector('.bracket, .empty', { timeout: 8000 });
  step('A opened a tournament');

  await b.goto(`${BASE}/#/tournaments`, { waitUntil: 'domcontentloaded' });
  await b.waitForSelector('.room-row', { timeout: 8000 });
  await b.locator('.room-row button:has-text("참가")').first().click();
  await b.waitForFunction(() => document.body.textContent.includes('참가자 2명'), { timeout: 8000 });
  step('B joined the tournament');

  await a.locator('button:has-text("대회 시작")').click();
  await a.waitForSelector('.bracket', { timeout: 8000 });
  step('bracket generated and match rooms opened');
  await a.screenshot({ path: `${SHOTS}/04-tournament.png` });

  /* ── 7. Light theme ────────────────────────────────────────────────────── */
  console.log('\n7. light theme');
  await a.goto(BASE, { waitUntil: 'domcontentloaded' });
  await a.locator('#theme-btn').click();
  await a.waitForTimeout(300);
  const theme = await a.evaluate(() => document.documentElement.dataset.theme);
  if (theme !== 'light') problems.push(`theme toggle produced "${theme}"`);
  step(`theme toggled to ${theme}`);
  await a.screenshot({ path: `${SHOTS}/05-light.png` });

  /* ── 8. Phone-sized layout ─────────────────────────────────────────────── */
  console.log('\n8. mobile layout');
  const ctxM = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const m = await ctxM.newPage();
  watch(m, 'M');
  await m.goto(`${BASE}/#/game/quiz`, { waitUntil: 'domcontentloaded' });
  await m.locator('.side-panel button.primary').first().click();
  await m.waitForSelector('.quiz-options', { timeout: 8000 });
  const overflow = await m.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  step(`horizontal overflow: ${overflow}px`);
  if (overflow > 2) problems.push(`mobile layout overflows horizontally by ${overflow}px`);
  await m.screenshot({ path: `${SHOTS}/06-mobile-quiz.png`, fullPage: true });
} catch (err) {
  problems.push(`threw: ${err.message}`);
} finally {
  await browser.close();
  server.kill('SIGTERM');
}

console.log('\n────────────────────────────');
if (problems.length) {
  console.log(`✗ ${problems.length} problem(s):`);
  for (const p of problems) console.log(`   ${p}`);
  process.exit(1);
}
console.log(`✓ all browser checks passed — screenshots in ${SHOTS}`);
process.exit(0);
