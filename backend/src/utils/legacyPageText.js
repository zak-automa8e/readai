/**
 * Collapse extracted blocks into the {header, body, footer} shape the legacy page routes return.
 * Headings become the header and body blocks the body, so the reader speaks them as before;
 * running headers are dropped because they repeat on every page.
 * @param {{role: string, text: string}[]} blocks
 * @returns {{header: string, body: string, footer: string}}
 */
function blocksToLegacyText(blocks) {
  const join = (roles) => blocks
    .filter((block) => roles.includes(block.role) && typeof block.text === 'string' && block.text.trim())
    .map((block) => block.text.trim())
    .join('\n');

  return {
    header: join(['heading']),
    body: join(['body']),
    footer: join(['footnote', 'footer', 'page_number']),
  };
}

/**
 * Parse a model reply that is JSON except for raw line breaks or tabs inside string values,
 * which some legacy cached rows contain. Returns null when it still is not JSON.
 * @param {string} text
 * @returns {object|null}
 */
function parseLenientJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    // fall through: escape control characters that sit inside strings
  }

  let out = '';
  let inString = false;
  let escaped = false;
  for (const ch of text) {
    if (inString && !escaped && ch === '\n') out += '\\n';
    else if (inString && !escaped && ch === '\r') out += '\\r';
    else if (inString && !escaped && ch === '\t') out += '\\t';
    else out += ch;

    if (escaped) escaped = false;
    else if (ch === '\\' && inString) escaped = true;
    else if (ch === '"') inString = !inString;
  }

  try {
    return JSON.parse(out);
  } catch {
    return null;
  }
}

/**
 * Parse a legacy {header, body, footer} model reply. Some cached replies hold a cut-off copy
 * followed by a complete one, so when the whole text fails, parse from the last object that
 * opens with "header".
 * @param {string} text
 * @returns {object|null}
 */
function parseLegacyReply(text) {
  const whole = parseLenientJson(text);
  if (whole) return whole;

  const headers = [...text.matchAll(/\{\s*"header"\s*:/g)];
  if (headers.length < 2) return null;
  return parseLenientJson(text.slice(headers[headers.length - 1].index));
}

module.exports = { blocksToLegacyText, parseLenientJson, parseLegacyReply };
