// Import tests: .txt, .md and a real (generated) .docx, plus every refusal path.
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { b64, makeDocx, makeZip, startApi, stopApi } from './_helpers.mjs';

let server;
let api;
let alice;

before(async () => {
  ({ server, api } = await startApi(5292));
  alice = await api.signIn('alice@example.com');
});

after(() => stopApi(server));

const importFile = (filename, contentBase64, cookie = alice) =>
  api.call('POST', '/import', { cookie, body: { filename, contentBase64 } });

describe('import creates a new document', () => {
  test('.txt: each line is an escaped paragraph, title from the file name', async () => {
    const text = '\nFirst line\r\nSecond <b>not bold</b> & more\n\nAfter a blank line\n\n';
    const res = await importFile('Meeting notes.txt', b64(text));
    assert.equal(res.status, 201, res.text);
    const doc = res.body.document;
    assert.equal(doc.title, 'Meeting notes');
    assert.equal(doc.role, 'owner');
    assert.equal(doc.ownerId, 'u_alice');
    assert.equal(doc.version, 1);
    assert.equal(doc.content, '<p>First line</p><p>Second &lt;b&gt;not bold&lt;/b&gt; &amp; more</p><p></p><p>After a blank line</p>');
    const list = (await api.call('GET', '/documents', { cookie: alice })).body;
    assert.ok(list.owned.some((d) => d.id === doc.id));
  });

  test('.txt: unicode with a UTF-8 byte order mark, and UTF-16 text', async () => {
    const utf8 = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('नमस्ते \u{1F680} café', 'utf8')]);
    const res = await importFile('unicode.txt', utf8.toString('base64'));
    assert.equal(res.status, 201, res.text);
    assert.equal(res.body.document.content, '<p>नमस्ते \u{1F680} café</p>');
    const utf16 = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('Hello from Notepad', 'utf16le')]);
    const res16 = await importFile('notepad.txt', utf16.toString('base64'));
    assert.equal(res16.status, 201, res16.text);
    assert.equal(res16.body.document.content, '<p>Hello from Notepad</p>');
  });

  test('.md and .markdown: headings, emphasis and lists; raw HTML is sanitized', async () => {
    const md = [
      '# Plan',
      '',
      'Some **bold** and *italic* text with [a link](https://example.com) and [bad](javascript:alert(1)).',
      '',
      '- one',
      '- two',
      '',
      '1. first',
      '2. second',
      '',
      '<script>alert(1)</script>',
      '<img src=x onerror=alert(1)>',
    ].join('\n');
    const res = await importFile('plan.MD', b64(md));
    assert.equal(res.status, 201, res.text);
    const html = res.body.document.content;
    assert.equal(res.body.document.title, 'plan');
    for (const kept of ['<h1>Plan</h1>', '<strong>bold</strong>', '<em>italic</em>', '<ul>', '<li>one</li>', '<ol>', '<a href="https://example.com">a link</a>']) {
      assert.ok(html.includes(kept), `${kept} in ${html}`);
    }
    for (const banned of ['<script', 'alert(1)', 'onerror', '<img', 'javascript']) assert.ok(!html.includes(banned), `${banned} removed from ${html}`);
    const longExt = await importFile('notes.markdown', b64('## Sub heading'));
    assert.equal(longExt.status, 201);
    assert.equal(longExt.body.document.content, '<h2>Sub heading</h2>');
  });

  test('.docx: paragraphs with bold, italic and underline (generated fixture)', async () => {
    const docx = makeDocx(
      '<w:p><w:r><w:t>Quarterly plan</w:t></w:r></w:p>' +
        '<w:p><w:r><w:rPr><w:b/></w:rPr><w:t>Bold start</w:t></w:r>' +
        '<w:r><w:t xml:space="preserve"> then plain &amp; </w:t></w:r>' +
        '<w:r><w:rPr><w:i/></w:rPr><w:t>italic</w:t></w:r>' +
        '<w:r><w:t xml:space="preserve"> and </w:t></w:r>' +
        '<w:r><w:rPr><w:u w:val="single"/></w:rPr><w:t>underlined</w:t></w:r></w:p>',
    );
    const res = await importFile('Q4 plan.docx', docx.toString('base64'));
    assert.equal(res.status, 201, res.text);
    assert.equal(res.body.document.title, 'Q4 plan');
    assert.equal(
      res.body.document.content,
      '<p>Quarterly plan</p><p><strong>Bold start</strong> then plain &amp; <em>italic</em> and <u>underlined</u></p>',
    );
  });

  test('a data: URL prefix (FileReader.readAsDataURL) is accepted', async () => {
    const res = await importFile('data-url.txt', `data:text/plain;base64,${b64('From a data URL')}`);
    assert.equal(res.status, 201, res.text);
    assert.equal(res.body.document.content, '<p>From a data URL</p>');
  });

  test('title edge cases: no name before the extension, very long names', async () => {
    const noStem = await importFile('.md', b64('# Only an extension'));
    assert.equal(noStem.status, 201);
    assert.equal(noStem.body.document.title, 'Untitled document');
    const longName = `${'n'.repeat(300)}.txt`;
    const long = await importFile(longName, b64('long name'));
    assert.equal(long.status, 201);
    assert.equal(long.body.document.title, 'n'.repeat(200));
    const withPath = await importFile('C:\\fakepath\\report.final.txt', b64('x'));
    assert.equal(withPath.body.document.title, 'report.final');
  });
});

