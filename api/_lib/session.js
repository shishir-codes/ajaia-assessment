// Mocked sign in, enforced on the server. The cookie ajaia_session holds "<userId>.<hmac>", where
// hmac = HMAC-SHA256(userId, SESSION_SECRET) in base64url. No passwords: any seeded user can sign in.
import { createHmac, timingSafeEqual } from 'node:crypto';
import { unauthenticated } from './errors.js';
import { query } from './db.js';
import { log } from './log.js';

export const COOKIE_NAME = 'ajaia_session';
const MAX_AGE_SECONDS = 7 * 24 * 60 * 60;
const DEV_SECRET = 'dev-only-secret';
const VALUE_PATTERN = /^([A-Za-z0-9_-]{1,100})\.([A-Za-z0-9_-]{43})$/;

let warnedAboutSecret = false;

function sessionSecret() {
  const value = String(process.env.SESSION_SECRET || '').trim();
  if (value) return value;
  if (!warnedAboutSecret) {
    warnedAboutSecret = true;
    log('warn', { event: 'session_secret_missing', message: 'SESSION_SECRET is not set, using the local development default. Set it in production.' });
  }
  return DEV_SECRET;
}

function isSecureContext() {
  return process.env.NODE_ENV === 'production' || Boolean(process.env.VERCEL);
}

function signature(userId) {
  return createHmac('sha256', sessionSecret()).update(userId).digest('base64url');
}

export function sessionCookieValue(userId) {
  return `${userId}.${signature(userId)}`;
}

// The user id inside a cookie value when its signature is valid, otherwise null.
export function verifySessionValue(value) {
  const match = VALUE_PATTERN.exec(String(value || ''));
  if (!match) return null;
  const expected = Buffer.from(signature(match[1]));
  const given = Buffer.from(match[2]);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  return match[1];
}

function readCookie(req, name) {
  const header = req.headers?.cookie;
  if (typeof header !== 'string') return null;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() !== name) continue;
    const raw = part.slice(eq + 1).trim();
    try {
      return decodeURIComponent(raw);
    } catch {
      return raw;
    }
  }
  return null;
}

function cookieAttributes(maxAge) {
  const parts = ['Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${maxAge}`];
  if (isSecureContext()) parts.push('Secure');
  return parts.join('; ');
}

export function setSessionCookie(res, userId) {
  res.setHeader('Set-Cookie', `${COOKIE_NAME}=${sessionCookieValue(userId)}; ${cookieAttributes(MAX_AGE_SECONDS)}`);
}

export function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', `${COOKIE_NAME}=; ${cookieAttributes(0)}`);
}

export function hasSessionCookie(req) {
  return readCookie(req, COOKIE_NAME) !== null;
}

// The signed in user ({ id, email, name }) or null. A valid signature for a user that no longer
// exists also counts as signed out.
export async function getSessionUser(req) {
  const userId = verifySessionValue(readCookie(req, COOKIE_NAME));
  if (!userId) return null;
  const rows = await query('SELECT id, email, name FROM users WHERE id = $1', [userId]);
  return rows[0] ? { id: rows[0].id, email: rows[0].email, name: rows[0].name } : null;
}

export async function requireUser(req) {
  const user = await getSessionUser(req);
  if (!user) throw unauthenticated();
  return user;
}
