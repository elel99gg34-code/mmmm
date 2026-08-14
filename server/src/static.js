/**
 * A small static file server for the web client.
 *
 * Running `npm start` serves the site and the WebSocket from the same origin,
 * which means local development needs no proxy and self-hosting needs no
 * second service. When the client is on GitHub Pages this simply goes unused.
 */
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
};

/** Resolve a URL path to a file inside `root`, or null if it escapes. */
export function resolveSafe(root, urlPath) {
  let decoded;
  try {
    decoded = decodeURIComponent(urlPath.split('?')[0].split('#')[0]);
  } catch {
    return null;
  }
  if (decoded.includes('\0')) return null;
  const rel = normalize(decoded).replace(/^([/\\])+/, '');
  const full = resolve(root, rel);
  const base = resolve(root);
  if (full !== base && !full.startsWith(base + sep)) return null;
  return full;
}

/**
 * Serve `req` from `root`. Returns true when it handled the request.
 * Unknown paths fall back to `index.html` so client-side routing works.
 */
export async function serveStatic(root, req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return false;

  let target = resolveSafe(root, req.url || '/');
  if (!target) {
    res.writeHead(400).end('bad path');
    return true;
  }

  let info = await stat(target).catch(() => null);
  if (info?.isDirectory()) {
    target = join(target, 'index.html');
    info = await stat(target).catch(() => null);
  }
  if (!info?.isFile()) {
    const fallback = join(resolve(root), 'index.html');
    info = await stat(fallback).catch(() => null);
    if (!info?.isFile()) return false;
    target = fallback;
  }

  const ext = extname(target).toLowerCase();
  // The HTML shell must never be cached or a deploy looks broken for an hour;
  // hashed assets are not a thing here, so everything else gets a short TTL.
  const cache = ext === '.html' ? 'no-cache' : 'public, max-age=300';
  res.writeHead(200, {
    'content-type': TYPES[ext] || 'application/octet-stream',
    'content-length': info.size,
    'cache-control': cache,
    'x-content-type-options': 'nosniff',
  });
  if (req.method === 'HEAD') {
    res.end();
    return true;
  }
  createReadStream(target).pipe(res);
  return true;
}
