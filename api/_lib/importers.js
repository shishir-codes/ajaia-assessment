// File import: .txt, .md / .markdown and .docx become sanitized HTML for a NEW document.
import { inflateRawSync } from 'node:zlib';
import mammoth from 'mammoth';
import { Marked } from 'marked';
import { HttpError, invalidInput, tooLarge } from './errors.js';
import { isBlankHtml, sanitizeContent, textToHtml } from './sanitize.js';
import { CONTENT_MAX, DEFAULT_TITLE, TITLE_MAX } from './validate.js';

export const IMPORT_MAX_BYTES = 2 * 1024 * 1024;
const KINDS = { '.txt': 'text', '.md': 'markdown', '.markdown': 'markdown', '.docx': 'docx' };
const BASE64 = /^[A-Za-z0-9+/_-]*={0,2}$/;

const markdown = new Marked({ gfm: true, breaks: false, async: false });

const unreadable = (message = 'That file could not be read. Check that it is a valid .txt, .md or .docx file with some text in it.') =>
  new HttpError(422, 'unreadable_file', message);

function splitName(filename) {
  const base = filename.split(/[\\/]/).pop() || '';
  const dot = base.lastIndexOf('.');
  if (dot === -1) return { stem: base, ext: '' };
  return { stem: base.slice(0, dot), ext: base.slice(dot).toLowerCase() };
}

export function titleFromFilename(filename) {
  const { stem } = splitName(filename);
  const clean = stem.replace(/[\u0000-\u001f\u007f]+/g, ' ').trim();
  return Array.from(clean).slice(0, TITLE_MAX).join('').trim() || DEFAULT_TITLE;
}

export function fileKind(filename) {
  return KINDS[splitName(filename).ext] || null;
}

// Base64 (optionally a data: URL, as FileReader.readAsDataURL gives) to bytes, with the 2 MB cap
// checked before decoding.
export function decodeBase64(value) {
  if (typeof value !== 'string') throw invalidInput('contentBase64 must be a base64 string.');
  let text = value.trim();
  const comma = text.indexOf(',');
  if (text.startsWith('data:') && comma !== -1) text = text.slice(comma + 1);
  text = text.replace(/\s+/g, '');
  if (!BASE64.test(text) || text.length % 4 === 1) throw invalidInput('contentBase64 is not valid base64.');
  const padding = text.endsWith('==') ? 2 : text.endsWith('=') ? 1 : 0;
  const estimatedBytes = Math.floor((text.length * 3) / 4) - padding;
  if (estimatedBytes > IMPORT_MAX_BYTES) throw tooLarge('The file is larger than 2 MB.');
  const bytes = Buffer.from(text, 'base64');
  if (bytes.length > IMPORT_MAX_BYTES) throw tooLarge('The file is larger than 2 MB.');
  return bytes;
}

// Text files: UTF-8 (with or without a byte order mark) or UTF-16 with a byte order mark.
// Anything else, or text with NUL bytes, is treated as a binary file and refused.
export function decodeText(bytes) {
  let text;
  try {
    if (bytes[0] === 0xff && bytes[1] === 0xfe) text = new TextDecoder('utf-16le', { fatal: true }).decode(bytes.subarray(2));
    else if (bytes[0] === 0xfe && bytes[1] === 0xff) text = new TextDecoder('utf-16be', { fatal: true }).decode(bytes.subarray(2));
    else text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(bytes);
  } catch {
    throw unreadable('That file is not readable text (expected UTF-8).');
  }
  if (text.includes('\u0000')) throw unreadable('That file looks like a binary file, not text.');
  return text;
}

// A .docx file is a zip archive. A tiny archive can unzip to gigabytes (a "zip bomb"), and mammoth builds a
// large object tree for every paragraph (measured: 4 MB of unzipped XML peaks at about 700 MB of memory, 20 MB
// runs out of memory). So the total unzipped size is capped BEFORE mammoth sees the file. The sizes written in
// the zip headers can be faked, so every entry is really inflated, with a hard cap on the output. The reading
// rules mirror JSZip (which mammoth uses), so both see the same entries; anything unusual is refused.
export const DOCX_UNZIPPED_MAX_BYTES = 4 * 1024 * 1024;
const DOCX_MAX_ENTRIES = 2000;

