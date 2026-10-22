// /api/session: who is signed in (GET), sign in as a seeded user by email (POST), sign out (DELETE).
import { query } from './_lib/db.js';
import { HttpError } from './_lib/errors.js';
import { readJsonBody, route, sendJson } from './_lib/http.js';
import { limitSignIns } from './_lib/limits.js';
import { clearSessionCookie, getSessionUser, hasSessionCookie, setSessionCookie } from './_lib/session.js';
import { readEmail } from './_lib/validate.js';

export default route({
  async GET(req, res) {
    const user = await getSessionUser(req);
    // A cookie that no longer verifies (old secret, tampered) is cleared so the browser stops sending it.
    if (!user && hasSessionCookie(req)) clearSessionCookie(res);
    sendJson(res, 200, { ok: true, user });
  },

  async POST(req, res) {
    limitSignIns(req);
    const body = await readJsonBody(req);
    const email = readEmail(body.email);
    const [user] = await query('SELECT id, email, name FROM users WHERE lower(email) = $1', [email]);
    if (!user) throw new HttpError(404, 'unknown_user', 'There is no demo account with that email.');
    setSessionCookie(res, user.id);
    sendJson(res, 200, { ok: true, user: { id: user.id, email: user.email, name: user.name } });
  },

  async DELETE(req, res) {
    clearSessionCookie(res);
    sendJson(res, 200, { ok: true });
  },
});
