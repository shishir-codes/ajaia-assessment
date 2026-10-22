// API tests: npm test (Node's built in runner, PGlite in memory, no network, no keys).
// They call the real handlers over HTTP through dev-api.mjs, with real cookies.
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { startApi, stopApi } from './_helpers.mjs';

let server;
let api;
let alice;
let bob;
let carol;

before(async () => {
  ({ server, api } = await startApi(5291));
  alice = await api.signIn('alice@example.com');
  bob = await api.signIn('bob@example.com');
  carol = await api.signIn('carol@example.com');
});

after(() => stopApi(server));

const create = async (cookie, body = {}) => {
  const res = await api.call('POST', '/documents', { cookie, body });
  assert.equal(res.status, 201, res.text);
  return res.body.document;
};
const share = (cookie, documentId, email, role) => api.call('POST', '/shares', { cookie, body: { documentId, email, role } });
const getDoc = (cookie, id) => api.call('GET', `/document?id=${encodeURIComponent(id)}`, { cookie });
const patch = (cookie, id, body) => api.call('PATCH', `/document?id=${encodeURIComponent(id)}`, { cookie, body });

describe('health, users and session', () => {
  test('health reports the database in use', async () => {
    const res = await api.call('GET', '/health');
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { ok: true, db: 'pglite' });
  });

  test('the user directory lists the three seeded users without a session', async () => {
    const res = await api.call('GET', '/users');
    assert.equal(res.status, 200);
    assert.deepEqual(
      res.body.users.map((u) => [u.id, u.email, u.name]),
      [
        ['u_alice', 'alice@example.com', 'Alice Johnson'],
        ['u_bob', 'bob@example.com', 'Bob Smith'],
        ['u_carol', 'carol@example.com', 'Carol Lee'],
      ],
    );
  });

  test('sign in sets a signed HttpOnly cookie and GET returns the user', async () => {
    const anonymous = await api.call('GET', '/session');
    assert.equal(anonymous.status, 200);
    assert.deepEqual(anonymous.body, { ok: true, user: null });

    const res = await api.call('POST', '/session', { body: { email: '  Alice@Example.COM ' } });
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.user, { id: 'u_alice', email: 'alice@example.com', name: 'Alice Johnson' });
    const [cookie] = res.headers.getSetCookie();
    assert.match(cookie, /^ajaia_session=u_alice\.[A-Za-z0-9_-]{43};/);
    for (const flag of ['HttpOnly', 'SameSite=Lax', 'Path=/', 'Max-Age=604800']) assert.ok(cookie.includes(flag), `${flag} in ${cookie}`);
    assert.ok(!cookie.includes('Secure'), 'no Secure flag on plain http locally');

    const me = await api.call('GET', '/session', { cookie: cookie.split(';')[0] });
    assert.equal(me.body.user.id, 'u_alice');
  });

  test('sign in input errors', async () => {
    const missing = await api.call('POST', '/session', { body: {} });
    assert.equal(missing.status, 400);
    assert.equal(missing.body.code, 'invalid_input');
    const wrongType = await api.call('POST', '/session', { body: { email: 42 } });
    assert.equal(wrongType.status, 400);
    const unknown = await api.call('POST', '/session', { body: { email: 'mallory@example.com' } });
    assert.equal(unknown.status, 404);
    assert.equal(unknown.body.code, 'unknown_user');
    assert.equal(unknown.headers.getSetCookie().length, 0);
  });

  test('a tampered or forged cookie is rejected and cleared', async () => {
    const signature = alice.split('.')[1];
    const forged = `ajaia_session=u_bob.${signature}`;
    const me = await api.call('GET', '/session', { cookie: forged });
    assert.equal(me.body.user, null);
    assert.match(me.headers.getSetCookie()[0], /^ajaia_session=;.*Max-Age=0/);
    const list = await api.call('GET', '/documents', { cookie: forged });
    assert.equal(list.status, 401);
    const garbage = await api.call('GET', '/documents', { cookie: 'ajaia_session=not-a-session' });
    assert.equal(garbage.status, 401);
    const noSignature = await api.call('GET', '/documents', { cookie: 'ajaia_session=u_alice' });
    assert.equal(noSignature.status, 401);
  });

  test('sign out clears the cookie', async () => {
    const res = await api.call('DELETE', '/session', { cookie: alice });
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { ok: true });
    assert.match(res.headers.getSetCookie()[0], /^ajaia_session=;.*Max-Age=0/);
  });

  test('every protected route answers 401 without a session', async () => {
    const calls = [
      ['GET', '/documents'],
      ['POST', '/documents', {}],
      ['GET', '/document?id=x'],
      ['PATCH', '/document?id=x', { baseVersion: 1, title: 'x' }],
      ['DELETE', '/document?id=x'],
      ['GET', '/shares?documentId=x'],
      ['POST', '/shares', { documentId: 'x', email: 'bob@example.com', role: 'viewer' }],
      ['DELETE', '/shares?documentId=x&userId=u_bob'],
      ['POST', '/import', { filename: 'a.txt', contentBase64: 'aGk=' }],
    ];
    for (const [method, path, body] of calls) {
      const res = await api.call(method, path, { body });
      assert.equal(res.status, 401, `${method} ${path}`);
      assert.deepEqual(res.body, { ok: false, error: 'Please sign in first.', code: 'unauthenticated' });
    }
  });

  test('wrong methods get 405 with an Allow header', async () => {
    const res = await api.call('PUT', '/document?id=x', { cookie: alice, body: {} });
    assert.equal(res.status, 405);
    assert.equal(res.body.code, 'method_not_allowed');
    assert.equal(res.headers.get('allow'), 'GET, PATCH, DELETE');
    const users = await api.call('POST', '/users', { body: {} });
    assert.equal(users.status, 405);
    assert.equal(users.headers.get('allow'), 'GET');
  });
});

