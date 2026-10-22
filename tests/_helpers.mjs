// Shared test helpers (this file is not a test itself). Every test file runs in its own process
// with its own in memory PGlite database, so files never share state.
import assert from 'node:assert/strict';
import { crc32, deflateRawSync } from 'node:zlib';
import { startDevApi } from '../dev-api.mjs';

// Never let a test touch a real database: drop any connection string the shell may carry.
export function isolateEnv() {
  delete process.env.DATABASE_URL;
  delete process.env.POSTGRES_URL;
  delete process.env.VERCEL;
  process.env.PGLITE_DIR = 'memory://';
  process.env.SESSION_SECRET = 'test-only-secret';
  // The other suites make many requests from one address in seconds, so they run with roomy demo
  // limits. tests/limits.test.mjs lowers each limit to prove it holds; production uses the defaults.
  for (const name of ['DEMO_MAX_DOCS', 'DEMO_CREATE_PER_10_MIN', 'DEMO_SAVES_PER_MIN', 'DEMO_SHARES_PER_MIN', 'DEMO_SIGNINS_PER_MIN']) {
    process.env[name] ??= '100000';
  }
}

export async function startApi(port) {
  isolateEnv();
  const server = await startDevApi({ port });
  const api = client(`http://127.0.0.1:${port}/api`);
  const health = await api.call('GET', '/health');
  if (health.body?.db !== 'pglite') {
    server.close();
    throw new Error(`Refusing to run tests: expected the PGlite test database, got ${JSON.stringify(health.body)}`);
  }
  return { server, api };
}

export function stopApi(server) {
  server?.closeAllConnections?.();
  server?.close();
}

export function client(base) {
  async function call(method, path, { cookie, body, headers = {}, raw = false } = {}) {
    const init = { method, headers: { ...headers } };
    if (cookie) init.headers.cookie = cookie;
    if (body !== undefined) {
      if (!init.headers['content-type']) init.headers['content-type'] = 'application/json';
      init.body = raw ? body : JSON.stringify(body);
    }
    const res = await fetch(base + path, init);
    const text = await res.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    return { status: res.status, body: json, headers: res.headers, text };
  }

  // Signs in and returns the "ajaia_session=..." pair to send as a Cookie header.
  async function signIn(email) {
    const res = await call('POST', '/session', { body: { email } });
    assert.equal(res.status, 200, `sign in as ${email}: ${res.text}`);
    const [setCookie] = res.headers.getSetCookie();
    return setCookie.split(';')[0];
  }

  return { call, signIn };
}

// Minimal zip writer (stored, or deflated with { deflate: true }) so a real .docx can be built without extra packages.
export function makeZip(entries, { deflate = false } = {}) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const [name, content] of Object.entries(entries)) {
    const nameBytes = Buffer.from(name, 'utf8');
    const raw = Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf8');
    const crc = crc32(raw);
    const data = deflate ? deflateRawSync(raw, { level: 9 }) : raw;
    const method = deflate ? 8 : 0;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0x21, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    local.writeUInt16LE(0, 28);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0x21, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, nameBytes, data);
    centrals.push(central, nameBytes);
    offset += local.length + nameBytes.length + data.length;
  }
  const centralDir = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  const count = Object.keys(entries).length;
  end.writeUInt16LE(count, 8);
  end.writeUInt16LE(count, 10);
  end.writeUInt32LE(centralDir.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, centralDir, end]);
}

// A tiny but valid Word document: [Content_Types].xml, _rels/.rels and word/document.xml.
export function makeDocx(bodyXml, options) {
  return makeZip({
    '[Content_Types].xml':
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
      '</Types>',
    '_rels/.rels':
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
      '</Relationships>',
    'word/document.xml':
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' +
      bodyXml +
      '</w:body></w:document>',
  }, options);
}

export const b64 = (value) => Buffer.from(value).toString('base64');
