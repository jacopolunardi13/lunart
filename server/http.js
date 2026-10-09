/**
 * The small amount of HTTP plumbing this needs.
 *
 * No framework: the server has a dozen routes and serves a static directory, and a
 * router that fits on one screen is easier to audit than one that does not.
 */

import { createHash, timingSafeEqual } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.md': 'text/markdown; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
};

/** Bodies are capped: an unbounded read is a free denial of service. */
export const MAX_BODY_BYTES = 256 * 1024;

/**
 * Two secrets compared in constant time, whatever their lengths (both are hashed
 * first). An empty value never matches, so an unset variable cannot be "guessed"
 * by sending nothing.
 */
export function sameSecret(given, expected) {
  if (!given || !expected) return false;
  const a = createHash('sha256').update(String(given)).digest();
  const b = createHash('sha256').update(String(expected)).digest();
  return timingSafeEqual(a, b);
}

export function readRawBody(req, limit = MAX_BODY_BYTES) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(Object.assign(new Error('request body too large'), { statusCode: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

export async function readJson(req, limit = MAX_BODY_BYTES) {
  const raw = await readRawBody(req, limit);
  if (raw.length === 0) return {};
  try {
    return JSON.parse(raw.toString('utf8'));
  } catch {
    throw Object.assign(new Error('request body is not valid JSON'), { statusCode: 400 });
  }
}

export function sendJson(res, status, payload, headers = {}) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    // This API is only ever called by the guide itself and by a venue's phone.
    'x-content-type-options': 'nosniff',
    ...headers,
  }).end(body);
}

export function sendHtml(res, status, html, headers = {}) {
  res.writeHead(status, {
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    ...headers,
  }).end(html);
}

export const sendText = (res, status, text) =>
  res.writeHead(status, { 'content-type': 'text/plain; charset=utf-8' }).end(text);

export function redirect(res, location) {
  res.writeHead(302, { location, 'cache-control': 'no-store' }).end();
}

/** Serve a file from `root`, refusing anything that climbs out of it. */
export async function serveStatic(req, res, root, pathname) {
  let path = join(root, normalize(decodeURIComponent(pathname)));
  if (!path.startsWith(root)) {
    sendText(res, 403, 'Forbidden');
    return true;
  }
  try {
    const info = await stat(path);
    if (info.isDirectory()) path = join(path, 'index.html');
    const body = await readFile(path);
    res.writeHead(200, {
      'content-type': TYPES[extname(path)] ?? 'application/octet-stream',
      'cache-control': extname(path) === '.html' ? 'no-cache' : 'public, max-age=300',
    }).end(body);
    return true;
  } catch {
    return false;
  }
}

/**
 * Routes are `[method, pattern, handler]`, where a pattern segment starting with
 * `:` captures. Matching is exact on segment count — no accidental prefix matches.
 */
export function matchRoute(routes, method, pathname) {
  const parts = pathname.split('/').filter(Boolean);
  for (const [routeMethod, pattern, handler] of routes) {
    if (routeMethod !== method) continue;
    const patternParts = pattern.split('/').filter(Boolean);
    if (patternParts.length !== parts.length) continue;
    const params = {};
    let matched = true;
    for (let i = 0; i < patternParts.length; i++) {
      const segment = patternParts[i];
      if (segment.startsWith(':')) params[segment.slice(1)] = decodeURIComponent(parts[i]);
      else if (segment !== parts[i]) { matched = false; break; }
    }
    if (matched) return { handler, params };
  }
  return null;
}

/** Escape text going into a server-rendered page. */
export const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));