describe('seeded documents', () => {
  test('each user sees the right owned and shared lists', async () => {
    const a = (await api.call('GET', '/documents', { cookie: alice })).body;
    assert.deepEqual(a.owned.filter((d) => d.title === 'Welcome to Ajaia Docs').map((d) => d.role), ['owner']);
    const notes = a.shared.find((d) => d.title === 'Team meeting notes');
    assert.equal(notes.role, 'viewer');
    assert.equal(notes.ownerName, 'Bob Smith');
    assert.equal(notes.ownerId, 'u_bob');
    for (const key of ['id', 'title', 'ownerId', 'ownerName', 'role', 'createdAt', 'updatedAt', 'updatedByName']) {
      assert.ok(key in notes, `DocSummary has ${key}`);
    }
    assert.ok(!('content' in notes), 'summaries do not carry content');
    assert.ok(!Number.isNaN(Date.parse(notes.updatedAt)));

    const b = (await api.call('GET', '/documents', { cookie: bob })).body;
    assert.ok(b.owned.some((d) => d.title === 'Team meeting notes' && d.role === 'owner'));
    assert.ok(b.shared.some((d) => d.title === 'Welcome to Ajaia Docs' && d.role === 'editor'));

    const c = (await api.call('GET', '/documents', { cookie: carol })).body;
    assert.deepEqual(c, { ok: true, owned: [], shared: [] });
  });

  test('the welcome document has a heading, bold, italic and both list types', async () => {
    const list = (await api.call('GET', '/documents', { cookie: alice })).body;
    const welcome = list.owned.find((d) => d.title === 'Welcome to Ajaia Docs');
    const doc = (await getDoc(alice, welcome.id)).body.document;
    for (const tag of ['<h1>', '<strong>', '<em>', '<ul>', '<ol>']) assert.ok(doc.content.includes(tag), tag);
    assert.equal(doc.version, 1);
  });
});

