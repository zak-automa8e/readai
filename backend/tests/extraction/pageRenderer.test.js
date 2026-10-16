const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pageCount, renderPage } = require('../../src/services/extraction/pageRenderer');

// A valid PDF with blank pages, xref offsets computed so poppler reads it without repair
function blankPdf(pages) {
  const objects = [];
  const kids = Array.from({ length: pages }, (_, i) => `${3 + i} 0 R`).join(' ');
  objects.push('<< /Type /Catalog /Pages 2 0 R >>');
  objects.push(`<< /Type /Pages /Kids [${kids}] /Count ${pages} >>`);
  for (let i = 0; i < pages; i++) objects.push('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 72 72] >>');

  let body = '%PDF-1.4\n';
  const offsets = [];
  objects.forEach((object, i) => {
    offsets.push(body.length);
    body += `${i + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = body.length;
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  offsets.forEach((offset) => { body += `${String(offset).padStart(10, '0')} 00000 n \n`; });
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(body, 'latin1');
}

const hasPoppler = spawnSync('pdfinfo', ['-v']).error === undefined;
const describePoppler = hasPoppler ? describe : describe.skip;

describePoppler('pageRenderer (poppler on PATH)', () => {
  let dir;
  let pdfPath;

  beforeAll(async () => {
    dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'readai-render-test-'));
    pdfPath = path.join(dir, 'blank.pdf');
    await fs.promises.writeFile(pdfPath, blankPdf(3));
  });

  afterAll(async () => {
    await fs.promises.rm(dir, { recursive: true, force: true });
  });

  it('counts pages with pdfinfo', async () => {
    expect(await pageCount(pdfPath)).toBe(3);
  });

  it('renders one page to a PNG with a stable hash', async () => {
    const first = await renderPage(pdfPath, 2, { dpi: 50 });
    const again = await renderPage(pdfPath, 2, { dpi: 50 });
    expect(first.png.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
    expect(first.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(again.sha256).toBe(first.sha256);
  });

  it('fails for a page past the end', async () => {
    await expect(renderPage(pdfPath, 9, { dpi: 50 })).rejects.toThrow();
  });
});
