// Input rules shared by the routes. Each reader returns the clean value or throws an HttpError.
import { invalidInput, tooLarge } from './errors.js';
import { sanitizeContent } from './sanitize.js';

export const TITLE_MAX = 200;
export const CONTENT_MAX = 500_000;
export const DEFAULT_TITLE = 'Untitled document';
export const ROLES = ['viewer', 'editor'];
const MAX_INT = 2147483647;

// Length in characters as people count them (an emoji is one, not two UTF-16 units).
export function charLength(text) {
  let count = 0;
  for (const _ of text) count += 1;
  return count;
}

export function cleanTitle(text) {
  return String(text).replace(/[\u0000-\u001f\u007f]+/g, ' ').trim();
}

// A title the client sent. Returns undefined when the field is absent. With allowEmpty, an empty
// title comes back as '' (creation turns it into the default title).
export function readTitle(value, { allowEmpty = false } = {}) {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') throw invalidInput('The title must be text.');
  const title = cleanTitle(value);
  if (!title) {
    if (allowEmpty) return '';
    throw invalidInput('The title cannot be empty.');
  }
  if (charLength(title) > TITLE_MAX) throw invalidInput(`The title must be ${TITLE_MAX} characters or fewer.`);
  return title;
}

// Document HTML the client sent, sanitized. Returns undefined when the field is absent.
export function readContent(value) {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') throw invalidInput('The content must be an HTML string.');
  if (value.length > CONTENT_MAX) throw tooLarge(`The document is too large (${CONTENT_MAX.toLocaleString('en-US')} characters at most).`);
  const html = sanitizeContent(value);
  if (html.length > CONTENT_MAX) throw tooLarge(`The document is too large (${CONTENT_MAX.toLocaleString('en-US')} characters at most).`);
  return html;
}

export function readId(value, label = 'id') {
  if (typeof value !== 'string' || !value.trim()) throw invalidInput(`Missing ${label}.`);
  const id = value.trim();
  if (id.length > 200) throw invalidInput(`The ${label} is not valid.`);
  return id;
}

export function readVersion(value) {
  if (!Number.isInteger(value) || value < 1 || value > MAX_INT) {
    throw invalidInput('baseVersion is required and must be a whole number (the version you started editing from).');
  }
  return value;
}

export function readEmail(value) {
  if (typeof value !== 'string' || !value.trim()) throw invalidInput('Enter an email address.');
  const email = value.trim().toLowerCase();
  if (email.length > 320) throw invalidInput('That email address is too long.');
  return email;
}

export function readRole(value) {
  const role = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (!ROLES.includes(role)) throw invalidInput('The role must be "viewer" or "editor".');
  return role;
}