describe('access control matrix', () => {
  test('owner, editor, viewer and stranger: read, edit, share, delete', async () => {
    const doc = await create(alice, { title: 'Matrix doc', content: '<p>start</p>' });
    assert.equal(doc.role, 'owner');
    assert.equal(doc.version, 1);
    assert.equal((await share(alice, doc.id, 'bob@example.com', 'editor')).status, 201);
    assert.equal((await share(alice, doc.id, 'carol@example.com', 'viewer')).status, 201);

    // Read
    for (const [cookie, role] of [[alice, 'owner'], [bob, 'editor'], [carol, 'viewer']]) {
      const res = await getDoc(cookie, doc.id);
      assert.equal(res.status, 200);
      assert.equal(res.body.document.role, role);
      assert.equal(res.body.document.content, '<p>start</p>');
    }

    // Edit: owner and editor can, viewer cannot (403, nothing changes)
    const v2 = await patch(alice, doc.id, { baseVersion: 1, content: '<p>by alice</p>' });
    assert.equal(v2.status, 200);
    assert.equal(v2.body.document.version, 2);
    assert.equal(v2.body.document.updatedByName, 'Alice Johnson');
    const v3 = await patch(bob, doc.id, { baseVersion: 2, title: 'Renamed by Bob', content: '<p>by bob</p>' });
    assert.equal(v3.status, 200);
    assert.equal(v3.body.document.version, 3);
    assert.equal(v3.body.document.role, 'editor');
    assert.equal(v3.body.document.title, 'Renamed by Bob');
    assert.equal(v3.body.document.updatedByName, 'Bob Smith');
    const viewerEdit = await patch(carol, doc.id, { baseVersion: 3, content: '<p>by carol</p>' });
    assert.equal(viewerEdit.status, 403);
    assert.equal(viewerEdit.body.code, 'forbidden');
    const viewerStale = await patch(carol, doc.id, { baseVersion: 1, content: '<p>by carol</p>' });
    assert.equal(viewerStale.status, 403, 'a viewer gets 403, never a 409 with the content');
    assert.equal((await getDoc(alice, doc.id)).body.document.content, '<p>by bob</p>');

    // Share and the access list: only the owner may change it, anyone with access may read it
    for (const cookie of [bob, carol]) {
      const res = await share(cookie, doc.id, 'carol@example.com', 'editor');
      assert.equal(res.status, 403);
      assert.equal(res.body.code, 'forbidden');
      const remove = await api.call('DELETE', `/shares?documentId=${doc.id}&userId=u_bob`, { cookie });
      assert.equal(remove.status, 403);
      const list = await api.call('GET', `/shares?documentId=${doc.id}`, { cookie });
      assert.equal(list.status, 200);
      assert.equal(list.body.owner.id, 'u_alice');
      assert.deepEqual(list.body.shares.map((s) => [s.userId, s.role]).sort(), [['u_bob', 'editor'], ['u_carol', 'viewer']]);
    }

    // Delete: only the owner
    for (const cookie of [bob, carol]) {
      const res = await api.call('DELETE', `/document?id=${doc.id}`, { cookie });
      assert.equal(res.status, 403);
    }

    // Stranger: remove Carol, then every action is a 404 (existence is not revealed)
    const removed = await api.call('DELETE', `/shares?documentId=${doc.id}&userId=u_carol`, { cookie: alice });
    assert.deepEqual(removed.body, { ok: true, removed: true });
    const strangerCalls = [
      await getDoc(carol, doc.id),
      await patch(carol, doc.id, { baseVersion: 3, content: '<p>x</p>' }),
      await api.call('DELETE', `/document?id=${doc.id}`, { cookie: carol }),
      await api.call('GET', `/shares?documentId=${doc.id}`, { cookie: carol }),
      await share(carol, doc.id, 'bob@example.com', 'viewer'),
      await api.call('DELETE', `/shares?documentId=${doc.id}&userId=u_bob`, { cookie: carol }),
    ];
    for (const res of strangerCalls) {
      assert.equal(res.status, 404, res.text);
      assert.equal(res.body.code, 'not_found');
    }
    const carolList = (await api.call('GET', '/documents', { cookie: carol })).body;
    assert.ok(!carolList.shared.some((d) => d.id === doc.id));

    // Missing document looks exactly like no access
    const missing = await getDoc(alice, 'does-not-exist');
    assert.equal(missing.status, 404);
    assert.equal(missing.body.code, 'not_found');

    // Owner deletes: gone for everyone, shares go with it
    const deleted = await api.call('DELETE', `/document?id=${doc.id}`, { cookie: alice });
    assert.equal(deleted.status, 200);
    assert.equal((await getDoc(alice, doc.id)).status, 404);
    assert.equal((await getDoc(bob, doc.id)).status, 404);
    const bobList = (await api.call('GET', '/documents', { cookie: bob })).body;
    assert.ok(!bobList.shared.some((d) => d.id === doc.id));
    const again = await api.call('DELETE', `/document?id=${doc.id}`, { cookie: alice });
    assert.equal(again.status, 404, 'deleting twice is a 404, not a crash');
  });
});

