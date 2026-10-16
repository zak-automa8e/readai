const fixtures = require('../fixtures/bakeoff-pages.json');
const {
  buildSegments,
  carryFromSegment,
  splitLong,
  sentenceOffsets,
  MAX_SEGMENT_CHARS,
} = require('../../src/services/extraction/segmentBuilder');

const sum = (parts) => parts.reduce((n, p) => n + p.chars, 0);

// Finalise page by page the way extractionService does: keep final segments, carry the open one
function buildIncrementally(pages, lastPage) {
  const stored = [];
  for (let i = 0; i < pages.length; i++) {
    const last = stored[stored.length - 1];
    let carry = null;
    let input = [pages[i]];
    if (last && last.status === 'open') {
      carry = carryFromSegment({ ...last, footnote_markers: last.footnoteMarkers }, pages[i - 1]);
    }
    const { segments } = buildSegments(input, { carry, moreToCome: pages[i].page < lastPage });
    segments.forEach((segment) => {
      if (segment.carried) stored[stored.length - 1] = segment;
      else stored.push(segment);
    });
    input = null;
  }
  return stored;
}

describe('segmentBuilder', () => {
  describe.each(fixtures.books.map((book) => [book.key, book]))('bake-off book %s', (key, book) => {
    const { segments } = buildSegments(book.pages);

    it('reproduces the owner-approved bake-off segments', () => {
      expect(segments).toHaveLength(book.expected.length);
      segments.forEach((segment, i) => {
        const expected = book.expected[i];
        expect(segment.role).toBe(expected.role);
        expect(segment.text).toBe(expected.text);
        expect(segment.parts.map((p) => p.page)).toEqual(expected.pages);
        // the bake-off left the joining space out; here it counts toward the earlier page
        expect(segment.parts.map((p) => p.chars)).toEqual(
          expected.parts.map((p, j) => p.chars + (j < expected.parts.length - 1 ? 1 : 0)),
        );
        expect(segment.status).toBe('final');
      });
    });

    it('has parts that sum to the character count and pages that match the parts', () => {
      segments.forEach((segment) => {
        expect(sum(segment.parts)).toBe(segment.charCount);
        expect(segment.charCount).toBe(segment.text.length);
        expect(segment.startPage).toBe(segment.parts[0].page);
        expect(segment.endPage).toBe(segment.parts[segment.parts.length - 1].page);
      });
    });

    it('builds the same segments page by page as in one pass', () => {
      const lastPage = book.pages[book.pages.length - 1].page;
      const incremental = buildIncrementally(book.pages, lastPage);
      const strip = ({ carried, ...rest }) => rest;
      expect(incremental.map(strip)).toEqual(segments.map(strip));
    });

    it('never speaks footnotes, and running headers only where the same words are a real heading', () => {
      const blocks = book.pages.flatMap((p) => p.blocks);
      const headings = new Set(blocks.filter((b) => b.role === 'heading').map((b) => b.text.trim()));
      const unspoken = blocks
        .filter((b) => ['running_header', 'footnote'].includes(b.role))
        .map((b) => b.text.trim())
        .filter((t) => t.length > 3 && !headings.has(t));
      segments.forEach((segment) => unspoken.forEach((t) => expect(segment.text.includes(t)).toBe(false)));
    });
  });

  describe('open segments', () => {
    const b1 = fixtures.books.find((b) => b.key === 'b1');

    it('leaves the last segment open when its sentence runs onto a page not built yet', () => {
      const { segments } = buildSegments([b1.pages[0]], { moreToCome: true });
      expect(segments[segments.length - 1].status).toBe('open');
      expect(segments.slice(0, -1).every((s) => s.status === 'final')).toBe(true);
    });

    it('closes it at the end of the book', () => {
      const { segments } = buildSegments([b1.pages[0]], { moreToCome: false });
      expect(segments.every((s) => s.status === 'final')).toBe(true);
    });

    it('rewrites the carried segment with the continuation and marks it carried', () => {
      const first = buildSegments([b1.pages[0]], { moreToCome: true }).segments;
      const open = first[first.length - 1];
      const carry = carryFromSegment({ ...open, footnote_markers: [] }, b1.pages[0]);
      const { segments } = buildSegments([b1.pages[1]], { carry, moreToCome: true });

      expect(segments[0].carried).toBe(true);
      expect(segments[0].startPage).toBe(5);
      expect(segments[0].endPage).toBe(6);
      expect(segments[0].text.startsWith(open.text)).toBe(true);
      expect(segments.slice(1).every((s) => !s.carried)).toBe(true);
    });
  });

  describe('merge rule', () => {
    const tail = { role: 'body', text: 'جملة لم تنته بعد في', ends_mid_sentence: true, starts_mid_sentence: false };
    const head = { role: 'body', text: 'هذه الصفحة.', starts_mid_sentence: true, ends_mid_sentence: false };

    it('merges a sentence across adjacent pages of the same type', () => {
      const { segments } = buildSegments([
        { page: 1, pageType: 'body', blocks: [tail] },
        { page: 2, pageType: 'body', blocks: [head] },
      ]);
      expect(segments).toHaveLength(1);
      expect(segments[0].parts).toEqual([{ page: 1, chars: tail.text.length + 1 }, { page: 2, chars: head.text.length }]);
    });

    it('does not merge across a page with no spoken text', () => {
      const { segments } = buildSegments([
        { page: 1, blocks: [tail] },
        { page: 2, blocks: [{ role: 'page_number', text: '٢' }] },
        { page: 3, blocks: [head] },
      ]);
      expect(segments).toHaveLength(2);
    });

    it('does not merge from one page type into another', () => {
      const { segments } = buildSegments([
        { page: 1, pageType: 'preface', blocks: [tail] },
        { page: 2, pageType: 'body', blocks: [head] },
      ]);
      expect(segments).toHaveLength(2);
    });

    it('needs the model flags and the punctuation heuristic to agree', () => {
      const closed = { ...tail, text: 'جملة انتهت.' };
      const { segments } = buildSegments([{ page: 1, blocks: [closed] }, { page: 2, blocks: [head] }]);
      expect(segments).toHaveLength(2);
    });

    it('does not keep a closed sentence open', () => {
      const closed = { ...tail, text: 'جملة انتهت.' };
      const { segments } = buildSegments([{ page: 1, blocks: [closed] }], { moreToCome: true });
      expect(segments[0].status).toBe('final');
    });
  });

  describe('splitLong', () => {
    const sentence = (n) => `${'كلمة '.repeat(40).trim()} رقم ${n}.`;
    const pageA = Array.from({ length: 12 }, (_, i) => sentence(i)).join(' ');
    const pageB = Array.from({ length: 8 }, (_, i) => sentence(100 + i)).join(' ');

    it('splits at sentence ends into pieces of at most the cap, keeping every character in order', () => {
      const text = `${pageA} ${pageB}`;
      const pieces = splitLong({ role: 'body', text, parts: [{ page: 4, chars: pageA.length + 1 }, { page: 5, chars: pageB.length }], footnoteMarkers: ['(١)'] });

      expect(pieces.length).toBeGreaterThan(1);
      pieces.forEach((piece) => {
        expect(piece.text.length).toBeLessThanOrEqual(MAX_SEGMENT_CHARS);
        expect(sum(piece.parts)).toBe(piece.text.length);
        expect(piece.text.endsWith('.')).toBe(true);
      });
      expect(pieces.map((p) => p.text).join(' ')).toBe(text);
      expect(pieces[0].footnoteMarkers).toEqual(['(١)']);
      const pages = pieces.flatMap((p) => p.parts.map((part) => part.page));
      expect(pages[0]).toBe(4);
      expect(pages[pages.length - 1]).toBe(5);
    });

    it('cuts one over-long sentence at clause marks', () => {
      const text = Array.from({ length: 60 }, () => 'كلمة كلمة كلمة كلمة كلمة،').join(' ');
      const pieces = splitLong({ role: 'body', text, parts: [{ page: 1, chars: text.length }], footnoteMarkers: [] });
      expect(pieces.length).toBeGreaterThan(1);
      pieces.forEach((piece) => expect(piece.text.length).toBeLessThanOrEqual(MAX_SEGMENT_CHARS));
    });

    it('splits a long open paragraph and keeps only its last piece open', () => {
      const block = { role: 'body', text: `${pageA} ${pageB} وهذه جملة لم`, ends_mid_sentence: true };
      const { segments } = buildSegments([{ page: 1, blocks: [block] }], { moreToCome: true });
      expect(segments.length).toBeGreaterThan(1);
      expect(segments.map((s) => s.status)).toEqual([...segments.slice(1).map(() => 'final'), 'open']);
    });
  });

  describe('sentenceOffsets', () => {
    it('gives the start of each sentence', () => {
      const text = 'الأولى. الثانية؟ «الثالثة!» الرابعة';
      const offsets = sentenceOffsets(text);
      expect(offsets.map((o) => text.slice(o).split(' ')[0])).toEqual(['الأولى.', 'الثانية؟', '«الثالثة!»', 'الرابعة']);
    });

    it('is empty for empty text', () => {
      expect(sentenceOffsets('')).toEqual([]);
    });
  });
});
