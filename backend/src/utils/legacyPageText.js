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

module.exports = { blocksToLegacyText };