describe('optimistic concurrency', () => {
  test('a stale save gets 409 version_conflict with the latest document', async () => {
    const doc = await create(alice, { title: 'Conflict doc' });
    await share(alice, doc.id, 'bob@example.com', 'editor');
    const first = await patch(alice, doc.id, { baseVersion: 1, content: '<p>alice wins</p>' });
    assert.equal(first.status, 200);
    const stale = await patch(bob, doc.id, { baseVersion: 1, content: '<p>bob was late</p>' });
    assert.equal(stale.status, 409);
    assert.equal(stale.body.code, 'version_conflict');
    assert.equal(stale.body.ok, false);
    assert.equal(stale.body.document.version, 2);
    assert.equal(stale.body.document.content, '<p>alice wins</p>');
    assert.equal(stale.body.document.role, 'editor');
    // "Keep mine": save again on top of the latest version
    const keepMine = await patch(bob, doc.id, { baseVersion: stale.body.document.version, content: '<p>bob was late</p>' });
    assert.equal(keepMine.status, 200);
    assert.equal(keepMine.body.document.version, 3);
  });

  test('two saves from the same version at the same moment: exactly one wins', async () => {
    const doc = await create(alice, { title: 'Race doc' });
    await share(alice, doc.id, 'bob@example.com', 'editor');
    const results = await Promise.all([
      patch(alice, doc.id, { baseVersion: 1, content: '<p>alice</p>' }),
      patch(bob, doc.id, { baseVersion: 1, content: '<p>bob</p>' }),
      patch(alice, doc.id, { baseVersion: 1, title: 'Race doc renamed' }),
    ]);
    const statuses = results.map((r) => r.status).sort();
    assert.deepEqual(statuses, [200, 409, 409]);
    const latest = (await getDoc(alice, doc.id)).body.document;
    assert.equal(latest.version, 2);
  });
});

describe('validation and limits', () => {
  test('titles: default, trimming, 200 character limit, unicode', async () => {
    assert.equal((await create(alice, {})).title, 'Untitled document');
    assert.equal((await create(alice, { title: '   ' })).title, 'Untitled document');
    assert.equal((await create(alice, { title: '  Plan\nfor\tQ4  ' })).title, 'Plan for Q4');
    const exact = 'a'.repeat(200);
    assert.equal((await create(alice, { title: exact })).title, exact);
    const emoji = '\u{1F600}'.repeat(200); // 200 characters, 400 UTF-16 units
    assert.equal((await create(alice, { title: emoji })).title, emoji);
    const hindi = await create(alice, { title: 'नमस्ते दुनिया', content: '<p>café 日本語 \u{1F680}</p>' });
    const reread = (await getDoc(alice, hindi.id)).body.document;
    assert.equal(reread.title, 'नमस्ते दुनिया');
    assert.equal(reread.content, '<p>café 日本語 \u{1F680}</p>');

    const long = await api.call('POST', '/documents', { cookie: alice, body: { title: 'a'.repeat(201) } });
    assert.equal(long.status, 400);
    assert.equal(long.body.code, 'invalid_input');
    const wrongType = await api.call('POST', '/documents', { cookie: alice, body: { title: 7 } });
    assert.equal(wrongType.status, 400);

    const doc = await create(alice, { title: 'Rename me' });
    const empty = await patch(alice, doc.id, { baseVersion: 1, title: '   ' });
    assert.equal(empty.status, 400);
    const tooLong = await patch(alice, doc.id, { baseVersion: 1, title: 'b'.repeat(201) });
    assert.equal(tooLong.status, 400);
    const renamed = await patch(alice, doc.id, { baseVersion: 1, title: '  New name  ' });
    assert.equal(renamed.body.document.title, 'New name');
  });

  test('content: 500,000 characters at most (413), must be a string', async () => {
    const big = `<p>${'x'.repeat(500_000)}</p>`;
    const res = await api.call('POST', '/documents', { cookie: alice, body: { content: big } });
    assert.equal(res.status, 413);
    assert.equal(res.body.code, 'too_large');
    const doc = await create(alice, { title: 'Size doc' });
    const patched = await patch(alice, doc.id, { baseVersion: 1, content: big });
    assert.equal(patched.status, 413);
    const wrongType = await patch(alice, doc.id, { baseVersion: 1, content: { html: '<p>x</p>' } });
    assert.equal(wrongType.status, 400);
    const nearLimit = await patch(alice, doc.id, { baseVersion: 1, content: `<p>${'y'.repeat(400_000)}</p>` });
    assert.equal(nearLimit.status, 200);
  });

  test('PATCH needs an integer baseVersion and something to save', async () => {
    const doc = await create(alice, { title: 'Version rules' });
    for (const baseVersion of [undefined, null, '1', 1.5, 0, -1, 2 ** 31]) {
      const res = await patch(alice, doc.id, { baseVersion, title: 'x' });
      assert.equal(res.status, 400, `baseVersion ${baseVersion}`);
      assert.equal(res.body.code, 'invalid_input');
    }
    const nothing = await patch(alice, doc.id, { baseVersion: 1 });
    assert.equal(nothing.status, 400);
    const missingId = await api.call('GET', '/document', { cookie: alice });
    assert.equal(missingId.status, 400);
    const future = await patch(alice, doc.id, { baseVersion: 99, title: 'x' });
    assert.equal(future.status, 409);
  });

  test('bodies must be JSON objects sent as application/json', async () => {
    const badJson = await api.call('POST', '/documents', { cookie: alice, body: '{"title":', raw: true });
    assert.equal(badJson.status, 400);
    assert.equal(badJson.body.code, 'invalid_input');
    const array = await api.call('POST', '/documents', { cookie: alice, body: [1, 2] });
    assert.equal(array.status, 400);
    const text = await api.call('POST', '/documents', {
      cookie: alice,
      body: 'title=x',
      raw: true,
      headers: { 'content-type': 'text/plain' },
    });
    assert.equal(text.status, 415);
  });

  test('NUL characters are removed instead of crashing Postgres', async () => {
    const doc = await create(alice, { title: 'Nul\u0000title', content: '<p>a\u0000b</p>' });
    assert.equal(doc.title, 'Nul title');
    assert.equal(doc.content, '<p>ab</p>');
  });

  test('NUL characters in ids and emails answer 400, not a server error', async () => {
    const doc = await create(alice, { title: 'Nul ids' });
    assert.equal((await getDoc(alice, `${doc.id}\u0000`)).status, 400);
    assert.equal((await patch(alice, `x\u0000`, { title: 'x', baseVersion: 1 })).status, 400);
    assert.equal((await share(alice, doc.id, 'bob@example.com\u0000', 'viewer')).status, 400);
    assert.equal((await api.call('GET', `/shares?documentId=${encodeURIComponent('a\u0000')}`, { cookie: alice })).status, 400);
    assert.equal((await api.call('POST', '/session', { body: { email: 'alice@example.com\u0000' } })).status, 400);
  });
});

