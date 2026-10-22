// GET /api/users: the seeded user directory, for the sign in screen and the share dialog.
import { query } from './_lib/db.js';
import { route, sendJson } from './_lib/http.js';

export default route({
  async GET(req, res) {
    const users = await query('SELECT id, email, name FROM users ORDER BY name, id');
    sendJson(res, 200, { ok: true, users: users.map(({ id, email, name }) => ({ id, email, name })) });
  },
});