export function assertDocxWithinLimits(bytes, budget = DOCX_UNZIPPED_MAX_BYTES) {
  const invalid = () => unreadable('That .docx file is not a valid Word document.');
  const tooBig = () =>
    tooLarge(`That Word file unzips to more than ${budget / 1024 / 1024} MB, which is more than can be imported. Try a shorter document.`);
  // End of central directory: 22 bytes plus a comment of up to 65,535 bytes. JSZip uses the last one in the file.
  let eocd = -1;
  for (let i = bytes.length - 22; i >= 0 && i >= bytes.length - 22 - 0xffff; i--) {
    if (bytes.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd === -1) throw invalid();
  const cdSize = bytes.readUInt32LE(eocd + 12);
  const cdOffset = bytes.readUInt32LE(eocd + 16);
  // Zip64 markers, or a central directory that does not end where the end record starts (JSZip would then
  // shift every offset), never occur in a normal Word file of this size: refuse instead of guessing.
  if ([4, 6, 8, 10].some((at) => bytes.readUInt16LE(eocd + at) === 0xffff) || cdOffset + cdSize !== eocd) throw invalid();
  let remaining = budget;
  let entries = 0;
  // Like JSZip: read central directory headers for as long as the signature matches.
  for (let p = cdOffset; p + 46 <= bytes.length && bytes.readUInt32LE(p) === 0x02014b50; ) {
    if (++entries > DOCX_MAX_ENTRIES) throw invalid();
    const method = bytes.readUInt16LE(p + 10);
    const compressedSize = bytes.readUInt32LE(p + 20);
    const local = bytes.readUInt32LE(p + 42);
    p += 46 + bytes.readUInt16LE(p + 28) + bytes.readUInt16LE(p + 30) + bytes.readUInt16LE(p + 32);
    if (local + 30 > bytes.length || bytes.readUInt32LE(local) !== 0x04034b50) throw invalid();
    const start = local + 30 + bytes.readUInt16LE(local + 26) + bytes.readUInt16LE(local + 28);
    const data = bytes.subarray(start, start + compressedSize);
    let size;
    if (method === 0) size = data.length;
    else if (method === 8) {
      try {
        size = inflateRawSync(data, { maxOutputLength: Math.max(1, remaining) }).length;
      } catch (err) {
        if (err?.code === 'ERR_BUFFER_TOO_LARGE') throw tooBig();
        throw invalid();
      }
    } else throw invalid();
    remaining -= size;
    if (remaining < 0) throw tooBig();
  }
  if (!entries) throw invalid();
}

// marked's emphasis parsing slows down sharply (quadratic) when one paragraph holds many *, _ or ~ characters
// that never close: 30 KB of "_a " takes about 10 s and blocks the server. Measured: 1,000 in one block takes
// about 0.1 s, and a budget of 4 million for the sum of (count in a block) squared keeps the worst case under
// about 1 s. Real documents are far below this (a 230 KB heavily formatted file uses about 0.2 million).
// Blocks are split at blank lines, which an inline run never crosses, so this can only over count.
const MD_DELIMITERS_PER_BLOCK = 1000;
const MD_DELIMITER_BUDGET = 4_000_000;

export function assertMarkdownWithinLimits(text) {
  const tooComplex = () =>
    tooLarge('That Markdown file has too many *, _ or ~ formatting characters in one place to import safely. Try a smaller or simpler file.');
  let budget = MD_DELIMITER_BUDGET;
  for (const block of text.replace(/\r\n?/g, '\n').split(/\n[ \t]*\n/)) {
    let count = 0;
    for (let i = 0; i < block.length; i++) {
      const c = block.charCodeAt(i);
      if (c === 42 || c === 95 || c === 126) count++; // * _ ~
    }
    budget -= count * count;
    if (count > MD_DELIMITERS_PER_BLOCK || budget < 0) throw tooComplex();
  }
}

async function docxToHtml(bytes) {
  // A .docx file is a zip archive, which always starts with "PK".
  if (bytes.length < 4 || bytes[0] !== 0x50 || bytes[1] !== 0x4b) throw unreadable('That .docx file is not a valid Word document.');
  assertDocxWithinLimits(bytes);
  try {
    const result = await mammoth.convertToHtml(
      { buffer: bytes },
      {
        styleMap: ['u => u'],
        // Images are not supported: skip them instead of inlining them as huge data URLs.
        convertImage: mammoth.images.imgElement(async () => ({ src: '' })),
      },
    );
    return result.value || '';
  } catch {
    throw unreadable('That .docx file could not be read.');
  }
}

export async function fileToHtml(kind, bytes) {
  if (!bytes.length) throw unreadable('That file is empty.');
  let html;
  if (kind === 'text') html = textToHtml(decodeText(bytes));
  else if (kind === 'markdown') {
    const text = decodeText(bytes);
    assertMarkdownWithinLimits(text);
    try {
      html = markdown.parse(text);
    } catch (err) {
      if (err instanceof HttpError) throw err;
      throw unreadable('That Markdown file could not be read.');
    }
  } else if (kind === 'docx') html = await docxToHtml(bytes);
  else throw new HttpError(415, 'unsupported_type', 'Only .txt, .md and .docx files can be imported.');

  const clean = sanitizeContent(html);
  if (isBlankHtml(clean)) throw unreadable('That file has no text to import.');
  if (clean.length > CONTENT_MAX) {
    throw tooLarge(`The imported document is too large (${CONTENT_MAX.toLocaleString('en-US')} characters of formatted text at most).`);
  }
  return clean;
}
