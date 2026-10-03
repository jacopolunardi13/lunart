/**
 * A small fixed-window rate limiter.
 *
 * Mainly for `/api/card/validate`. A code is six characters from a 32-letter
 * alphabet, lives for a minute and can only be used once, so guessing one is
 * already impractical — but "impractical" is a better answer with a ceiling on
 * attempts than without, and a venue scanning cards does not need more than a
 * handful a minute.
 *
 * In memory and per process, which matches a single-process server. Behind more
 * than one instance this becomes per instance; swap the map for a shared store
 * when that day comes.
 */

const buckets = new Map();

export function rateLimit(key, { limit = 20, windowMs = 60_000, now = Date.now() } = {}) {
  const windowStart = Math.floor(now / windowMs) * windowMs;
  const bucketKey = `${key}:${windowStart}`;

  // Sweep anything from an earlier window; the map never needs to grow.
  if (buckets.size > 2000) {
    for (const [existing, entry] of buckets) {
      if (entry.windowStart < windowStart) buckets.delete(existing);
    }
  }

  const entry = buckets.get(bucketKey) ?? { count: 0, windowStart };
  entry.count += 1;
  buckets.set(bucketKey, entry);

  return {
    allowed: entry.count <= limit,
    remaining: Math.max(0, limit - entry.count),
    retryAfterSeconds: Math.ceil((windowStart + windowMs - now) / 1000),
  };
}

/** The caller's address, as far as we can tell behind a proxy we control. */
export function clientKey(req) {
  const forwarded = String(req.headers['x-forwarded-for'] ?? '').split(',')[0].trim();
  return forwarded || req.socket?.remoteAddress || 'unknown';
}

export const resetRateLimits = () => buckets.clear();
