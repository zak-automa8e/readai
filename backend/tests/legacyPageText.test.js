const { blocksToLegacyText, parseLenientJson } = require('../src/utils/legacyPageText');
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

describe('parseLenientJson', () => {
  it('parses valid JSON as is', () => {
    expect(parseLenientJson('{"body": "نص"}')).toEqual({ body: 'نص' });
  });

  it('accepts raw line breaks inside string values', () => {
    const raw = '{\n  "header": "١٦\nتلمود العم سام",\n  "body": "سطر\tأول\\nسطر"\n}';
    expect(parseLenientJson(raw)).toEqual({ header: '١٦\nتلمود العم سام', body: 'سطر\tأول\nسطر' });
  });

  it('returns null for text that is not JSON', () => {
    expect(parseLenientJson('{ not json')).toBeNull();
  });
});

describe('PageCacheService.normalizeExtractedText', () => {
  const pageCacheService = require('../src/services/pageCacheService');

  it('unwraps a model reply stored inside body', () => {
    const inner = '{\n  "header": "١٩\nالفصل الأول",\n  "body": "«تاريخ»",\n  "footer": ""\n}';
    const stored = JSON.stringify({ header: '', body: inner, footer: '' });
    expect(pageCacheService.normalizeExtractedText(stored)).toEqual({
      header: '١٩\nالفصل الأول',
      body: '«تاريخ»',
      footer: '',
    });
  });

  it('takes the complete copy when a reply is stored twice', () => {
    const inner = '{\n  "header": "أ",\n  "body": "مقطوع{\n  "header": "تلمود العم سام",\n  "body": "كامل",\n  "footer": ""\n}';
    const stored = JSON.stringify({ header: '', body: inner, footer: '' });
    expect(pageCacheService.normalizeExtractedText(stored)).toEqual({
      header: 'تلمود العم سام',
      body: 'كامل',
      footer: '',
    });
  });

  it('leaves a body that only starts with a brace alone', () => {
    const stored = JSON.stringify({ header: '', body: '{ ملاحظة } نص', footer: '' });
    expect(pageCacheService.normalizeExtractedText(stored).body).toBe('{ ملاحظة } نص');
  });
});
