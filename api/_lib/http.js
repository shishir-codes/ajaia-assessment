// Request and response helpers for the /api functions. They work on Vercel's Node runtime
// (which may already have parsed req.body) and on a plain Node http server (dev-api.mjs, tests).
import { HttpError } from './errors.js';
import { log, scrub } from './log.js';

// Vercel rejects bodies over 4.5 MB before our code runs; locally we stop at 4 MB.
export const MAX_BODY_BYTES = 4 * 1024 * 1024;

export function sendJson(res, status, payload, headers = {}) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  for (const [name, value] of Object.entries(headers)) res.setHeader(name, value);
  res.end(JSON.stringify(payload));
}

export function sendError(res, status, code, message, extra = {}, headers = {}) {
  sendJson(res, status, { ...extra, ok: false, error: message, code }, headers);
}

// One query string value as a string, or undefined. Uses Vercel's req.query when present.
export function queryParam(req, name) {
  let value = req.query ? req.query[name] : undefined;
  if (value === undefined) {
    try {
      value = new URL(req.url || '/', 'http://localhost').searchParams.get(name) ?? undefined;
    } catch {
      value = undefined;
    }
  }
  if (Array.isArray(value)) value = value[0];
  return typeof value === 'string' ? value : undefined;
}

function parseJson(raw) {
  if (!raw.trim()) return {};
  try {
    return JSON.parse(raw);
  } catch {
    throw new HttpError(400, 'invalid_input', 'The request body is not valid JSON.');
  }
}

async function readRawBody(req) {
  const type = String(req.headers['content-type'] || '').toLowerCase();
  if (!type.includes('application/json')) {
    throw new HttpError(415, 'unsupported_media_type', 'Send the body as JSON with Content-Type: application/json.');
  }

  // Vercel parses JSON lazily into req.body, and reading it throws if the JSON is malformed.
  if ('body' in req) {
    let body;
    try {
      body = req.body;
    } catch {
      throw new HttpError(400, 'invalid_input', 'The request body is not valid JSON.');
    }
    if (typeof body === 'string' || Buffer.isBuffer(body)) return parseJson(body.toString('utf8'));
    return body === undefined || body === null ? {} : body;
  }

  // Plain Node http: read the stream ourselves, with a size cap.
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new HttpError(413, 'too_large', 'The request body is too large (4 MB at most).');
    chunks.push(chunk);
  }
  return parseJson(Buffer.concat(chunks).toString('utf8'));
}

// The JSON body as a plain object. Arrays, strings and numbers are rejected.
export async function readJsonBody(req) {
  const body = await readRawBody(req);
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new HttpError(400, 'invalid_input', 'The request body must be a JSON object.');
  }
  return body;
}

// Builds a handler that dispatches on the method. HttpError becomes its JSON error, anything
// else is logged (without request data) and answered with a generic 500.
export function route(handlers) {
  const allowed = Object.keys(handlers);
  return async function handler(req, res) {
    const run = handlers[req.method];
    if (!run) {
      sendError(res, 405, 'method_not_allowed', `Use ${allowed.join(' or ')} for this endpoint.`, {}, { Allow: allowed.join(', ') });
      return;
    }
    try {
      await run(req, res);
    } catch (err) {
      if (err instanceof HttpError) {
        if (!res.headersSent) sendError(res, err.status, err.code, err.message, err.extra, err.headers);
        return;
      }
      log('error', {
        event: 'unhandled_error',
        method: req.method,
        path: String(req.url || '').split('?')[0],
        message: scrub(err?.message),
        pgCode: err?.code,
      });
      if (!res.headersSent) sendError(res, 500, 'internal_error', 'Something went wrong on the server. Please try again.');
      else res.end();
    }
  };
}
