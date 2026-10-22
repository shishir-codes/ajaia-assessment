// Restores the two seeded demo documents and their shares (used by scripts/reset-demo.mjs, never by a
// route). Title, content, owner and shares go back exactly as seeded; a deleted demo document comes back
// under its old id, so old links work again. The version keeps counting up instead of going back to 1,
// so a reviewer who still has the document open gets a conflict instead of silently overwriting it.
// Other documents are not touched. Safe to run again: a second run restores the same state.
import { randomUUID } from 'node:crypto';
import { query } from './db.js';
import { NOTES_DOC, SEED_USERS, WELCOME_DOC } from './seed.js';

export const DEMO_DOCUMENTS = [
  { key: 'demo_welcome_id', ownerId: 'u_alice', doc: WELCOME_DOC, share: { userId: 'u_bob', role: 'editor' } },
  { key: 'demo_notes_id', ownerId: 'u_bob', doc: NOTES_DOC, share: { userId: 'u_alice', role: 'viewer' } },
];

// One statement per document, so a document and its shares are restored together or not at all.
const RESTORE = `WITH upsert AS (
    INSERT INTO documents (id, owner_id, title, content, version, updated_by)
    VALUES ($1, $2, $3, $4, 1, $2)
    ON CONFLICT (id) DO UPDATE SET title = EXCLUDED.title, content = EXCLUDED.content,
      version = documents.version + 1, updated_at = now(), updated_by = EXCLUDED.updated_by
      WHERE documents.owner_id = EXCLUDED.owner_id
    RETURNING id, version
  ), removed AS (
    DELETE FROM document_shares WHERE document_id IN (SELECT id FROM upsert) AND user_id <> $5 RETURNING user_id
  ), shared AS (
    INSERT INTO document_shares (document_id, user_id, role) SELECT id, $5, $6 FROM upsert
    ON CONFLICT (document_id, user_id) DO UPDATE SET role = EXCLUDED.role
    RETURNING role
  ), remember AS (
    INSERT INTO meta (key, value) SELECT $7, id FROM upsert
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value
    RETURNING value
  )
  SELECT (SELECT id FROM upsert) AS id, (SELECT version FROM upsert) AS version,
    (SELECT count(*) FROM removed)::int AS removed_shares`;

// The id the seed used. Databases seeded before ids were remembered fall back to the oldest document
// with the seed title and owner; if there is none, the document is created again with a new id.
async function demoDocumentId(spec) {
  const [remembered] = await query('SELECT value FROM meta WHERE key = $1', [spec.key]);
  if (remembered?.value) return remembered.value;
  const [match] = await query(
    'SELECT id FROM documents WHERE owner_id = $1 AND title = $2 ORDER BY created_at, id LIMIT 1',
    [spec.ownerId, spec.doc.title],
  );
  return match?.id || randomUUID();
}

const nameOf = (id) => SEED_USERS.find((user) => user.id === id)?.name || id;

export async function resetDemo() {
  const results = [];
  for (const spec of DEMO_DOCUMENTS) {
    const id = await demoDocumentId(spec);
    const [row] = await query(RESTORE, [
      id,
      spec.ownerId,
      spec.doc.title,
      spec.doc.content,
      spec.share.userId,
      spec.share.role,
      spec.key,
    ]);
    if (!row?.id) throw new Error(`Could not restore "${spec.doc.title}" (id ${id}).`);
    results.push({
      id: row.id,
      title: spec.doc.title,
      owner: nameOf(spec.ownerId),
      sharedWith: `${nameOf(spec.share.userId)} as ${spec.share.role}`,
      version: Number(row.version),
      removedShares: Number(row.removed_shares),
    });
  }
  return results;
}
