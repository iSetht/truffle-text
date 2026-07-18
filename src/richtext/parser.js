/**
 * Deterministic parser for the Flash/Habbo HTML subset.
 *
 * This intentionally is not an HTML5 parser. It accepts the formatting tags
 * Flash TextField consumers used and maps them to ordinary Truffle style
 * properties without touching the DOM, so Node and browsers behave alike.
 */

const VOID_TAGS = new Set(['br', 'hr', 'img', 'input', 'meta', 'link']);

export function parseRichText(markup, { baseStyle = null } = {}) {
  if (isDocument(markup)) return normalizeDocument(markup);
  if (Array.isArray(markup)) {
    return normalizeDocument({
      type: 'document',
      baseStyle,
      paragraphs: [{ type: 'paragraph', runs: markup }],
    });
  }

  const source = String(markup ?? '');
  const runs = [];
  const stack = [{ tag: '#root', style: {} }];
  const tokens = source.match(/<!--[\s\S]*?-->|<\/?[A-Za-z][^>]*>|[^<]+|</g) ?? [];

  const append = (text) => {
    if (!text) return;
    const decoded = decodeEntities(text);
    if (!decoded) return;
    const style = stack[stack.length - 1].style;
    const previous = runs[runs.length - 1];
    if (previous && shallowEqual(previous.style, style)) previous.text += decoded;
    else runs.push({ text: decoded, style: { ...style } });
  };

  for (const token of tokens) {
    if (!token.startsWith('<') || token === '<') {
      append(token);
      continue;
    }
    if (token.startsWith('<!--')) continue;
    const closing = /^<\s*\//.test(token);
    const name = token.match(/^<\s*\/?\s*([A-Za-z][\w:-]*)/)?.[1]?.toLowerCase();
    if (!name) {
      append(token);
      continue;
    }
    if (name === 'br' && !closing) {
      append('\n');
      continue;
    }
    if (closing) {
      const at = findOpenTag(stack, name);
      if (at > 0) {
        if ((name === 'p' || name === 'div') && !endsWithNewline(runs)) append('\n');
        stack.length = at;
      }
      continue;
    }

    const selfClosing = /\/\s*>$/.test(token);
    const attrs = parseAttributes(token);
    if ((name === 'p' || name === 'div') && runs.length && !endsWithNewline(runs)) append('\n');
    const parent = stack[stack.length - 1].style;
    const style = { ...parent, ...styleForTag(name, attrs) };
    // Unknown XML element names are transparent style containers. Habbo field
    // descriptors vary by component name, while their font_size/
    // antialias_type/etc. attributes use the stable vocabulary mapped above.
    if (!selfClosing && !VOID_TAGS.has(name)) stack.push({ tag: name, style });
  }

  return runsToDocument(runs, baseStyle);
}

export function plainTextOf(document) {
  const doc = normalizeDocument(document);
  return doc.paragraphs
    .map(paragraph => paragraph.runs.map(run => run.text).join(''))
    .join('\n');
}

export function normalizeDocument(document) {
  if (!isDocument(document)) return parseRichText(document);
  const paragraphs = [];
  for (const paragraph of document.paragraphs ?? []) {
    const runs = [];
    for (const run of paragraph?.runs ?? []) {
      const text = String(run?.text ?? '');
      if (!text) continue;
      const style = run.style ?? run.format ?? {};
      const previous = runs[runs.length - 1];
      if (previous && shallowEqual(previous.style, style)) previous.text += text;
      else runs.push({ text, style: { ...style } });
    }
    paragraphs.push({ type: 'paragraph', runs });
  }
  if (!paragraphs.length) paragraphs.push({ type: 'paragraph', runs: [] });
  return {
    type: 'document',
    baseStyle: document.baseStyle ?? null,
    paragraphs,
  };
}

export function isRichTextDocument(value) {
  return isDocument(value) || Array.isArray(value);
}

function runsToDocument(runs, baseStyle) {
  const paragraphs = [{ type: 'paragraph', runs: [] }];
  for (const run of runs) {
    const pieces = run.text.split('\n');
    for (let i = 0; i < pieces.length; i++) {
      if (pieces[i]) {
        const list = paragraphs[paragraphs.length - 1].runs;
        const previous = list[list.length - 1];
        if (previous && shallowEqual(previous.style, run.style)) previous.text += pieces[i];
        else list.push({ text: pieces[i], style: { ...run.style } });
      }
      if (i < pieces.length - 1) paragraphs.push({ type: 'paragraph', runs: [] });
    }
  }
  return { type: 'document', baseStyle, paragraphs };
}

function styleForTag(name, attrs) {
  const style = styleFromAttributes(attrs);
  if (name === 'b' || name === 'strong') style.bold = true;
  if (name === 'i' || name === 'em') style.italic = true;
  if (name === 'u' || name === 'a') style.underline = true;
  if (name === 'font') {
    if (attrs.face !== undefined) style.fontFamily = attrs.face;
    if (attrs.size !== undefined) style.size = numberOrString(attrs.size);
    if (attrs.color !== undefined) style.color = parseColor(attrs.color);
  }
  if (attrs.style) Object.assign(style, parseInlineStyle(attrs.style));
  return style;
}

