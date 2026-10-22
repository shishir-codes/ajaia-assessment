// Unit tests for the pieces that do not need HTTP: sanitizer, session signing, seeding twice.
import assert from 'node:assert/strict';
import { before, describe, test } from 'node:test';
import { isolateEnv } from './_helpers.mjs';

isolateEnv();
const { isBlankHtml, sanitizeContent, textToHtml } = await import('../api/_lib/sanitize.js');
const { sessionCookieValue, verifySessionValue } = await import('../api/_lib/session.js');
const { query, resetReadyForTests } = await import('../api/_lib/db.js');

describe('sanitizer', () => {
  test('dangerous markup is removed', () => {
    const cases = {
      '<p>a</p><script>alert(1)</script>': '<p>a</p>',
      '<a href=" javascript:alert(1)">x</a>': '<a>x</a>',
      '<a href="vbscript:msgbox(1)">x</a>': '<a>x</a>',
      '<a href="data:text/html;base64,PHNjcmlwdD4=">x</a>': '<a>x</a>',
      '<a href="https://ok.example" target="_blank" rel="opener">x</a>': '<a href="https://ok.example">x</a>',
      '<p style="background:url(javascript:alert(1))" class="c" id="i">x</p>': '<p>x</p>',
      '<details open ontoggle="alert(1)"><summary>s</summary></details>': 's',
      '<math><mi>x</mi></math><p>after</p>': '<p>after</p>',
      '<noscript><p>hidden</p></noscript>': '',
      '<div><p>kept text</p></div>': '<p>kept text</p>',
    };
    for (const [input, expected] of Object.entries(cases)) assert.equal(sanitizeContent(input), expected, input);
  });

  test('deep nesting is cut off instead of passed through', () => {
    const deep = '<blockquote>'.repeat(200) + 'deep' + '</blockquote>'.repeat(200);
    const out = sanitizeContent(deep);
    assert.ok((out.match(/<blockquote>/g) || []).length <= 64);
    assert.ok(out.includes('deep'));
  });

  test('blank detection and plain text conversion', () => {
    assert.equal(isBlankHtml('<p></p><p>&nbsp;</p><hr />'), true);
    assert.equal(isBlankHtml('<p>x</p>'), false);
    assert.equal(textToHtml('a\r\nb\rc\n\nd'), '<p>a</p><p>b</p><p>c</p><p></p><p>d</p>');
    assert.equal(textToHtml('"quotes" & \'apostrophes\''), '<p>&quot;quotes&quot; &amp; &#39;apostrophes&#39;</p>');
  });
});

describe('session cookie signing', () => {
  test('a signed value verifies; tampering, truncation and another secret do not', () => {
    const value = sessionCookieValue('u_alice');
    assert.equal(verifySessionValue(value), 'u_alice');
    const [, sig] = value.split('.');
    assert.equal(verifySessionValue(`u_bob.${sig}`), null);
    assert.equal(verifySessionValue(`u_alice.${sig.slice(0, -1)}`), null);
    assert.equal(verifySessionValue(`u_alice.${sig.slice(0, -1)}${sig.endsWith('A') ? 'B' : 'A'}`), null);
    assert.equal(verifySessionValue(''), null);
    assert.equal(verifySessionValue(null), null);
    assert.equal(verifySessionValue('u_alice'), null);
    const previous = process.env.SESSION_SECRET;
    process.env.SESSION_SECRET = 'a-different-secret';
    try {
      assert.equal(verifySessionValue(value), null);
    } finally {
      process.env.SESSION_SECRET = previous;
    }
  });
});

describe('schema and seed on a second run', () => {
  before(async () => {
    await query('SELECT 1');
  });

  test('running setup again keeps users and does not bring deleted demo documents back', async () => {
    const [{ count: before }] = await query('SELECT count(*)::int AS count FROM documents');
    assert.equal(before, 2);
    await query("DELETE FROM documents WHERE title = 'Welcome to Ajaia Docs'");
    resetReadyForTests();
    const users = await query('SELECT id FROM users ORDER BY id');
    assert.deepEqual(users.map((u) => u.id), ['u_alice', 'u_bob', 'u_carol']);
    const docs = await query('SELECT title FROM documents ORDER BY title');
    assert.deepEqual(docs.map((d) => d.title), ['Team meeting notes']);
    const shares = await query('SELECT user_id, role FROM document_shares');
    assert.deepEqual(shares, [{ user_id: 'u_alice', role: 'viewer' }]);
  });
});
