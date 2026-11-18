/* Render shared documentation as inert, sanitized HTML. Keep the parser local. */
import { Marked } from 'marked';
import createDOMPurify from 'dompurify';

const escape = value => String(value).replace(/[&<>"']/g, character => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
})[character]);

function safeURL(value) {
  // Absolute web/mail links only: no script/data/file schemes, relative API
  // requests, control-character tricks, or protocol-relative destinations.
  if (typeof value !== 'string' || !/^(?:https?:\/\/|mailto:)/i.test(value) || /[\u0000-\u001f\u007f-\u009f]/u.test(value)) return null;
  try {
    const url = new URL(value);
    return ['https:', 'http:', 'mailto:'].includes(url.protocol) ? url.href : null;
  } catch (_) { return null; }
}

const markdown = new Marked({
  gfm: true, async: false, breaks: false,
  renderer: {
    html({ text }) { return escape(text); },
    link({ href, title, tokens }) {
      const text = this.parser.parseInline(tokens), destination = safeURL(href);
      return destination ? `<a href="${escape(destination)}" target="_blank" rel="noopener noreferrer"${title ? ` title="${escape(title)}"` : ''}>${text}</a>` : text;
    },
    image({ href, title, text }) {
      // Notes are text documents. Linking images retains the existing CSP and
      // prevents a viewer's browser from contacting an arbitrary image host.
      const destination = safeURL(href), label = escape(text || title || href);
      return destination ? `<a href="${escape(destination)}" target="_blank" rel="noopener noreferrer">${label}</a>` : label;
    },
    checkbox({ checked }) { return checked ? '[x] ' : '[ ] '; }
  }
});

const purifier = createDOMPurify(window);
const policy = {
  ALLOWED_TAGS: ['p', 'br', 'hr', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li',
    'strong', 'em', 'del', 'blockquote', 'pre', 'code', 'a', 'table', 'thead', 'tbody', 'tr', 'th', 'td'],
  ALLOWED_ATTR: ['href', 'title', 'target', 'rel', 'start', 'align'],
  ALLOW_DATA_ATTR: false, ALLOW_ARIA_ATTR: false,
  SANITIZE_DOM: true, SANITIZE_NAMED_PROPS: true,
  RETURN_TRUSTED_TYPE: false
};
purifier.addHook('uponSanitizeAttribute', (node, event) => {
  if (event.attrName === 'href') {
    const destination = node.nodeName === 'A' && safeURL(event.attrValue);
    if (!destination) event.keepAttr = false;
    else event.attrValue = destination;
  }
  if (event.attrName === 'target' && (node.nodeName !== 'A' || event.attrValue !== '_blank')) event.keepAttr = false;
  if (event.attrName === 'rel' && (node.nodeName !== 'A' || event.attrValue !== 'noopener noreferrer')) event.keepAttr = false;
  if (event.attrName === 'align' && !['left', 'center', 'right'].includes(event.attrValue)) event.keepAttr = false;
  if (event.attrName === 'start' && (node.nodeName !== 'OL' || !/^\d{1,9}$/.test(event.attrValue))) event.keepAttr = false;
});

function render(source) {
  if (typeof source !== 'string' || !source) return '';
  if (!purifier.isSupported) return `<pre>${escape(source)}</pre>`;
  try { return purifier.sanitize(markdown.parse(source), policy); }
  catch (_) { return `<pre>${escape(source)}</pre>`; }
}

window.CampaignMarkdown = Object.freeze({ render });
