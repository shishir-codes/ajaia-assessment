// /api/documents: the signed in user's documents (GET) and creating a new one (POST).
import { createDocument, listDocumentsFor } from './_lib/documents.js';
import { readJsonBody, route, sendJson } from './_lib/http.js';
import { requireUser } from './_lib/session.js';
import { DEFAULT_TITLE, readContent, readTitle } from './_lib/validate.js';

export default route({
  async GET(req, res) {
    const user = await requireUser(req);
    const { owned, shared } = await listDocumentsFor(user.id);
    sendJson(res, 200, { ok: true, owned, shared });
  },

  async POST(req, res) {
    const user = await requireUser(req);
    const body = await readJsonBody(req);
    const title = readTitle(body.title, { allowEmpty: true }) || DEFAULT_TITLE;
    const content = readContent(body.content) ?? '';
    const document = await createDocument(user, title, content);
    sendJson(res, 201, { ok: true, document });
  },
});
