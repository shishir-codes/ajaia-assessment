// One Postgres helper for every route: query(text, params) -> rows.
// Production: Neon over HTTP when DATABASE_URL (or POSTGRES_URL) is set.
// Local dev and tests: PGlite (Postgres compiled to WASM), loaded with a dynamic import only
// when no connection string is set, stored in PGLITE_DIR (default .data/pglite; tests use memory://).
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { neon } from '@neondatabase/serverless';
import { HttpError } from './errors.js';
import { log } from './log.js';
import { NOTES_DOC, SEED_USERS, WELCOME_DOC } from './seed.js';

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS documents (
    id TEXT PRIMARY KEY,
    owner_id TEXT NOT NULL REFERENCES users(id),
    title TEXT NOT NULL,
    content TEXT NOT NULL DEFAULT '',
    version INTEGER NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_by TEXT REFERENCES users(id)
  )`,
  `CREATE TABLE IF NOT EXISTS document_shares (
    document_id TEXT REFERENCES documents(id) ON DELETE CASCADE,
    user_id TEXT REFERENCES users(id),
    role TEXT NOT NULL CHECK (role IN ('viewer', 'editor')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (document_id, user_id)
  )`,
  `CREATE TABLE IF NOT EXISTS meta (
    key TEXT PRIMARY KEY,
    value TEXT
  )`,
  'CREATE INDEX IF NOT EXISTS documents_owner_idx ON documents (owner_id)',
  'CREATE INDEX IF NOT EXISTS document_shares_user_idx ON document_shares (user_id)',
];

// One round trip that tells us whether the schema is already there (the common warm case).
const SCHEMA_CHECK = `SELECT (to_regclass('users') IS NOT NULL AND to_regclass('documents') IS NOT NULL
  AND to_regclass('document_shares') IS NOT NULL AND to_regclass('meta') IS NOT NULL
  AND to_regclass('documents_owner_idx') IS NOT NULL AND to_regclass('document_shares_user_idx') IS NOT NULL) AS ready`;

// Errors Postgres raises when two cold starts create the same table at the same moment.
const ALREADY_EXISTS = new Set(['42P07', '42710', '23505']);

// Inserts both demo documents and their shares in ONE statement, only if this call is the one
// that claims the "seeded" key. Their ids are kept in meta so scripts/reset-demo.mjs can restore them. A single statement is atomic, so a crash cannot half seed, and two
// concurrent cold starts cannot both seed. Deleted demo documents never come back.
const SEED_DOCUMENTS = `WITH claim AS (
    INSERT INTO meta (key, value) VALUES ('seeded', $1) ON CONFLICT (key) DO NOTHING RETURNING key
  ), welcome AS (
    INSERT INTO documents (id, owner_id, title, content, updated_by)
    SELECT $2, 'u_alice', $3, $4, 'u_alice' FROM claim RETURNING id
  ), notes AS (
    INSERT INTO documents (id, owner_id, title, content, updated_by)
    SELECT $5, 'u_bob', $6, $7, 'u_bob' FROM claim RETURNING id
  ), share_welcome AS (
    INSERT INTO document_shares (document_id, user_id, role) SELECT id, 'u_bob', 'editor' FROM welcome RETURNING 1
  ), share_notes AS (
    INSERT INTO document_shares (document_id, user_id, role) SELECT id, 'u_alice', 'viewer' FROM notes RETURNING 1
  ), remember AS (
    INSERT INTO meta (key, value)
    SELECT ids.key, ids.value FROM claim, (VALUES ('demo_welcome_id', $2::text), ('demo_notes_id', $5::text)) AS ids (key, value)
    RETURNING 1
  )
  SELECT count(*)::int AS seeded FROM claim`;

let driverPromise = null;
let readyPromise = null;

function connectionString() {
  return String(process.env.DATABASE_URL || process.env.POSTGRES_URL || '').trim();
}

async function createDriver() {
  const url = connectionString();
  if (url) {
    const sql = neon(url);
    return { kind: 'neon', run: (text, params = []) => sql.query(text, params) };
  }
  // A Vercel deployment has a read only file system: without a connection string there is no
  // usable database, so say so clearly instead of failing deep inside PGlite.
  if (process.env.VERCEL) {
    throw new HttpError(503, 'db_not_configured', 'The database is not configured for this deployment.');
  }
  const dir = String(process.env.PGLITE_DIR || '').trim() || '.data/pglite';
  const { PGlite } = await import('@electric-sql/pglite');
  const db = new PGlite(dir.startsWith('memory://') ? dir : path.resolve(dir));
  await db.waitReady;
  return {
    kind: 'pglite',
    run: async (text, params = []) => (await db.query(text, params)).rows,
    close: () => db.close(),
  };
}

function getDriver() {
  if (!driverPromise) {
    driverPromise = createDriver().catch((err) => {
      driverPromise = null;
      throw err;
    });
  }
  return driverPromise;
}

async function createSchema(driver) {
  const [check] = await driver.run(SCHEMA_CHECK);
  // Both drivers parse booleans; the string form is accepted too so a driver change can never skip creation wrongly.
  if (check?.ready === true || check?.ready === 't') return;
  for (const statement of SCHEMA) {
    try {
      await driver.run(statement);
    } catch (err) {
      if (!ALREADY_EXISTS.has(err?.code)) throw err;
    }
  }
}

async function seed(driver) {
  const params = [];
  const values = SEED_USERS.map((user, i) => {
    params.push(user.id, user.email, user.name);
    return `($${i * 3 + 1}, $${i * 3 + 2}, $${i * 3 + 3})`;
  });
  await driver.run(`INSERT INTO users (id, email, name) VALUES ${values.join(', ')} ON CONFLICT DO NOTHING`, params);
  const [result] = await driver.run(SEED_DOCUMENTS, [
    new Date().toISOString(),
    randomUUID(),
    WELCOME_DOC.title,
    WELCOME_DOC.content,
    randomUUID(),
    NOTES_DOC.title,
    NOTES_DOC.content,
  ]);
  if (result?.seeded) log('info', { event: 'seeded_demo_documents' });
}

// Schema and seed run once per process; a failure is not cached, so the next request retries.
export function ensureReady() {
  if (!readyPromise) {
    readyPromise = (async () => {
      const driver = await getDriver();
      await createSchema(driver);
      await seed(driver);
      return driver;
    })().catch((err) => {
      readyPromise = null;
      throw err;
    });
  }
  return readyPromise;
}

export async function query(text, params = []) {
  const driver = await ensureReady();
  return driver.run(text, params);
}

export async function dbKind() {
  return (await getDriver()).kind;
}

// Closes a local PGlite database (scripts call this before exiting). Neon over HTTP has nothing to close.
export async function closeDb() {
  const pending = driverPromise;
  driverPromise = null;
  readyPromise = null;
  const driver = pending ? await pending.catch(() => null) : null;
  if (driver?.close) await driver.close();
}

// Test helper: forget that the schema and seed ran, so the next query runs them again
// against the same database (used to prove a second run is harmless).
export function resetReadyForTests() {
  readyPromise = null;
}
