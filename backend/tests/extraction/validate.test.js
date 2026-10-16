const fixtures = require('../fixtures/bakeoff-pages.json');
const { validatePage, latinGlue, loopGuard, lengthRatio } = require('../../src/services/extraction/validate');

const page = (key, number) => fixtures.books.find((b) => b.key === key).pages.find((p) => p.page === number);

describe('validate', () => {
  describe('latinGlue', () => {
    it('finds a Latin word glued to an Arabic letter', () => {
      expect(latinGlue('تأملت أن أserver ثمار')).toContain('أserver');
    });

    it('accepts Latin words that stand apart', () => {
      expect(latinGlue('برنامج Word الشهير')).toBeNull();
      expect(latinGlue('نص عربي فقط.')).toBeNull();
    });
  });

  describe('loopGuard', () => {
    it('finds a phrase repeated back to back', () => {
      expect(loopGuard('قال الشيخ إن العلم نور العلم نور العلم نور ثم سكت')).toBe('العلم نور');
    });

    it('accepts a phrase that recurs through the page but not in a row', () => {
      const text = 'قال النبي صلى الله عليه وسلم كذا. وروي عن النبي صلى الله عليه وسلم كذا. وفعل النبي صلى الله عليه وسلم ذلك.';
      expect(loopGuard(text)).toBeNull();
    });

    it('needs six of one word in a row', () => {
      expect(loopGuard('لا لا لا كلام')).toBeNull();
      expect(loopGuard('ها ها ها ها ها ها')).toBe('ها');
    });
  });

  describe('lengthRatio', () => {
    it('flags a page much longer than the median of the book so far', () => {
      expect(lengthRatio(3000, [1000, 1100, 900, 1200, 1000])).toBe(3);
    });

    it('waits for enough pages before judging', () => {
      expect(lengthRatio(3000, [1000, 1000])).toBeNull();
    });

    it('accepts normal variation', () => {
      expect(lengthRatio(1400, [1000, 1100, 900, 1200, 1000])).toBeNull();
    });
  });

  describe('validatePage', () => {
    it('flags the bake-off page with the «أserver» defect', () => {
      const result = validatePage(page('b3', 9).blocks);
      expect(result.ok).toBe(false);
      expect(result.issues).toEqual([expect.objectContaining({ type: 'latin_glue', sample: expect.stringContaining('أserver') })]);
    });

    it('passes the other bake-off pages', () => {
      fixtures.books.forEach((book) => book.pages
        .filter((p) => !(book.key === 'b3' && p.page === 9))
        .forEach((p) => expect(validatePage(p.blocks).issues).toEqual([])));
    });

    it('only checks spoken blocks and reports spoken characters', () => {
      const blocks = [
        { role: 'footnote', text: 'انظر: Smithالكتاب' },
        { role: 'body', text: 'نص سليم.' },
      ];
      expect(validatePage(blocks)).toEqual({ ok: true, issues: [], spokenChars: 8 });
    });
  });
});
