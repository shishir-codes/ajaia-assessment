// Public demo safeguards. Reviewers share one database, so every user gets fair, fixed limits:
//   - at most DEMO_MAX_DOCS owned documents (default 100), checked in the database
//   - at most DEMO_CREATE_PER_10_MIN new documents per 10 minutes (default 20, create and import
//     together), counted from documents.created_at in the database
//   - in memory, per server instance: saves per user per minute (DEMO_SAVES_PER_MIN, default 120),
//     share changes per user per minute (DEMO_SHARES_PER_MIN, default 30) and sign ins per IP
//     address per minute (DEMO_SIGNINS_PER_MIN, default 20)
// Values are read on every call, so tests can lower them through the environment.
import { HttpError } from './errors.js';

export const RATE_LIMIT_MESSAGE = 'You are making changes very quickly. Please wait a moment and try again.';
export const CREATE_WINDOW_MINUTES = 10;

const DEFAULTS = {
  DEMO_MAX_DOCS: 100,
  DEMO_CREATE_PER_10_MIN: 20,
  DEMO_SAVES_PER_MIN: 120,
  DEMO_SHARES_PER_MIN: 30,
  DEMO_SIGNINS_PER_MIN: 20,
};

// A positive whole number from the environment, or the default. Junk values fall back to the default
// so a typo can never switch a limit off.
export function limitValue(name) {
  const raw = String(process.env[name] ?? '').trim();
  const value = /^\d+$/.test(raw) ? Number(raw) : NaN;
  return Number.isSafeInteger(value) && value > 0 ? value : DEFAULTS[name];
}

export function rateLimited(retryAfterSeconds) {
  const seconds = Math.max(1, Math.ceil(Number(retryAfterSeconds) || 1));
  return new HttpError(429, 'rate_limited', RATE_LIMIT_MESSAGE, { retryAfter: seconds }, { 'Retry-After': String(seconds) });
}

export function documentLimitReached(max) {
  return new HttpError(
    403,
    'limit_reached',
    `You have reached the demo limit of ${max} documents. Delete one to create another.`,
  );
}

// Sliding window counters kept in this process's memory: key -> sorted list of hit times (ms).
// Only allowed requests are counted, so someone who is held back recovers once the window passes.
const buckets = new Map();
const MAX_BUCKETS = 10000;

function prune(now, windowMs) {
  for (const [key, hits] of buckets) {
    if (!hits.length || hits[hits.length - 1] <= now - windowMs) buckets.delete(key);
  }
}

// Records one hit for `key`, or throws 429 rate_limited (with Retry-After) when `max` hits already
// happened in the last `windowMs` milliseconds.
export function takeHit(key, max, windowMs = 60000, now = Date.now()) {
  if (buckets.size > MAX_BUCKETS) prune(now, windowMs);
  const cutoff = now - windowMs;
  const hits = (buckets.get(key) || []).filter((time) => time > cutoff);
  if (hits.length >= max) {
    buckets.set(key, hits);
    throw rateLimited((hits[hits.length - max] + windowMs - now) / 1000);
  }
  hits.push(now);
  buckets.set(key, hits);
}

export function resetRateLimitsForTests() {
  buckets.clear();
}

// The caller's IP address. On Vercel the platform sets x-forwarded-for itself (a client value is
// overwritten), so it is trusted there. Anywhere else the socket address is used, so a client cannot
// dodge the sign in limit by sending a made up header.
export function clientIp(req) {
  if (process.env.VERCEL) {
    const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
    const real = String(req.headers['x-real-ip'] || '').trim();
    if (forwarded || real) return forwarded || real;
  }
  return req.socket?.remoteAddress || 'unknown';
}

export const limitSaves = (userId) => takeHit(`save:${userId}`, limitValue('DEMO_SAVES_PER_MIN'));
export const limitShareChanges = (userId) => takeHit(`share:${userId}`, limitValue('DEMO_SHARES_PER_MIN'));
export const limitSignIns = (req) => takeHit(`signin:${clientIp(req)}`, limitValue('DEMO_SIGNINS_PER_MIN'));
