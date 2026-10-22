// Every piece of document HTML goes through here before it is stored: editor saves, new
// documents and imports. The browser only ever renders it through TipTap.
import './htmlparser2-shim.js'; // must stay first: lets sanitize-html load on Vercel (see that file)
import sanitizeHtml from 'sanitize-html';

export const ALLOWED_TAGS = [
  'p', 'br', 'strong', 'b', 'em', 'i', 'u', 's', 'h1', 'h2', 'h3', 'ul', 'ol', 'li',
  'blockquote', 'code', 'pre', 'hr', 'a',
];

const SAFE_HREF = /^(https?:|mailto:)/i;

const OPTIONS = {
  allowedTags: ALLOWED_TAGS,
  allowedAttributes: { a: ['href'] },
  allowedSchemes: ['http', 'https', 'mailto'],
  allowedSchemesByTag: {},
  allowedSchemesAppliedToAttributes: ['href'],
  allowProtocolRelative: false,
  disallowedTagsMode: 'discard',
  // Tags whose text is dropped along with the tag (the defaults plus a few more).
  nonTextTags: ['script', 'style', 'textarea', 'option', 'noscript', 'template', 'title', 'head', 'svg', 'math', 'select', 'object'],
  nestingLimit: 64,
  transformTags: {
    // Lower headings (from Markdown or Word) keep their meaning as the smallest allowed heading.
    h4: 'h3',
    h5: 'h3',
    h6: 'h3',
    // Only absolute http, https and mailto links survive; relative and other hrefs are dropped.
    a: (tagName, attribs) => {
      const href = String(attribs.href || '').trim();
      return { tagName: 'a', attribs: SAFE_HREF.test(href) ? { href } : {} };
    },
  },
};

const TEXT_ONLY = { allowedTags: [], allowedAttributes: {}, nonTextTags: OPTIONS.nonTextTags };

export function sanitizeContent(html) {
  return sanitizeHtml(String(html ?? '').replace(/\u0000/g, ''), OPTIONS).trim();
}

// True when the HTML has no visible text at all (only tags, spaces or non breaking spaces).
export function isBlankHtml(html) {
  const text = sanitizeHtml(String(html ?? ''), TEXT_ONLY);
  return text.replace(/&nbsp;|&#160;|&#xa0;|\s/gi, '') === '';
}

export function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

// Plain text to HTML: every line becomes its own escaped paragraph (blank lines stay as empty
// paragraphs so spacing survives; leading and trailing blank lines are dropped).
export function textToHtml(text) {
  const lines = String(text).split(/\r\n|\r|\n/);
  while (lines.length && !lines[0].trim()) lines.shift();
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
  return lines.map((line) => (line.trim() ? `<p>${escapeHtml(line)}</p>` : '<p></p>')).join('');
}
