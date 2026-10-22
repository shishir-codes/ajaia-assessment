// Document reads and writes plus the permission rules, shared by the document routes.
import { randomUUID } from 'node:crypto';
import { forbidden, HttpError, notFound } from './errors.js';
import { query } from './db.js';
import { CREATE_WINDOW_MINUTES, documentLimitReached, limitValue, rateLimited } from './limits.js';

// What each role may do. "No access" is not a role: it is answered with 404 so existence is not revealed.
export const can = {
  read: (role) => role === 'owner' || role === 'editor' || role === 'viewer',
  edit: (role) => role === 'owner' || role === 'editor',
  share: (role) => role === 'owner',
  delete: (role) => role === 'owner',
};

function iso(value) {
  if (value === null || value === undefined) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toISOString();
}

export function toSummary(row) {
  return {
    id: row.id,
    title: row.title,
    ownerId: row.owner_id,
    ownerName: row.owner_name,
    role: row.role,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
    updatedByName: row.updated_by_name ?? null,
  };
}

export function toDocument(row) {
  return { ...toSummary(row), content: row.content, version: Number(row.version) };
}

// $1 = document id, $2 = current user id. role is null when the user has no access.
const DOCUMENT_FOR_USER = `SELECT d.id, d.title, d.content, d.version, d.owner_id, o.name AS owner_name,
    d.created_at, d.updated_at, ub.name AS updated_by_name,
    CASE WHEN d.owner_id = $2 THEN 'owner' ELSE s.role END AS role
  FROM documents d
  JOIN users o ON o.id = d.owner_id
  LEFT JOIN users ub ON ub.id = d.updated_by
  LEFT JOIN document_shares s ON s.document_id = d.id AND s.user_id = $2
  WHERE d.id = $1`;

// The document row with the caller's role, or null when it is missing or not shared with them.
export async function findDocumentForUser(id, userId) {
  const [row] = await query(DOCUMENT_FOR_USER, [id, userId]);
  return row && row.role ? row : null;
}

// Like findDocumentForUser, but throws 404 for no access and 403 when the role is not enough.
export async function requireDocument(id, userId, action = 'read', message = 'You do not have permission to do that.') {
  const row = await findDocumentForUser(id, userId);
  if (!row) throw notFound();
  if (!can[action](row.role)) throw forbidden(message);
  return row;
}

export async function listDocumentsFor(userId) {
  const rows = await query(
    `SELECT d.id, d.title, d.owner_id, o.name AS owner_name, d.created_at, d.updated_at,
        ub.name AS updated_by_name,
        CASE WHEN d.owner_id = $1 THEN 'owner' ELSE s.role END AS role
      FROM documents d
      JOIN users o ON o.id = d.owner_id
      LEFT JOIN users ub ON ub.id = d.updated_by
      LEFT JOIN document_shares s ON s.document_id = d.id AND s.user_id = $1
      WHERE d.owner_id = $1 OR s.user_id IS NOT NULL
      ORDER BY d.updated_at DESC, d.id`,
    [userId],
  );
  const summaries = rows.map(toSummary);
  return {
    owned: summaries.filter((doc) => doc.role === 'owner'),
    shared: summaries.filter((doc) => doc.role !== 'owner'),
  };
}

const RECENT = `created_at > now() - interval '${CREATE_WINDOW_MINUTES} minutes'`;

// The insert only happens while the owner is under both demo limits, checked in the same statement.
const INSERT_IF_ALLOWED = `INSERT INTO documents (id, owner_id, title, content, updated_by)
  SELECT $1, $2, $3, $4, $2
  WHERE (SELECT count(*) FROM documents WHERE owner_id = $2) < $5
    AND (SELECT count(*) FROM documents WHERE owner_id = $2 AND ${RECENT}) < $6
  RETURNING id`;

