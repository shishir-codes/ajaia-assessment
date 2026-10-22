// GET /api/health: liveness plus which database is in use. Used by deploy checks.
import { dbKind, query } from './_lib/db.js';
import { HttpError } from './_lib/errors.js';
import { route, sendError, sendJson } from './_lib/http.js';
import { log, scrub } from './_lib/log.js';

async function health(req, res) {
  try {
    await query('SELECT 1 AS ok');
    sendJson(res, 200, { ok: true, db: await dbKind() });
  } catch (err) {
    if (err instanceof HttpError) throw err;
    log('error', { event: 'health_db_error', message: scrub(err?.message), pgCode: err?.code });
    sendError(res, 503, 'db_unavailable', 'The database is not reachable right now.');
  }
}

export default route({ GET: health, HEAD: health });