function styleFromAttributes(attrs) {
  const style = {};
  const mappings = {
    font_size: ['size', numberOrString],
    fontsize: ['size', numberOrString],
    font_face: ['fontFamily', String],
    font_family: ['fontFamily', String],
    font_name: ['fontFamily', String],
    antialias_type: ['antiAliasType', String],
    anti_alias_type: ['antiAliasType', String],
    grid_fit_type: ['gridFitType', String],
    gridfit_type: ['gridFitType', String],
    sharpness: ['sharpness', Number],
    thickness: ['thickness', Number],
    kerning: ['kerning', parseBoolean],
    bold: ['bold', parseBoolean],
    italic: ['italic', parseBoolean],
    underline: ['underline', parseBoolean],
    leading: ['leading', Number],
    letter_spacing: ['letterSpacing', Number],
    fidelity: ['fidelity', String],
  };
  for (const [attribute, [property, convert]] of Object.entries(mappings)) {
    if (attrs[attribute] !== undefined) style[property] = convert(attrs[attribute]);
  }
  if (attrs.color !== undefined) style.color = parseColor(attrs.color);
  if (attrs.text_color !== undefined) style.color = parseColor(attrs.text_color);
  if (attrs.style_name !== undefined) style.styleName = attrs.style_name;
  return style;
}

function parseInlineStyle(css) {
  const style = {};
  for (const declaration of String(css).split(';')) {
    const colon = declaration.indexOf(':');
    if (colon < 0) continue;
    const property = declaration.slice(0, colon).trim().toLowerCase();
    const value = declaration.slice(colon + 1).trim();
    if (!value) continue;
    if (property === 'font-family') style.fontFamily = stripQuotes(value.split(',')[0].trim());
    else if (property === 'font-size') style.size = Number(value.replace(/px$/i, ''));
    else if (property === 'font-weight') style.bold = /bold/i.test(value) || Number(value) >= 600;
    else if (property === 'font-style') style.italic = /italic|oblique/i.test(value);
    else if (property === 'color') style.color = parseColor(value);
    else if (property === 'text-decoration') style.underline = /underline/i.test(value);
    else if (property === 'letter-spacing') style.letterSpacing = Number(value.replace(/px$/i, ''));
    else if (property === 'line-height') style.leading = Number(value.replace(/px$/i, ''));
  }
  return style;
}

function parseAttributes(token) {
  const attrs = {};
  const body = token
    .replace(/^<\s*\/?\s*[A-Za-z][\w:-]*/, '')
    .replace(/\/?>\s*$/, '');
  const re = /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  let match;
  while ((match = re.exec(body))) {
    attrs[match[1].toLowerCase()] = decodeEntities(match[2] ?? match[3] ?? match[4] ?? '');
  }
  return attrs;
}

function decodeEntities(text) {
  return String(text).replace(/&(?:#(\d+)|#x([\da-f]+)|([a-z]+));/gi, (all, decimal, hex, named) => {
    if (decimal || hex) {
      const codePoint = decimal ? Number(decimal) : parseInt(hex, 16);
      return codePoint >= 0 && codePoint <= 0x10FFFF
        ? String.fromCodePoint(codePoint)
        : '\uFFFD';
    }
    return ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00A0' })[named.toLowerCase()] ?? all;
  });
}

function parseColor(value) {
  if (typeof value === 'number') return value & 0xFFFFFF;
  const text = String(value).trim();
  if (/^#[\da-f]{3}$/i.test(text)) {
    return parseInt([...text.slice(1)].map(ch => ch + ch).join(''), 16);
  }
  if (/^#[\da-f]{6}$/i.test(text)) return parseInt(text.slice(1), 16);
  if (/^0x[\da-f]{1,6}$/i.test(text)) return parseInt(text.slice(2), 16);
  const rgb = text.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
  if (rgb) {
    return (Math.min(255, Number(rgb[1])) << 16) |
      (Math.min(255, Number(rgb[2])) << 8) |
      Math.min(255, Number(rgb[3]));
  }
  const named = {
    black: 0x000000, silver: 0xC0C0C0, gray: 0x808080, white: 0xFFFFFF,
    maroon: 0x800000, red: 0xFF0000, purple: 0x800080, fuchsia: 0xFF00FF,
    green: 0x008000, lime: 0x00FF00, olive: 0x808000, yellow: 0xFFFF00,
    navy: 0x000080, blue: 0x0000FF, teal: 0x008080, aqua: 0x00FFFF,
    orange: 0xFFA500, transparent: 0x000000,
  };
  if (named[text.toLowerCase()] !== undefined) return named[text.toLowerCase()];
  if (/^\d+$/.test(text)) return Number(text) & 0xFFFFFF;
  return 0;
}

function parseBoolean(value) {
  return !/^(?:false|0|no|off)$/i.test(String(value));
}

function numberOrString(value) {
  const text = String(value).trim();
  return /^[+-](?:\d+(?:\.\d*)?|\.\d+)$/.test(text) ? text : Number(text);
}

function stripQuotes(value) {
  return value.replace(/^(['"])(.*)\1$/, '$2');
}

function findOpenTag(stack, name) {
  for (let i = stack.length - 1; i > 0; i--) if (stack[i].tag === name) return i;
  return -1;
}

function endsWithNewline(runs) {
  return runs.length > 0 && runs[runs.length - 1].text.endsWith('\n');
}

function isDocument(value) {
  return value?.type === 'document' && Array.isArray(value.paragraphs);
}

function shallowEqual(a, b) {
  const ak = Object.keys(a ?? {}), bk = Object.keys(b ?? {});
  return ak.length === bk.length && ak.every(key => a[key] === b[key]);
}
