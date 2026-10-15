const { blocksToLegacyText } = require('../src/utils/legacyPageText');
const { truncateForLegacyAudio } = require('../src/utils/audioUtils');
const config = require('../src/config');

describe('blocksToLegacyText', () => {
  it('maps headings to header, body blocks to body and notes to footer', () => {
    const blocks = [
      { role: 'running_header', text: 'كتاب' },
      { role: 'heading', text: 'الفصل الأول' },
      { role: 'body', text: 'الفقرة الأولى' },
      { role: 'body', text: 'الفقرة الثانية' },
      { role: 'footnote', text: '(١) انظر' },
      { role: 'page_number', text: '٧' },
    ];

    expect(blocksToLegacyText(blocks)).toEqual({
      header: 'الفصل الأول',
      body: 'الفقرة الأولى\nالفقرة الثانية',
      footer: '(١) انظر\n٧',
    });
  });

  it('returns empty strings for a page with no blocks', () => {
    expect(blocksToLegacyText([])).toEqual({ header: '', body: '', footer: '' });
  });

  it('skips blank blocks', () => {
    expect(blocksToLegacyText([{ role: 'body', text: '  ' }, { role: 'body', text: 'نص' }]).body).toBe('نص');
  });
});

describe('truncateForLegacyAudio', () => {
  it('leaves short text alone', () => {
    expect(truncateForLegacyAudio('short')).toBe('short');
  });

  it('cuts to maxTextLength and appends an ellipsis', () => {
    const long = 'a'.repeat(config.maxTextLength + 50);
    expect(truncateForLegacyAudio(long)).toBe('a'.repeat(config.maxTextLength) + '...');
  });
});
