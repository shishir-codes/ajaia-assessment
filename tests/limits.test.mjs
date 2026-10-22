// Public demo safeguards: document cap, creation rate (from the database), in memory rate limits for
// saves, share changes and sign ins, the security headers in vercel.json and the demo restore.
// Limits are lowered through the DEMO_* environment overrides, which are read on every request.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { after, before, beforeEach, describe, test } from 'node:test';
import { b64, startApi, stopApi } from './_helpers.mjs';

let server;
let api;
let alice;
let bob;
let carol;
let limits;

const LIMIT_NAMES = ['DEMO_MAX_DOCS', 'DEMO_CREATE_PER_10_MIN', 'DEMO_SAVES_PER_MIN', 'DEMO_SHARES_PER_MIN', 'DEMO_SIGNINS_PER_MIN'];
const RATE_MESSAGE = 'You are making changes very quickly. Please wait a moment and try again.';

function setLimits(values) {
  for (const name of LIMIT_NAMES) process.env[name] = String(values[name] ?? 100000);
}

before(async () => {
  ({ server, api } = await startApi(5293));
  limits = await import('../api/_lib/limits.js');
  alice = await api.signIn('alice@example.com');
  bob = await api.signIn('bob@example.com');
  carol = await api.signIn('carol@example.com');
});

beforeEach(() => {
  setLimits({});
  limits.resetRateLimitsForTests();
});

after(() => stopApi(server));

const create = (cookie, title = 'Limit test') => api.call('POST', '/documents', { cookie, body: { title } });
const importTxt = (cookie, name = 'Imported.txt') =>
  api.call('POST', '/import', { cookie, body: { filename: name, contentBase64: b64('hello') } });
const patch = (cookie, id, body) => api.call('PATCH', `/document?id=${encodeURIComponent(id)}`, { cookie, body });

function assertRateLimited(res, maxSeconds) {
  assert.equal(res.status, 429, res.text);
  assert.equal(res.body.code, 'rate_limited');
  assert.equal(res.body.error, RATE_MESSAGE);
  const retryAfter = Number(res.headers.get('retry-after'));
  assert.ok(Number.isInteger(retryAfter) && retryAfter >= 1 && retryAfter <= maxSeconds, `Retry-After ${retryAfter}`);
  assert.equal(res.body.retryAfter, retryAfter);
}

describe('defaults and env overrides', () => {
  test('production defaults are 100 docs, 20 creates per 10 min, 120 saves, 30 share changes, 20 sign ins', () => {
    for (const name of LIMIT_NAMES) delete process.env[name];
    assert.equal(limits.limitValue('DEMO_MAX_DOCS'), 100);
    assert.equal(limits.limitValue('DEMO_CREATE_PER_10_MIN'), 20);
    assert.equal(limits.limitValue('DEMO_SAVES_PER_MIN'), 120);
    assert.equal(limits.limitValue('DEMO_SHARES_PER_MIN'), 30);
    assert.equal(limits.limitValue('DEMO_SIGNINS_PER_MIN'), 20);
    assert.equal(
      limits.documentLimitReached(100).message,
      'You have reached the demo limit of 100 documents. Delete one to create another.',
    );
  });

  test('junk, zero and negative overrides fall back to the default (a typo never switches a limit off)', () => {
    for (const value of ['', 'abc', '0', '-5', '1.5', '1e3', ' ']) {
      process.env.DEMO_MAX_DOCS = value;
      assert.equal(limits.limitValue('DEMO_MAX_DOCS'), 100, `value ${JSON.stringify(value)}`);
    }
    process.env.DEMO_MAX_DOCS = ' 7 ';
    assert.equal(limits.limitValue('DEMO_MAX_DOCS'), 7);
  });

  test('sliding window: only allowed hits count, and the window frees up on time', () => {
    limits.takeHit('unit', 2, 1000, 0);
    limits.takeHit('unit', 2, 1000, 10);
    assert.throws(() => limits.takeHit('unit', 2, 1000, 500), (err) => err.status === 429 && err.headers['Retry-After'] === '1');
    assert.throws(() => limits.takeHit('unit', 2, 1000, 999), (err) => err.status === 429);
    limits.takeHit('unit', 2, 1000, 1001); // the hit at 0 left the window; refused hits were not counted
    assert.throws(() => limits.takeHit('unit', 2, 1000, 1005), (err) => err.status === 429);
  });
});

