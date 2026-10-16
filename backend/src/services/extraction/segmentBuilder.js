// Segment builder: body + heading blocks over consecutive pages -> paragraph segments (the playback unit).
// Moved from scripts/bakeoff/segments.js (owner-approved merge rule) and extended for the pipeline:
//  - incremental: building can resume from an open segment (`carry`) when the next pages land
//  - a segment is `open` while its last sentence may continue on a page that is not extracted yet
//  - segments longer than MAX_SEGMENT_CHARS are split at sentence ends
//  - parts[].chars sum to the text length (the joining space belongs to the earlier page)
//  - sentence start offsets for the highlight clock
const SPOKEN = new Set(['body', 'heading']);
// Terminal punctuation for the "is this sentence finished" heuristic (closing quote/bracket after it allowed).
const TERMINAL_END = /[.؟?!:…۔»”"]\s*[)\]»”"]*\s*$/u;
// Sentence split: after . ؟ ? ! … ۔ (plus closing quotes/brackets) followed by whitespace.
const SENTENCE_SPLIT = /(?<=[.؟?!…۔](?:[)\]»”"])*)\s+/u;
const SENTENCE_GAPS = /(?<=[.؟?!…۔](?:[)\]»”"])*)\s+/gu;
// Fallback cut points inside one over-long sentence: after a clause mark, else any space
const CLAUSE_GAPS = /(?<=[،,؛;])\s+/gu;
const SPACE_GAPS = /\s+/gu;

const MAX_SEGMENT_CHARS = 1500;

function looksOpen(text) {
  return !TERMINAL_END.test((text || '').trim());
}

function splitSentences(text) {
  return text.split(SENTENCE_SPLIT).map((s) => s.trim()).filter(Boolean);
}

function words(text) {
  return (text || '').trim().split(/\s+/).filter(Boolean);
}

/** Start offset of every sentence in `text` (first is 0). */
function sentenceOffsets(text) {
  if (!text) return [];
  const offsets = [0];
  for (const match of text.matchAll(SENTENCE_GAPS)) {
    const start = match.index + match[0].length;
    if (start < text.length) offsets.push(start);
  }
  return offsets;
}

function spokenBlocks(page) {
  return (page.blocks || []).filter((b) => SPOKEN.has(b.role) && typeof b.text === 'string' && b.text.trim());
}

// The tail of a block may continue on the next page: model flag and punctuation heuristic agree
function tailIsOpen(block) {
  return Boolean(block) && block.role === 'body' && Boolean(block.ends_mid_sentence) && looksOpen(block.text);
}

// A sentence never runs from one kind of page into another (e.g. preface into body)
function samePageType(a, b) {
  return !a || !b || a === b;
}

function canMerge(prev, block, page) {
  return prev.page === page.page - 1
    && tailIsOpen(prev.tailBlock)
    && block.role === 'body'
    && Boolean(block.starts_mid_sentence)
    && samePageType(prev.pageType, page.pageType);
}

// A draft is one paragraph as page pieces; materialised into text + parts at the end
function materialise(draft) {
  const n = draft.pieces.length;
  const text = draft.pieces.map((p) => p.text).join(' ');
  const parts = draft.pieces.map((p, i) => ({ page: p.page, chars: p.text.length + (i < n - 1 ? 1 : 0) }));
  return { role: draft.role, text, parts, footnoteMarkers: draft.markers };
}

// [start, end) ranges of sentences, end excluding trailing whitespace
function unitRanges(text, from, to, gaps) {
  const ranges = [];
  let start = from;
  const slice = text.slice(from, to);
  for (const match of slice.matchAll(gaps)) {
    const end = from + match.index;
    if (end > start) ranges.push([start, end]);
    start = from + match.index + match[0].length;
  }
  if (to > start) ranges.push([start, to]);
  return ranges;
}

// Sentences, with any sentence longer than maxChars cut at clause marks, then at spaces
function cutUnits(text, maxChars) {
  const units = [];
  for (const [a, b] of unitRanges(text, 0, text.length, SENTENCE_GAPS)) {
    if (b - a <= maxChars) {
      units.push([a, b]);
      continue;
    }
    for (const [c, d] of unitRanges(text, a, b, CLAUSE_GAPS)) {
      if (d - c <= maxChars) units.push([c, d]);
      else units.push(...unitRanges(text, c, d, SPACE_GAPS));
    }
  }
  return units;
}

function partsWithin(parts, a, b) {
  const out = [];
  let offset = 0;
  for (const part of parts) {
    const lo = Math.max(a, offset);
    const hi = Math.min(b, offset + part.chars);
    if (hi > lo) out.push({ page: part.page, chars: hi - lo });
    offset += part.chars;
  }
  return out;
}

/**
 * Split a materialised segment longer than maxChars at sentence ends (greedy, front to back).
 * Footnote markers stay with the first piece.
 * @returns {Array<{role, text, parts, footnoteMarkers}>}
 */
function splitLong(segment, maxChars = MAX_SEGMENT_CHARS) {
  if (segment.text.length <= maxChars) return [segment];
  const units = cutUnits(segment.text, maxChars);
  const pieces = [];
  let start = units[0][0];
  let end = units[0][1];
  for (const [a, b] of units.slice(1)) {
    if (b - start <= maxChars) {
      end = b;
    } else {
      pieces.push([start, end]);
      start = a;
      end = b;
    }
  }
  pieces.push([start, end]);
  return pieces.map(([a, b], i) => ({
    role: segment.role,
    text: segment.text.slice(a, b),
    parts: partsWithin(segment.parts, a, b),
    footnoteMarkers: i === 0 ? segment.footnoteMarkers : [],
  }));
}

function finish(segment, status, carried) {
  const pages = segment.parts.map((p) => p.page);
  return {
    role: segment.role,
    startPage: pages[0],
    endPage: pages[pages.length - 1],
    parts: segment.parts,
    text: segment.text,
    charCount: segment.text.length,
    sentenceOffsets: sentenceOffsets(segment.text),
    footnoteMarkers: segment.footnoteMarkers,
    status,
    carried,
  };
}

/**
 * Rebuild the builder state from a stored open segment and the page its tail is on.
 * @param {{role: string, text: string, parts: {page: number, chars: number}[], footnote_markers?: string[]}} segment
 * @param {{page: number, blocks: Object[], pageType?: string|null}} tailPage
 */
function carryFromSegment(segment, tailPage) {
  const pieces = [];
  let offset = 0;
  for (const part of segment.parts) {
    pieces.push({ page: part.page, text: segment.text.slice(offset, offset + part.chars).trim() });
    offset += part.chars;
  }
  const lastPage = pieces[pieces.length - 1].page;
  if (lastPage !== tailPage.page) {
    throw new Error(`Open segment ends on page ${lastPage}, not on page ${tailPage.page}`);
  }
  const spoken = spokenBlocks(tailPage);
  return {
    draft: { role: segment.role, pieces, markers: [...(segment.footnote_markers || [])] },
    tailBlock: spoken[spoken.length - 1] || null,
    page: tailPage.page,
    pageType: tailPage.pageType || null,
  };
}

/**
 * Build segments over consecutive pages.
 * @param {Array<{page: number, blocks: Object[], pageType?: string|null}>} pages ascending, no gaps
 * @param {{carry?: Object|null, moreToCome?: boolean, maxChars?: number}} [options]
 *   carry: from carryFromSegment — the open segment the first page may continue.
 *   moreToCome: the page after the last one is not built yet (so the last segment may stay open).
 * @returns {{segments: Object[], boundaries: Object[]}} segments carry `status` ('open'|'final') and
 *   `carried` (true on the piece that replaces the carried open segment).
 */
function buildSegments(pages, { carry = null, moreToCome = false, maxChars = MAX_SEGMENT_CHARS } = {}) {
  const drafts = [];
  const boundaries = [];
  let prev = null; // { draft, tailBlock, page, pageType } — the last spoken block so far

  if (carry) {
    const draft = { ...carry.draft, pieces: carry.draft.pieces.map((p) => ({ ...p })), markers: [...carry.draft.markers], carried: true };
    drafts.push(draft);
    prev = { draft, tailBlock: carry.tailBlock, page: carry.page, pageType: carry.pageType };
  }

  for (const page of pages) {
    const spoken = spokenBlocks(page);
    spoken.forEach((block, index) => {
      const text = block.text.trim();
      if (index === 0 && prev) {
        const merged = canMerge(prev, block, page);
        boundaries.push({ from: prev.page, to: page.page, merged });
        if (merged) {
          prev.draft.pieces.push({ page: page.page, text });
          prev.draft.markers.push(...(block.footnote_markers || []));
          prev = { draft: prev.draft, tailBlock: block, page: page.page, pageType: page.pageType || null };
          return;
        }
      }
      const draft = { role: block.role, pieces: [{ page: page.page, text }], markers: [...(block.footnote_markers || [])] };
      drafts.push(draft);
      prev = { draft, tailBlock: block, page: page.page, pageType: page.pageType || null };
    });
  }

  const lastInputPage = pages.length ? pages[pages.length - 1].page : carry?.page;
  const openDraft = moreToCome && prev && prev.page === lastInputPage && tailIsOpen(prev.tailBlock) ? prev.draft : null;

  const segments = [];
  for (const draft of drafts) {
    const pieces = splitLong(materialise(draft), maxChars);
    pieces.forEach((piece, i) => {
      const open = draft === openDraft && i === pieces.length - 1;
      segments.push(finish(piece, open ? 'open' : 'final', Boolean(draft.carried) && i === 0));
    });
  }
  return { segments, boundaries };
}

module.exports = {
  MAX_SEGMENT_CHARS,
  buildSegments,
  carryFromSegment,
  splitLong,
  sentenceOffsets,
  splitSentences,
  looksOpen,
  words,
};
