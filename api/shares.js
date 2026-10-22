// /api/shares: who has access (GET, anyone with access), share or change a role (POST, owner),
// remove access (DELETE, owner).
import { query } from './_lib/db.js';
import { requireDocument } from './_lib/documents.js';
import { HttpError, invalidInput, notFound } from './_lib/errors.js';
import { queryParam, readJsonBody, route, sendJson } from './_lib/http.js';
import { limitShareChanges } from './_lib/limits.js';
import { requireUser } from './_lib/session.js';
import { readEmail, readId, readRole } from './_lib/validate.js';

const OWNER_ONLY = 'Only the owner can change who has access.';

function iso(value) {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function toShare(row) {
  return { userId: row.user_id, email: row.email, name: row.name, role: row.role, createdAt: iso(row.created_at) };
}

export default route({
  async GET(req, res) {
    const user = await requireUser(req);
    const documentId = readId(queryParam(req, 'documentId'), 'documentId');
    const doc = await requireDocument(documentId, user.id, 'read');
    const [ownerRows, shareRows] = await Promise.all([
      query('SELECT id, email, name FROM users WHERE id = $1', [doc.owner_id]),
      query(
        `SELECT s.user_id, u.email, u.name, s.role, s.created_at
          FROM document_shares s JOIN users u ON u.id = s.user_id
          WHERE s.document_id = $1
          ORDER BY s.created_at, u.name`,
        [documentId],
      ),
    ]);
    const owner = ownerRows[0];
    sendJson(res, 200, {
      ok: true,
      owner: { id: owner.id, email: owner.email, name: owner.name },
      shares: shareRows.map(toShare),
    });
  },

  async POST(req, res) {
    const user = await requireUser(req);
    limitShareChanges(user.id);
    const body = await readJsonBody(req);
    const documentId = readId(body.documentId, 'documentId');
    const email = readEmail(body.email);
    const role = readRole(body.role);
    const doc = await requireDocument(documentId, user.id, 'share', OWNER_ONLY);
    const [target] = await query('SELECT id, email, name FROM users WHERE lower(email) = $1', [email]);
    if (!target) throw new HttpError(404, 'unknown_user', 'There is no user with that email in this workspace.');
    if (target.id === doc.owner_id) throw invalidInput('You already own this document.');
    let row;
    try {
      [row] = await query(
        `INSERT INTO document_shares (document_id, user_id, role) VALUES ($1, $2, $3)
          ON CONFLICT (document_id, user_id) DO UPDATE SET role = EXCLUDED.role
          RETURNING user_id, role, created_at`,
        [documentId, target.id, role],
      );
    } catch (err) {
      // The document was deleted between the permission check and the insert.
      if (err?.code === '23503') throw notFound();
      throw err;
    }
    sendJson(res, 201, { ok: true, share: toShare({ ...row, email: target.email, name: target.name }) });
  },

  async DELETE(req, res) {
    const user = await requireUser(req);
    limitShareChanges(user.id);
    const documentId = readId(queryParam(req, 'documentId'), 'documentId');
    const userId = readId(queryParam(req, 'userId'), 'userId');
    await requireDocument(documentId, user.id, 'share', OWNER_ONLY);
    const rows = await query('DELETE FROM document_shares WHERE document_id = $1 AND user_id = $2 RETURNING user_id', [
      documentId,
      userId,
    ]);
    // Removing access that is already gone is not an error, so a retried request is harmless.
    sendJson(res, 200, { ok: true, removed: rows.length > 0 });
  },
});
