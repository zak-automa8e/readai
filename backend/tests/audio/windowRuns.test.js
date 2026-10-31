jest.mock('../../src/utils/logger', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }));
jest.mock('../../src/services/supabaseService', () => require('../helpers/fakeSupabase')());

const { planWindow } = require('../../src/services/audio/windowService');

// Listen-ahead story 2: text arrives in runs anywhere in the book, so a window can meet a run's
// unsettled first paragraph ('head') or a page with no text between two runs.
const seg = (seq, page, extra = {}) => ({ seq, start_page: page, end_page: page, parts: [{ page, chars: 10 }], char_count: 100, status: 'final', ...extra });
const options = (hasText) => ({ isSkipped: () => false, countedPages: new Set(), remaining: 50, pagesAhead: 3, hasText });

describe('planWindow over runs', () => {
  it('waits at a head paragraph like an open one', () => {
    const plan = planWindow([seg(4999, 5, { status: 'head' }), seg(5000, 5)], options(() => true));
    expect(plan).toMatchObject({ items: [], stopReason: 'processing', waitSeq: 4999 });
  });

  it('stops before a page with no text between two runs, without a segment to wait for', () => {
    const plan = planWindow([seg(5000, 5), seg(7000, 7)], options((page) => page !== 6));
    expect(plan.items.map((i) => i.segment.seq)).toEqual([5000]);
    expect(plan.stopReason).toBe('processing');
    expect(plan.waitSeq).toBeUndefined();
  });

  it('walks over a page that has text but no paragraphs', () => {
    const plan = planWindow([seg(5000, 5), seg(7000, 7)], options(() => true));
    expect(plan.items.map((i) => i.segment.seq)).toEqual([5000, 7000]);
  });
});