describe('sanitizing', () => {
  test('scripts, event handlers, styles and javascript: links are removed; formatting stays', async () => {
    const dirty = [
      '<h1 style="color:red" onclick="x()">Title</h1>',
      '<p>Hello <strong>bold</strong> <b>b</b> <em>em</em> <i>i</i> <u>u</u> <s>s</s></p>',
      '<script>alert(1)</script>',
      '<p><a href="javascript:alert(1)">bad link</a> <a href="JaVaScRiPt:alert(1)">bad 2</a> <a href="jav&#x09;ascript:alert(1)">bad 3</a></p>',
      '<p><a href="https://example.com/x?a=1&b=2">good</a> <a href="mailto:a@example.com">mail</a> <a href="/relative">rel</a> <a href="//evil.example">proto</a> <a href="data:text/html,hi">data</a></p>',
      '<img src="x" onerror="alert(1)"><iframe src="https://evil.example"></iframe><svg onload="alert(1)"><text>svg</text></svg>',
      '<style>p{}</style><h2>H2</h2><h3>H3</h3><h4>H4</h4><ul><li><p>one</p></li></ul><ol><li><p>two</p></li></ol>',
      '<blockquote><p>q</p></blockquote><pre><code class="language-js">let a = 1 &lt; 2;</code></pre><hr><p>line<br>break</p>',
    ].join('');
    const doc = await create(alice, { title: 'Dirty', content: dirty });
    const html = doc.content;
    for (const banned of ['<script', 'alert(1)', 'javascript', 'onerror', 'onclick', 'onload', 'style', '<img', '<iframe', '<svg', 'data:text', '/relative', '//evil', 'class=']) {
      assert.ok(!html.toLowerCase().includes(banned.toLowerCase()), `"${banned}" must be removed from ${html}`);
    }
    for (const kept of ['<h1>Title</h1>', '<strong>bold</strong>', '<b>b</b>', '<em>em</em>', '<i>i</i>', '<u>u</u>', '<s>s</s>', '<h2>H2</h2>', '<h3>H3</h3>', '<h3>H4</h3>', '<ul><li><p>one</p></li></ul>', '<ol><li><p>two</p></li></ol>', '<blockquote><p>q</p></blockquote>', '<pre><code>let a = 1 &lt; 2;</code></pre>', '<hr />', '<br />', '<a href="https://example.com/x?a=1&amp;b=2">good</a>', '<a href="mailto:a@example.com">mail</a>']) {
      assert.ok(html.includes(kept), `"${kept}" must survive in ${html}`);
    }
    // PATCH is sanitized the same way
    const saved = await patch(alice, doc.id, { baseVersion: 1, content: '<p onmouseover="x">ok</p><script>steal()</script>' });
    assert.equal(saved.body.document.content, '<p>ok</p>');
  });
});

