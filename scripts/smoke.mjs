// End to end smoke test over real HTTP with real cookies, signed in as each seeded user.
// Usage: node scripts/smoke.mjs [baseUrl]   (default http://127.0.0.1:5288, the local dev API)
// It creates documents whose titles start with "Smoke test" and deletes them again at the end.
import { makeDocx } from '../tests/_helpers.mjs';

const base = (process.argv[2] || 'http://127.0.0.1:5288').replace(/\/+$/, '');
const results = [];
const created = [];

async function call(method, path, { cookie, body } = {}) {
  const headers = {};
  if (cookie) headers.cookie = cookie;
  if (body !== undefined) headers['content-type'] = 'application/json';
  const res = await fetch(`${base}/api${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }
  return { status: res.status, body: json, setCookie: res.headers.getSetCookie(), text };
}

function check(name, ok, detail = '') {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
}

async function signIn(email) {
  const res = await call('POST', '/session', { body: { email } });
  const cookie = res.setCookie[0]?.split(';')[0] || '';
  check(`sign in as ${email}`, res.status === 200 && res.body?.user?.email === email && cookie.startsWith('ajaia_session='), `HTTP ${res.status}`);
  return cookie;
}

const b64 = (text) => Buffer.from(text).toString('base64');

async function main() {
  console.log(`Smoke test against ${base}\n`);
  const health = await call('GET', '/health');
  check('GET /api/health', health.status === 200 && health.body?.ok === true, `db=${health.body?.db}`);
  const users = await call('GET', '/users');
  check('GET /api/users lists 3 seeded users', users.status === 200 && users.body?.users?.length === 3);
  const anonymous = await call('GET', '/documents');
  check('GET /api/documents without a session is 401', anonymous.status === 401 && anonymous.body?.code === 'unauthenticated');

  const alice = await signIn('alice@example.com');
  const bob = await signIn('bob@example.com');
  const carol = await signIn('carol@example.com');
  for (const [name, cookie] of [['alice', alice], ['bob', bob], ['carol', carol]]) {
    const me = await call('GET', '/session', { cookie });
    check(`GET /api/session as ${name}`, me.status === 200 && me.body?.user?.email === `${name}@example.com`);
    const list = await call('GET', '/documents', { cookie });
    check(`GET /api/documents as ${name}`, list.status === 200, `owned ${list.body?.owned?.length}, shared ${list.body?.shared?.length}`);
  }

  // Alice creates, edits and shares
  const made = await call('POST', '/documents', { cookie: alice, body: { title: 'Smoke test doc', content: '<p>Hello <script>alert(1)</script><strong>world</strong></p>' } });
  const doc = made.body?.document;
  if (doc) created.push(doc.id);
  check('alice: POST /api/documents (201, sanitized)', made.status === 201 && doc?.content === '<p>Hello <strong>world</strong></p>' && doc?.role === 'owner');
  const renamed = await call('PATCH', `/document?id=${doc.id}`, { cookie: alice, body: { baseVersion: 1, title: 'Smoke test doc (renamed)', content: '<h1>Heading</h1><ul><li><p>item</p></li></ul>' } });
  check('alice: PATCH title and content (version 2)', renamed.status === 200 && renamed.body?.document?.version === 2);
  const shareBob = await call('POST', '/shares', { cookie: alice, body: { documentId: doc.id, email: 'bob@example.com', role: 'editor' } });
  check('alice: share with bob as editor (201)', shareBob.status === 201 && shareBob.body?.share?.role === 'editor');
  const shareCarol = await call('POST', '/shares', { cookie: alice, body: { documentId: doc.id, email: 'carol@example.com', role: 'viewer' } });
  check('alice: share with carol as viewer (201)', shareCarol.status === 201 && shareCarol.body?.share?.role === 'viewer');

  // Bob edits as an editor, then Alice's stale save conflicts
  const bobList = await call('GET', '/documents', { cookie: bob });
  check('bob: shared list includes the doc as editor', bobList.body?.shared?.some((d) => d.id === doc.id && d.role === 'editor'));
  const bobEdit = await call('PATCH', `/document?id=${doc.id}`, { cookie: bob, body: { baseVersion: 2, content: '<p>Bob was here</p>' } });
  check('bob: PATCH as editor (version 3)', bobEdit.status === 200 && bobEdit.body?.document?.version === 3 && bobEdit.body?.document?.updatedByName === 'Bob Smith');
  const stale = await call('PATCH', `/document?id=${doc.id}`, { cookie: alice, body: { baseVersion: 2, content: '<p>Alice stale save</p>' } });
  check('alice: stale save is 409 version_conflict with the latest', stale.status === 409 && stale.body?.code === 'version_conflict' && stale.body?.document?.version === 3);
  const keepMine = await call('PATCH', `/document?id=${doc.id}`, { cookie: alice, body: { baseVersion: 3, content: '<p>Alice kept hers</p>' } });
  check('alice: "keep mine" save on the latest version (version 4)', keepMine.status === 200 && keepMine.body?.document?.version === 4);

  // Carol is a viewer: read yes, everything else no
  const carolRead = await call('GET', `/document?id=${doc.id}`, { cookie: carol });
  check('carol: GET as viewer', carolRead.status === 200 && carolRead.body?.document?.role === 'viewer');
  const carolEdit = await call('PATCH', `/document?id=${doc.id}`, { cookie: carol, body: { baseVersion: 4, content: '<p>nope</p>' } });
  check('carol: PATCH as viewer is 403', carolEdit.status === 403 && carolEdit.body?.code === 'forbidden');
  const carolDelete = await call('DELETE', `/document?id=${doc.id}`, { cookie: carol });
  check('carol: DELETE as viewer is 403', carolDelete.status === 403);
  const carolShare = await call('POST', '/shares', { cookie: carol, body: { documentId: doc.id, email: 'bob@example.com', role: 'viewer' } });
  check('carol: share as viewer is 403', carolShare.status === 403);
  const carolShares = await call('GET', `/shares?documentId=${doc.id}`, { cookie: carol });
  check('carol: GET /api/shares lists owner and 2 shares', carolShares.status === 200 && carolShares.body?.owner?.id === 'u_alice' && carolShares.body?.shares?.length === 2);
  const bobDelete = await call('DELETE', `/document?id=${doc.id}`, { cookie: bob });
  check('bob: DELETE as editor is 403', bobDelete.status === 403);

  // Owner changes a role and removes access
  const promote = await call('POST', '/shares', { cookie: alice, body: { documentId: doc.id, email: 'carol@example.com', role: 'editor' } });
  check('alice: change carol to editor (upsert)', promote.status === 201 && promote.body?.share?.role === 'editor');
  const remove = await call('DELETE', `/shares?documentId=${doc.id}&userId=u_carol`, { cookie: alice });
  check('alice: remove carol', remove.status === 200 && remove.body?.removed === true);
  const carolGone = await call('GET', `/document?id=${doc.id}`, { cookie: carol });
  check('carol: no access is 404', carolGone.status === 404 && carolGone.body?.code === 'not_found');

  // Imports
  const txt = await call('POST', '/import', { cookie: alice, body: { filename: 'Smoke test notes.txt', contentBase64: b64('Line one\nLine <two>') } });
  if (txt.body?.document) created.push(txt.body.document.id);
  check('alice: import .txt', txt.status === 201 && txt.body?.document?.content === '<p>Line one</p><p>Line &lt;two&gt;</p>');
  const md = await call('POST', '/import', { cookie: alice, body: { filename: 'Smoke test plan.md', contentBase64: b64('# Plan\n\n- **bold** item') } });
  if (md.body?.document) created.push(md.body.document.id);
  check('alice: import .md', md.status === 201 && md.body?.document?.content.includes('<h1>Plan</h1>'));
  const docx = makeDocx('<w:p><w:r><w:rPr><w:b/></w:rPr><w:t>Smoke docx</w:t></w:r></w:p>');
  const word = await call('POST', '/import', { cookie: bob, body: { filename: 'Smoke test word.docx', contentBase64: docx.toString('base64') } });
  if (word.body?.document) created.push({ id: word.body.document.id, cookie: bob });
  check('bob: import .docx', word.status === 201 && word.body?.document?.content === '<p><strong>Smoke docx</strong></p>');
  const pdf = await call('POST', '/import', { cookie: alice, body: { filename: 'x.pdf', contentBase64: b64('%PDF') } });
  check('import .pdf is 415', pdf.status === 415 && pdf.body?.code === 'unsupported_type');

  // Sign out
  const out = await call('DELETE', '/session', { cookie: alice });
  check('DELETE /api/session clears the cookie', out.status === 200 && /Max-Age=0/.test(out.setCookie[0] || ''));

  // Cleanup (owner deletes); a deleted doc is 404 for the editor too
  for (const item of created) {
    const { id, cookie } = typeof item === 'string' ? { id: item, cookie: alice } : item;
    const del = await call('DELETE', `/document?id=${id}`, { cookie });
    check(`cleanup: owner deletes ${id.slice(0, 8)}`, del.status === 200);
  }
  created.length = 0;
  const bobAfter = await call('GET', `/document?id=${doc.id}`, { cookie: bob });
  check('bob: deleted doc is 404', bobAfter.status === 404);
}

main()
  .catch((err) => {
    check('smoke run finished without a crash', false, err.message);
  })
  .finally(() => {
    const failed = results.filter((r) => !r.ok).length;
    console.log(`\n${results.length - failed} passed, ${failed} failed`);
    process.exitCode = failed ? 1 : 0;
  });