// How many documents the user owns, how many of them are recent, and (when the recent count is at the
// limit) how many seconds until the oldest one that matters leaves the window. $2 = the rate limit.
const USAGE = `SELECT count(*)::int AS owned,
    count(*) FILTER (WHERE ${RECENT})::int AS recent,
    (SELECT GREATEST(1, CEIL(EXTRACT(EPOCH FROM (r.created_at + interval '${CREATE_WINDOW_MINUTES} minutes' - now()))))::int
      FROM documents r WHERE r.owner_id = $1 AND r.${RECENT}
      ORDER BY r.created_at DESC OFFSET $2 - 1 LIMIT 1) AS retry_after
  FROM documents WHERE owner_id = $1`;

function createLimits() {
  return { maxDocs: limitValue('DEMO_MAX_DOCS'), perWindow: limitValue('DEMO_CREATE_PER_10_MIN') };
}

// Throws 403 limit_reached at the document cap, or 429 rate_limited when too many documents were
// created in the last 10 minutes. The cap comes first because waiting does not help there.
export async function assertCanCreate(userId) {
  const { maxDocs, perWindow } = createLimits();
  const [usage] = await query(USAGE, [userId, perWindow]);
  if (Number(usage?.owned) >= maxDocs) throw documentLimitReached(maxDocs);
  if (Number(usage?.recent) >= perWindow) throw rateLimited(usage?.retry_after || CREATE_WINDOW_MINUTES * 60);
}

export async function createDocument(user, title, content) {
  const id = randomUUID();
  const { maxDocs, perWindow } = createLimits();
  const inserted = await query(INSERT_IF_ALLOWED, [id, user.id, title, content, maxDocs, perWindow]);
  if (!inserted.length) {
    await assertCanCreate(user.id);
    // Under the limits again (a document was deleted in between): one more try, then give up.
    const retried = await query(INSERT_IF_ALLOWED, [id, user.id, title, content, maxDocs, perWindow]);
    if (!retried.length) throw rateLimited(5);
  }
  const row = await findDocumentForUser(id, user.id);
  if (!row) throw new HttpError(500, 'internal_error', 'The document was created but could not be read back.');
  return toDocument(row);
}

// Optimistic concurrency: the update only applies when the stored version still equals
// baseVersion and the caller may edit. One statement, so two saves can never both win.
export async function updateDocument(id, user, { title, content, baseVersion }) {
  const [row] = await query(
    `WITH updated AS (
        UPDATE documents d
          SET title = COALESCE($3, d.title),
              content = COALESCE($4, d.content),
              version = d.version + 1,
              updated_at = now(),
              updated_by = $2
          WHERE d.id = $1 AND d.version = $5
            AND (d.owner_id = $2 OR EXISTS (
              SELECT 1 FROM document_shares s
              WHERE s.document_id = d.id AND s.user_id = $2 AND s.role = 'editor'))
          RETURNING d.*
      )
      SELECT u.id, u.title, u.content, u.version, u.owner_id, o.name AS owner_name,
          u.created_at, u.updated_at, ub.name AS updated_by_name,
          CASE WHEN u.owner_id = $2 THEN 'owner' ELSE 'editor' END AS role
        FROM updated u
        JOIN users o ON o.id = u.owner_id
        LEFT JOIN users ub ON ub.id = u.updated_by`,
    [id, user.id, title ?? null, content ?? null, baseVersion],
  );
  if (row) return toDocument(row);

  // Nothing changed: work out why, from the latest state.
  const latest = await findDocumentForUser(id, user.id);
  if (!latest) throw notFound();
  if (!can.edit(latest.role)) throw forbidden('You can view this document but not edit it.');
  throw new HttpError(409, 'version_conflict', 'Someone else saved this document after you opened it.', {
    document: toDocument(latest),
  });
}

export async function deleteDocument(id, user) {
  const rows = await query('DELETE FROM documents WHERE id = $1 AND owner_id = $2 RETURNING id', [id, user.id]);
  if (rows.length) return;
  const latest = await findDocumentForUser(id, user.id);
  if (!latest) throw notFound();
  throw forbidden('Only the owner can delete this document.');
}