describe('sharing', () => {
  test('upsert changes the role, emails are case insensitive, bad input is refused', async () => {
    const doc = await create(alice, { title: 'Share rules' });
    const first = await share(alice, doc.id, 'BOB@example.com', 'viewer');
    assert.equal(first.status, 201);
    assert.deepEqual(
      { userId: first.body.share.userId, email: first.body.share.email, name: first.body.share.name, role: first.body.share.role },
      { userId: 'u_bob', email: 'bob@example.com', name: 'Bob Smith', role: 'viewer' },
    );
    assert.ok(!Number.isNaN(Date.parse(first.body.share.createdAt)));
    assert.equal((await getDoc(bob, doc.id)).body.document.role, 'viewer');

    const upgraded = await share(alice, doc.id, 'bob@example.com', 'editor');
    assert.equal(upgraded.status, 201);
    assert.equal(upgraded.body.share.role, 'editor');
    const list = (await api.call('GET', `/shares?documentId=${doc.id}`, { cookie: alice })).body;
    assert.equal(list.shares.length, 1, 'still one row after the role change');
    assert.equal(list.shares[0].role, 'editor');
    assert.deepEqual(list.owner, { id: 'u_alice', email: 'alice@example.com', name: 'Alice Johnson' });
    assert.equal((await getDoc(bob, doc.id)).body.document.role, 'editor');

    const unknown = await share(alice, doc.id, 'nobody@example.com', 'viewer');
    assert.equal(unknown.status, 404);
    assert.equal(unknown.body.code, 'unknown_user');
    const self = await share(alice, doc.id, 'alice@example.com', 'editor');
    assert.equal(self.status, 400);
    assert.equal(self.body.code, 'invalid_input');
    for (const role of ['owner', 'admin', '', undefined, 3]) {
      const res = await share(alice, doc.id, 'carol@example.com', role);
      assert.equal(res.status, 400, `role ${role}`);
    }
    const missingEmail = await share(alice, doc.id, '', 'viewer');
    assert.equal(missingEmail.status, 400);
    const missingDoc = await api.call('POST', '/shares', { cookie: alice, body: { email: 'bob@example.com', role: 'viewer' } });
    assert.equal(missingDoc.status, 400);
    const otherDoc = await share(alice, 'no-such-doc', 'bob@example.com', 'viewer');
    assert.equal(otherDoc.status, 404);
    assert.equal(otherDoc.body.code, 'not_found');

    const removed = await api.call('DELETE', `/shares?documentId=${doc.id}&userId=u_bob`, { cookie: alice });
    assert.deepEqual(removed.body, { ok: true, removed: true });
    const removedAgain = await api.call('DELETE', `/shares?documentId=${doc.id}&userId=u_bob`, { cookie: alice });
    assert.deepEqual(removedAgain.body, { ok: true, removed: false });
    assert.equal((await getDoc(bob, doc.id)).status, 404);
    const missingUser = await api.call('DELETE', `/shares?documentId=${doc.id}`, { cookie: alice });
    assert.equal(missingUser.status, 400);
  });
});

describe('listing order', () => {
  test('documents are sorted by last update, newest first', async () => {
    const older = await create(bob, { title: 'Older' });
    const newer = await create(bob, { title: 'Newer' });
    let owned = (await api.call('GET', '/documents', { cookie: bob })).body.owned.map((d) => d.id);
    assert.ok(owned.indexOf(newer.id) < owned.indexOf(older.id));
    await patch(bob, older.id, { baseVersion: 1, content: '<p>touched</p>' });
    owned = (await api.call('GET', '/documents', { cookie: bob })).body.owned.map((d) => d.id);
    assert.equal(owned[0], older.id);
  });
});
