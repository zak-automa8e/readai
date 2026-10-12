// Deterministic segment builder: body + heading blocks across consecutive pages -> paragraph segments.
const SPOKEN = new Set(['body', 'heading']);
// Terminal punctuation for the "is this sentence finished" heuristic (closing quote/bracket after it allowed).
const TERMINAL_END = /[.؟?!:…۔»”"]\s*[)\]»”"]*\s*$/u;
// Sentence split: after . ؟ ? ! … ۔ (plus closing quotes/brackets) followed by whitespace.
const SENTENCE_SPLIT = /(?<=[.؟?!…۔](?:[)\]»”"])*)\s+/u;

function looksOpen(text) {
  return !TERMINAL_END.test((text || '').trim());
}

function splitSentences(text) {
  return text.split(SENTENCE_SPLIT).map(s => s.trim()).filter(Boolean);
}

function words(text) {
  return (text || '').trim().split(/\s+/).filter(Boolean);
}

/**
 * @param {Array<{page:number, blocks:Array}>} pages ordered consecutive pages for ONE book
 * @param {string} bookKey short id used in segment ids
 * @returns {{segments:Array, boundaries:Array}}
 */
function buildSegments(pages, bookKey) {
  const segments = [];
  const boundaries = [];
  let prevTail = null; // { segment, block, page } last spoken block of previous page

  pages.forEach((p, pi) => {
    const spoken = (p.blocks || []).filter(b => SPOKEN.has(b.role) && b.text && b.text.trim());
    spoken.forEach((b, bi) => {
      const isFirst = bi === 0;
      if (isFirst && pi > 0) {
        const prev = pages[pi - 1];
        const boundary = { from: prev.page, to: p.page, merged: false };
        if (prevTail) {
          const tb = prevTail.block;
          boundary.prevEndsModel = tb.role === 'body' && !!tb.ends_mid_sentence;
          boundary.prevOpenHeuristic = tb.role === 'body' && looksOpen(tb.text);
          boundary.nextStartsModel = b.role === 'body' && !!b.starts_mid_sentence;
          boundary.tail = words(tb.text).slice(-8).join(' ');
          boundary.head = words(b.text).slice(0, 8).join(' ');
          if (boundary.prevEndsModel && boundary.prevOpenHeuristic && boundary.nextStartsModel) {
            const seg = prevTail.segment;
            seg.text = `${seg.text} ${b.text.trim()}`;
            seg.pages.push(p.page);
            seg.merged = true;
            seg.parts.push({ page: p.page, chars: b.text.trim().length });
            seg.footnote_markers.push(...(b.footnote_markers || []));
            boundary.merged = true;
            boundary.segmentId = seg.id;
            boundaries.push(boundary);
            prevTail = { segment: seg, block: b, page: p.page };
            return;
          }
          const signals = [boundary.prevEndsModel, boundary.prevOpenHeuristic, boundary.nextStartsModel];
          boundary.disagreement = signals.some(Boolean) && !signals.every(Boolean);
        } else {
          boundary.note = 'previous page had no spoken blocks';
        }
        boundaries.push(boundary);
      }
      const seg = {
        id: `${bookKey}-s${String(segments.length + 1).padStart(2, '0')}`,
        role: b.role,
        pages: [p.page],
        merged: false,
        text: b.text.trim(),
        parts: [{ page: p.page, chars: b.text.trim().length }],
        footnote_markers: [...(b.footnote_markers || [])],
      };
      segments.push(seg);
      prevTail = { segment: seg, block: b, page: p.page };
    });
    if (pi > 0 && !spoken.length) {
      boundaries.push({ from: pages[pi - 1].page, to: p.page, merged: false, note: 'page has no spoken blocks' });
    }
  });

  for (const s of segments) s.sentences = splitSentences(s.text);
  boundaries.sort((a, b) => a.from - b.from);
  return { segments, boundaries };
}

module.exports = { buildSegments, splitSentences, looksOpen, words };
