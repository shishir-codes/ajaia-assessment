// For the candidate only: puts the two seeded demo documents ("Welcome to Ajaia Docs" and "Team
// meeting notes") and their shares back exactly as seeded, after reviewers have tried the public demo.
// Documents that reviewers created are left alone.
//
//   node scripts/reset-demo.mjs
//
// Database: DATABASE_URL or POSTGRES_URL (Neon) when set, otherwise PGlite at PGLITE_DIR (default
// .data/pglite, relative to the folder you run it from). Like dev-api.mjs it reads .env.local and then
// .env first; values already set in the shell win. It never prints the connection string.
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
for (const file of ['.env.local', '.env']) {
  const full = path.join(root, file);
  if (existsSync(full)) process.loadEnvFile(full);
}

const { closeDb } = await import('../api/_lib/db.js');
const { resetDemo } = await import('../api/_lib/demo.js');

const usesNeon = Boolean(String(process.env.DATABASE_URL || process.env.POSTGRES_URL || '').trim());
const target = usesNeon
  ? 'Neon (from DATABASE_URL or POSTGRES_URL)'
  : `PGlite at ${path.resolve(String(process.env.PGLITE_DIR || '').trim() || '.data/pglite')}`;
console.log(`Restoring the demo documents in ${target} ...`);

let exitCode = 0;
try {
  for (const doc of await resetDemo()) {
    const removed = doc.removedShares ? `, removed ${doc.removedShares} extra share(s)` : '';
    console.log(`  restored "${doc.title}" (owner ${doc.owner}, shared with ${doc.sharedWith}, version ${doc.version}${removed})`);
  }
  console.log('Done. Other documents were not changed.');
} catch (err) {
  // Only the message: never the connection string or the query parameters.
  console.error(`Reset failed: ${String(err?.message || err).replace(/postgres(ql)?:\/\/\S+/gi, '[connection string]')}`);
  exitCode = 1;
} finally {
  await closeDb().catch(() => {});
}
process.exit(exitCode);