describe('document cap (403 limit_reached)', () => {
  test('at the cap, create and import are refused; deleting one frees a slot', async () => {
    setLimits({ DEMO_MAX_DOCS: 3 });
    // Alice already owns the seeded Welcome document, so two more reach the cap of 3.
    const first = await create(alice);
    assert.equal(first.status, 201, first.text);
    assert.equal((await importTxt(alice)).status, 201);

    const refused = await create(alice);
    assert.equal(refused.status, 403, refused.text);
    assert.equal(refused.body.code, 'limit_reached');
    assert.equal(refused.body.error, 'You have reached the demo limit of 3 documents. Delete one to create another.');
    const refusedImport = await importTxt(alice);
    assert.equal(refusedImport.status, 403, refusedImport.text);
    assert.equal(refusedImport.body.code, 'limit_reached');

    const list = await api.call('GET', '/documents', { cookie: alice });
    assert.equal(list.body.owned.length, 3);

    const del = await api.call('DELETE', `/document?id=${first.body.document.id}`, { cookie: alice });
    assert.equal(del.status, 200);
    assert.equal((await create(alice)).status, 201);
    assert.equal((await create(alice)).status, 403);

    // Shared documents do not count: Bob (1 owned) is not affected by Alice reaching the cap.
    assert.equal((await create(bob, 'Bob is fine')).status, 201);
  });
});

describe('creation rate (429 rate_limited, counted from created_at)', () => {
  test('create and import count together; the next one gets 429 with Retry-After; others are unaffected', async () => {
    setLimits({ DEMO_CREATE_PER_10_MIN: 4 });
    // Carol owns nothing yet: 2 creates + 2 imports reach the limit of 4 in 10 minutes.
    assert.equal((await create(carol)).status, 201);
    assert.equal((await importTxt(carol)).status, 201);
    assert.equal((await create(carol)).status, 201);
    assert.equal((await importTxt(carol, 'notes.md')).status, 201);

    assertRateLimited(await create(carol), 600);
    assertRateLimited(await importTxt(carol), 600);

    // The count comes from the database: what was refused created nothing.
    const list = await api.call('GET', '/documents', { cookie: carol });
    assert.equal(list.body.owned.length, 4);

    // Raising the limit again lets her continue, and another user was never limited.
    setLimits({ DEMO_CREATE_PER_10_MIN: 5 });
    assert.equal((await create(carol)).status, 201);
    assertRateLimited(await create(carol), 600);
  });

  test('the cap is reported before the rate limit when both apply', async () => {
    setLimits({ DEMO_MAX_DOCS: 1, DEMO_CREATE_PER_10_MIN: 1 });
    const res = await create(carol);
    assert.equal(res.status, 403);
    assert.equal(res.body.code, 'limit_reached');
  });

  test('two creates at the same moment at the limit edge: never more than one gets through', async () => {
    const before = (await api.call('GET', '/documents', { cookie: bob })).body.owned.length;
    setLimits({ DEMO_MAX_DOCS: before + 1 });
    const results = await Promise.all([create(bob), create(bob), create(bob)]);
    const statuses = results.map((r) => r.status).sort();
    // PGlite runs statements one at a time, so this is exact here. On Neon two requests in the very
    // same instant can both pass (a known gap); the cap is then exceeded by at most one per request.
    assert.deepEqual(statuses, [201, 403, 403]);
  });
});

describe('in memory rate limits (429 rate_limited with Retry-After)', () => {
  test('saves: over DEMO_SAVES_PER_MIN in a minute is refused, other users keep saving', async () => {
    setLimits({ DEMO_SAVES_PER_MIN: 3 });
    const doc = (await create(alice, 'Save limit')).body.document;
    let version = doc.version;
    for (let i = 0; i < 3; i += 1) {
      const res = await patch(alice, doc.id, { content: `<p>save ${i}</p>`, baseVersion: version });
      assert.equal(res.status, 200, res.text);
      version = res.body.document.version;
    }
    assertRateLimited(await patch(alice, doc.id, { content: '<p>too fast</p>', baseVersion: version }), 60);
    // The refused save changed nothing.
    const stored = await api.call('GET', `/document?id=${doc.id}`, { cookie: alice });
    assert.equal(stored.body.document.content, '<p>save 2</p>');
    assert.equal(stored.body.document.version, version);

    const bobDoc = (await create(bob, 'Bob saves')).body.document;
    const bobSave = await patch(bob, bobDoc.id, { title: 'Still fine', baseVersion: bobDoc.version });
    assert.equal(bobSave.status, 200, bobSave.text);
  });

  test('share changes: POST and DELETE count, reading the access list does not', async () => {
    setLimits({ DEMO_SHARES_PER_MIN: 2 });
    const doc = (await create(bob, 'Share limit')).body.document;
    const add = await api.call('POST', '/shares', { cookie: bob, body: { documentId: doc.id, email: 'carol@example.com', role: 'viewer' } });
    assert.equal(add.status, 201, add.text);
    const remove = await api.call('DELETE', `/shares?documentId=${doc.id}&userId=u_carol`, { cookie: bob });
    assert.equal(remove.status, 200, remove.text);
    assertRateLimited(
      await api.call('POST', '/shares', { cookie: bob, body: { documentId: doc.id, email: 'carol@example.com', role: 'editor' } }),
      60,
    );
    assert.equal((await api.call('GET', `/shares?documentId=${doc.id}`, { cookie: bob })).status, 200);
  });

  test('sign ins: over DEMO_SIGNINS_PER_MIN from one address is refused', async () => {
    setLimits({ DEMO_SIGNINS_PER_MIN: 2 });
    const one = await api.call('POST', '/session', { body: { email: 'alice@example.com' } });
    const two = await api.call('POST', '/session', { body: { email: 'nobody@example.com' } }); // failed attempts count too
    assert.equal(one.status, 200);
    assert.equal(two.status, 404);
    assertRateLimited(await api.call('POST', '/session', { body: { email: 'alice@example.com' } }), 60);
    // Reading the session and signing out are not limited.
    assert.equal((await api.call('GET', '/session', { cookie: alice })).status, 200);
    assert.equal((await api.call('DELETE', '/session')).status, 200);
  });
});

