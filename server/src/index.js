#!/usr/bin/env node
/**
 * PlayHub server entry point.
 *
 * One process serves three things:
 *   1. the static web client (so `npm start` is the whole local setup),
 *   2. a tiny JSON API for health checks and the game catalogue,
 *   3. the WebSocket hub at `/ws` where the actual playing happens.
 *
 * Configuration is all environment variables, because that is what every
 * host in the deploy guide speaks:
 *   PORT              listen port (default 8080)
 *   HOST              bind address (default 0.0.0.0)
 *   SERVE_STATIC      "0" to disable the static file server
 *   ALLOWED_ORIGINS   comma-separated allow-list for WebSocket origins
 *   LOG_LEVEL         debug | info | warn | error
 */
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { WebSocketServer } from 'ws';

import { Hub } from './hub.js';
import { serveStatic } from './static.js';
import { log } from './util.js';
import { catalogue } from '../../shared/games/index.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const WEB_ROOT = resolve(HERE, '../..');

const PORT = Number(process.env.PORT || 8080);
const HOST = process.env.HOST || '0.0.0.0';
const SERVE_STATIC = process.env.SERVE_STATIC !== '0';
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

const hub = new Hub();

/** Origin allow-list. Empty list means "any origin", the default for a public hub. */
function originAllowed(origin) {
  if (!ALLOWED_ORIGINS.length) return true;
  if (!origin) return true; // native clients and curl send none
  return ALLOWED_ORIGINS.some((allowed) => allowed === '*' || origin === allowed);
}

function json(res, status, body) {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(text),
    'access-control-allow-origin': '*',
    'cache-control': 'no-store',
  });
  res.end(text);
}

const server = createServer(async (req, res) => {
  const path = (req.url || '/').split('?')[0];

  if (path === '/healthz' || path === '/api/health') return json(res, 200, hub.health());
  if (path === '/api/games') return json(res, 200, { games: catalogue() });
  if (path === '/api/lobby') return json(res, 200, hub.lobbyState());

  if (SERVE_STATIC) {
    try {
      if (await serveStatic(WEB_ROOT, req, res)) return;
    } catch (err) {
      log.error('static serve failed', { path, err: String(err) });
      if (!res.headersSent) res.writeHead(500).end('server error');
      return;
    }
  }
  json(res, 404, { error: 'not found' });
});

const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 256 * 1024 });

wss.on('connection', (ws, req) => {
  if (!originAllowed(req.headers.origin)) {
    log.warn('rejected origin', { origin: req.headers.origin });
    ws.close(4003, 'origin not allowed');
    return;
  }

  const ip = (req.headers['x-forwarded-for'] || '').toString().split(',')[0].trim() || req.socket.remoteAddress;
  const client = hub.addConnection(ws, { ip });
  ws.isAlive = true;

  ws.on('message', (data) => hub.handle(client, data.toString()));
  ws.on('pong', () => {
    ws.isAlive = true;
  });
  ws.on('error', (err) => log.warn('socket error', { id: client.id, err: String(err) }));
  ws.on('close', () => hub.removeConnection(client));
});

// Drop sockets that stopped answering — mobile browsers vanish without a FIN.
const heartbeat = setInterval(() => {
  for (const ws of wss.clients) {
    if (ws.isAlive === false) {
      ws.terminate();
      continue;
    }
    ws.isAlive = false;
    try {
      ws.ping();
    } catch {
      ws.terminate();
    }
  }
}, 30_000);
if (typeof heartbeat.unref === 'function') heartbeat.unref();

server.listen(PORT, HOST, () => {
  log.info(`PlayHub server listening on http://${HOST}:${PORT}`);
  log.info(`  websocket   ws://${HOST}:${PORT}/ws`);
  log.info(`  static      ${SERVE_STATIC ? WEB_ROOT : 'disabled'}`);
  log.info(`  origins     ${ALLOWED_ORIGINS.length ? ALLOWED_ORIGINS.join(', ') : 'any'}`);
});

function shutdown(signal) {
  log.info(`${signal} received — shutting down`);
  clearInterval(heartbeat);
  hub.stop();
  for (const ws of wss.clients) {
    try {
      ws.close(1001, 'server shutting down');
    } catch {
      /* already gone */
    }
  }
  server.close(() => process.exit(0));
  // Never hang a deploy on a stuck socket.
  setTimeout(() => process.exit(0), 5000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('unhandledRejection', (err) => log.error('unhandled rejection', { err: String(err) }));

export { hub, server, wss };
