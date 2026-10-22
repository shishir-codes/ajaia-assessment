// Local stand in for Vercel's /api routing: serves the same handlers in api/*.js on
// http://127.0.0.1:5288. Vite proxies /api here (see vite.config.js). Run: npm run dev
import { existsSync } from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { parse as parseQuery } from 'node:querystring';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));

// Same rule as Vercel: api/<name>.js is a route, files and folders starting with _ are not.
const ROUTE = /^\/api\/([a-z0-9][a-z0-9-]*)\/?$/i;

export function createDevApiServer() {
  return http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const match = ROUTE.exec(url.pathname);
    const file = match ? path.join(root, 'api', `${match[1]}.js`) : null;
    if (!file || !existsSync(file)) {
      res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: false, error: 'Not found.', code: 'not_found' }));
      return;
    }
    try {
      const { default: handler } = await import(pathToFileURL(file).href);
      // Vercel adds this helper too; repeated keys become arrays, as they do there.
      req.query = parseQuery(url.search.slice(1));
      await handler(req, res);
    } catch (err) {
      console.error('[dev-api] handler crashed:', err);
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: false, error: 'Internal error.', code: 'internal_error' }));
      } else {
        res.end();
      }
    }
  });
}

export function startDevApi({ port = Number(process.env.DEV_API_PORT) || 5288, host = '127.0.0.1' } = {}) {
  return new Promise((resolve, reject) => {
    const server = createDevApiServer();
    server.once('error', reject);
    server.listen(port, host, () => resolve(server));
  });
}

function describeDatabase() {
  if (String(process.env.DATABASE_URL || process.env.POSTGRES_URL || '').trim()) return 'database: Neon (DATABASE_URL)';
  return `database: PGlite at ${String(process.env.PGLITE_DIR || '').trim() || '.data/pglite'}`;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase();
if (isMain) {
  // Only when run directly: .env.local first, then .env (values already set in the shell win).
  // Tests import this file and must never pick up a real DATABASE_URL from these files.
  for (const file of ['.env.local', '.env']) {
    const full = path.join(root, file);
    if (existsSync(full)) process.loadEnvFile(full);
  }
  startDevApi()
    .then((server) => {
      const { address, port } = server.address();
      console.log(`[dev-api] serving api/*.js at http://${address}:${port}/api (${describeDatabase()})`);
    })
    .catch((err) => {
      console.error(`[dev-api] could not start: ${err.message}`);
      process.exit(1);
    });
}