describe('import refusals', () => {
  test('unsupported file types are 415', async () => {
    for (const name of ['report.pdf', 'image.png', 'noextension', 'archive.docx.zip', 'old.doc']) {
      const res = await importFile(name, b64('hello'));
      assert.equal(res.status, 415, name);
      assert.equal(res.body.code, 'unsupported_type');
    }
  });

  test('files over 2 MB are 413', async () => {
    const big = Buffer.alloc(2 * 1024 * 1024 + 1, 0x61);
    const res = await importFile('big.txt', big.toString('base64'));
    assert.equal(res.status, 413);
    assert.equal(res.body.code, 'too_large');
  });

  test('a file whose text is over the content limit is 413', async () => {
    const lines = Array.from({ length: 70_000 }, () => 'line').join('\n'); // about 0.35 MB of text, 0.77 MB of HTML
    const res = await importFile('many-lines.txt', b64(lines));
    assert.equal(res.status, 413);
    assert.equal(res.body.code, 'too_large');
  });

  test('empty, blank, binary and broken files are 422', async () => {
    const cases = [
      ['empty.txt', ''],
      ['blank.txt', b64('   \n\n\t ')],
      ['binary.txt', Buffer.from([0xff, 0xd8, 0xff, 0x00, 0x10]).toString('base64')],
      ['nul.txt', b64('abc\u0000def')],
      ['broken.docx', b64('this is not a zip file')],
      ['wrong-zip.docx', makeZip({ 'hello.txt': 'not a word document' }).toString('base64')],
      ['empty-body.docx', makeDocx('').toString('base64')],
      ['only-html.md', b64('<script>alert(1)</script>')],
    ];
    for (const [name, data] of cases) {
      const res = await importFile(name, data);
      assert.equal(res.status, 422, `${name}: ${res.text}`);
      assert.equal(res.body.code, 'unreadable_file');
    }
    const zeroBytes = await importFile('zero.txt', '====');
    assert.ok([400, 422].includes(zeroBytes.status), `zero byte file: ${zeroBytes.status}`);
  });

  test('.docx zip bomb: a tiny file that unzips past 4 MB is 413 before mammoth parses it', async () => {
    const tiny = '<w:p><w:r><w:t>a</w:t></w:r></w:p>';
    const bomb = makeDocx(tiny.repeat(Math.ceil((20 * 1024 * 1024) / tiny.length)), { deflate: true });
    assert.ok(bomb.length < 100_000, `fixture is small: ${bomb.length} bytes`);
    const started = Date.now();
    const res = await importFile('bomb.docx', bomb.toString('base64'));
    assert.equal(res.status, 413, res.text);
    assert.equal(res.body.code, 'too_large');
    assert.ok(Date.now() - started < 3000, `answered in ${Date.now() - started} ms`);
    // A normal deflated .docx (as Word writes it) still imports.
    const ok = await importFile('deflated.docx', makeDocx('<w:p><w:r><w:t>Compressed fine</w:t></w:r></w:p>', { deflate: true }).toString('base64'));
    assert.equal(ok.status, 201, ok.text);
    assert.equal(ok.body.document.content, '<p>Compressed fine</p>');
  });

  test('.md with thousands of unclosed * or _ is 413 fast, normal formatting still imports', async () => {
    for (const unit of ['_a ', '*a ', '~_a', '*_a']) {
      const started = Date.now();
      const res = await importFile('slow.md', b64(unit.repeat(20_000)));
      assert.equal(res.status, 413, `${unit}: ${res.text}`);
      assert.equal(res.body.code, 'too_large');
      assert.ok(Date.now() - started < 2000, `${unit} answered in ${Date.now() - started} ms`);
    }
    const busy = Array.from({ length: 300 }, (_, i) => `Para ${i} has **bold** and _italic_ and some_snake_case words.`).join('\n\n');
    const res = await importFile('busy.md', b64(busy));
    assert.equal(res.status, 201, res.text);
  });

  test('missing or malformed fields are 400', async () => {
    const cases = [
      { contentBase64: b64('x') },
      { filename: 'a.txt' },
      { filename: '   ', contentBase64: b64('x') },
      { filename: 42, contentBase64: b64('x') },
      { filename: 'a.txt', contentBase64: 'not base64 !!!' },
      { filename: 'a.txt', contentBase64: 12 },
    ];
    for (const body of cases) {
      const res = await api.call('POST', '/import', { cookie: alice, body });
      assert.equal(res.status, 400, JSON.stringify(body));
      assert.equal(res.body.code, 'invalid_input');
    }
  });
});
