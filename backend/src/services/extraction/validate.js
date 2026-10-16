// Guards on one page's extraction (spec §5.2): a failing page is retried once at a higher reasoning
// effort, then stored with validation.suspect = true. Only spoken blocks (body, heading) are checked.
const SPOKEN = new Set(['body', 'heading']);

// An Arabic letter glued to a Latin one, e.g. «أserver» (bake-off page b3-p9)
const LATIN_GLUE = /[؀-ۿ][A-Za-z]|[A-Za-z][؀-ۿ]/u;

// The length guard needs a few pages of the same book before it can say what is long
const MIN_LENGTH_SAMPLE = 5;
const LENGTH_RATIO_LIMIT = 1.5;

function spokenBlocks(blocks) {
  return (blocks || []).filter((b) => SPOKEN.has(b.role) && typeof b.text === 'string' && b.text.trim());
}

function spokenChars(blocks) {
  return spokenBlocks(blocks).reduce((sum, b) => sum + b.text.trim().length, 0);
}

/**
 * @param {string} text
 * @returns {string|null} the glued fragment, or null
 */
function latinGlue(text) {
  const match = LATIN_GLUE.exec(text || '');
  if (!match) return null;
  const from = Math.max(0, match.index - 6);
  return text.slice(from, match.index + 8);
}

/**
 * A generation loop: a run of 2-8 words repeated back to back at least 3 times, or one word 6 times.
 * Repeats that are not back to back (e.g. «صلى الله عليه وسلم» throughout a page) are normal text.
 * @param {string} text
 * @returns {string|null} the repeated phrase, or null
 */
function loopGuard(text) {
  const tokens = (text || '').trim().split(/\s+/).filter(Boolean);
  for (let size = 1; size <= 8; size++) {
    const needed = size === 1 ? 6 : 3;
    for (let start = 0; start + size * needed <= tokens.length; start++) {
      let repeats = 1;
      while (start + size * (repeats + 1) <= tokens.length) {
        let same = true;
        for (let k = 0; k < size; k++) {
          if (tokens[start + k] !== tokens[start + size * repeats + k]) {
            same = false;
            break;
          }
        }
        if (!same) break;
        repeats += 1;
      }
      if (repeats >= needed) return tokens.slice(start, start + size).join(' ');
    }
  }
  return null;
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Spoken length against the median spoken length of the book's pages so far.
 * @param {number} chars
 * @param {number[]} sample spoken chars of other pages of the same book
 * @returns {number|null} the ratio when it is over the limit, else null
 */
function lengthRatio(chars, sample, limit = LENGTH_RATIO_LIMIT) {
  const usable = (sample || []).filter((n) => n > 0);
  if (usable.length < MIN_LENGTH_SAMPLE) return null;
  const ratio = chars / median(usable);
  return ratio > limit ? Number(ratio.toFixed(2)) : null;
}

/**
 * Validate one page's blocks.
 * @param {Object[]} blocks
 * @param {{lengthSample?: number[]}} [context]
 * @returns {{ok: boolean, issues: Object[], spokenChars: number}}
 */
function validatePage(blocks, { lengthSample = [] } = {}) {
  const issues = [];
  spokenBlocks(blocks).forEach((block) => {
    const glued = latinGlue(block.text);
    if (glued) issues.push({ type: 'latin_glue', block: blocks.indexOf(block), sample: glued });
  });

  const spokenText = spokenBlocks(blocks).map((b) => b.text.trim()).join(' ');
  const loop = loopGuard(spokenText);
  if (loop) issues.push({ type: 'loop', sample: loop });

  const chars = spokenChars(blocks);
  const ratio = lengthRatio(chars, lengthSample);
  if (ratio) issues.push({ type: 'length', ratio });

  return { ok: issues.length === 0, issues, spokenChars: chars };
}

module.exports = { validatePage, latinGlue, loopGuard, lengthRatio, spokenChars, LENGTH_RATIO_LIMIT, MIN_LENGTH_SAMPLE };
