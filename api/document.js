// /api/document?id=: read (GET), save title and or content (PATCH, optimistic concurrency), delete (DELETE).
import { deleteDocument, requireDocument, toDocument, updateDocument } from './_lib/documents.js';
import { invalidInput } from './_lib/errors.js';
import { queryParam, readJsonBody, route, sendJson } from './_lib/http.js';
import { limitSaves } from './_lib/limits.js';
import { requireUser } from './_lib/session.js';
import { readContent, readId, readTitle, readVersion } from './_lib/validate.js';

export default route({
  async GET(req, res) {
    const user = await requireUser(req);
    const id = readId(queryParam(req, 'id'), 'document id');
    const row = await requireDocument(id, user.id, 'read');
    sendJson(res, 200, { ok: true, document: toDocument(row) });
  },

  async PATCH(req, res) {
    const user = await requireUser(req);
    limitSaves(user.id);
    const id = readId(queryParam(req, 'id'), 'document id');
    const body = await readJsonBody(req);
    const baseVersion = readVersion(body.baseVersion);
    const title = readTitle(body.title);
    const content = readContent(body.content);
    if (title === undefined && content === undefined) throw invalidInput('Send a title, content or both to save.');
    const document = await updateDocument(id, user, { title, content, baseVersion });
    sendJson(res, 200, { ok: true, document });
  },

  async DELETE(req, res) {
    const user = await requireUser(req);
    const id = readId(queryParam(req, 'id'), 'document id');
    await deleteDocument(id, user);
    sendJson(res, 200, { ok: true, id });
  },
});