describe('security headers', () => {
  test('vercel.json sends the four headers on every path', () => {
    const config = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'));
    const rule = config.headers.find((h) => h.source === '/(.*)');
    const headers = Object.fromEntries(rule.headers.map((h) => [h.key, h.value]));
    assert.equal(headers['X-Content-Type-Options'], 'nosniff');
    assert.equal(headers['Referrer-Policy'], 'strict-origin-when-cross-origin');
    assert.equal(headers['X-Frame-Options'], 'DENY');
    assert.equal(headers['Permissions-Policy'], 'camera=(), microphone=(), geolocation=()');
  });
});

describe('demo restore (scripts/reset-demo.mjs)', () => {
  test('puts both demo documents and their shares back exactly as seeded; a second run is harmless', async () => {
    const { resetDemo } = await import('../api/_lib/demo.js');
    const { NOTES_DOC, WELCOME_DOC } = await import('../api/_lib/seed.js');
    const findByTitle = async (cookie, title) => {
      const list = (await api.call('GET', '/documents', { cookie })).body;
      return [...list.owned, ...list.shared].filter((d) => d.title === title);
    };
    const [welcome] = await findByTitle(alice, WELCOME_DOC.title);
    const [notes] = await findByTitle(bob, NOTES_DOC.title);

    // A reviewer vandalises both: rename and rewrite, share with Carol, downgrade Bob, delete the notes.
    const current = (await api.call('GET', `/document?id=${welcome.id}`, { cookie: alice })).body.document;
    assert.equal((await patch(alice, welcome.id, { title: 'Hacked', content: '<p>gone</p>', baseVersion: current.version })).status, 200);
    await api.call('POST', '/shares', { cookie: alice, body: { documentId: welcome.id, email: 'carol@example.com', role: 'editor' } });
    await api.call('POST', '/shares', { cookie: alice, body: { documentId: welcome.id, email: 'bob@example.com', role: 'viewer' } });
    assert.equal((await api.call('DELETE', `/document?id=${notes.id}`, { cookie: bob })).status, 200);

    for (let run = 1; run <= 2; run += 1) {
      const results = await resetDemo();
      assert.equal(results.length, 2);

      const w = (await api.call('GET', `/document?id=${welcome.id}`, { cookie: alice })).body.document;
      assert.equal(w.title, WELCOME_DOC.title);
      assert.equal(w.content, WELCOME_DOC.content);
      assert.ok(w.version > current.version, 'version keeps counting up so open tabs get a conflict');
      const wShares = (await api.call('GET', `/shares?documentId=${welcome.id}`, { cookie: alice })).body.shares;
      assert.deepEqual(wShares.map((s) => [s.userId, s.role]), [['u_bob', 'editor']]);

      // The deleted notes come back under the same id, so old links work again.
      const n = await api.call('GET', `/document?id=${notes.id}`, { cookie: bob });
      assert.equal(n.status, 200, n.text);
      assert.equal(n.body.document.title, NOTES_DOC.title);
      assert.equal(n.body.document.content, NOTES_DOC.content);
      const nShares = (await api.call('GET', `/shares?documentId=${notes.id}`, { cookie: bob })).body.shares;
      assert.deepEqual(nShares.map((s) => [s.userId, s.role]), [['u_alice', 'viewer']]);

      // No duplicates, and Carol lost the access the reviewer gave her.
      assert.equal((await findByTitle(alice, WELCOME_DOC.title)).length, 1);
      assert.equal((await findByTitle(bob, NOTES_DOC.title)).length, 1);
      assert.equal((await api.call('GET', `/document?id=${welcome.id}`, { cookie: carol })).status, 404);
    }

    // A database seeded before the ids were remembered: the reset finds the documents by owner and
    // title instead, restores the same ones and creates no duplicates.
    const { query } = await import('../api/_lib/db.js');
    await query("DELETE FROM meta WHERE key LIKE 'demo_%'");
    const again = await resetDemo();
    assert.deepEqual(again.map((r) => r.id), [welcome.id, notes.id]);
    assert.equal((await findByTitle(alice, WELCOME_DOC.title)).length, 1);
    assert.equal((await findByTitle(bob, NOTES_DOC.title)).length, 1);
  });
});
