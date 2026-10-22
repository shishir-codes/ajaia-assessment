// POST /api/import { filename, contentBase64 }: turns a .txt, .md or .docx file (2 MB at most)
// into a NEW document owned by the caller.
import { assertCanCreate, createDocument } from './_lib/documents.js';
import { HttpError, invalidInput } from './_lib/errors.js';
import { readJsonBody, route, sendJson } from './_lib/http.js';
import { decodeBase64, fileKind, fileToHtml, titleFromFilename } from './_lib/importers.js';
import { requireUser } from './_lib/session.js';

export default route({
  async POST(req, res) {
    const user = await requireUser(req);
    const body = await readJsonBody(req);
    const filename = typeof body.filename === 'string' ? body.filename.trim() : '';
    if (!filename) throw invalidInput('Missing filename.');
    if (filename.length > 1000) throw invalidInput('The file name is too long.');
    // An empty string is a real (empty) file and gets 422 below; only a missing field is 400.
    if (typeof body.contentBase64 !== 'string') throw invalidInput('Missing contentBase64 (the file contents in base64).');
    const kind = fileKind(filename);
    if (!kind) throw new HttpError(415, 'unsupported_type', 'Only .txt, .md and .docx files can be imported.');
    // Check the demo limits before the (slower) file parsing; createDocument checks them again atomically.
    await assertCanCreate(user.id);
    const bytes = decodeBase64(body.contentBase64);
    const content = await fileToHtml(kind, bytes);
    const document = await createDocument(user, titleFromFilename(filename), content);
    sendJson(res, 201, { ok: true, document });
  },
});
