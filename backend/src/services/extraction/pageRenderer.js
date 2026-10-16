const { spawn } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

/**
 * Server-side page rendering with poppler (pdfinfo + pdftoppm), spawned the way thumbnailService
 * does. Rendered PNGs are returned in memory and never stored, except for batch extraction.
 */

const TOOL_TIMEOUT_MS = 60000;
const DEFAULT_DPI = 200;

function runTool(command, args, timeoutMs = TOOL_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    const proc = spawn(command, args);
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      proc.kill('SIGKILL');
      reject(new Error(`${command} timed out after ${timeoutMs} ms`));
    }, timeoutMs);

    proc.stdout.on('data', (d) => { stdout += d.toString(); });
    proc.stderr.on('data', (d) => { stderr += d.toString(); });
    proc.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    proc.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) return reject(new Error(`${command} exited with ${code}: ${stderr.slice(0, 300)}`));
      resolve({ stdout, stderr });
    });
  });
}

/**
 * @param {string} pdfPath
 * @returns {Promise<number>}
 */
async function pageCount(pdfPath) {
  const { stdout } = await runTool('pdfinfo', [pdfPath]);
  const match = /^Pages:\s+(\d+)/m.exec(stdout);
  if (!match) throw new Error('pdfinfo reported no page count');
  return parseInt(match[1], 10);
}

/**
 * Render one page to PNG.
 * @param {string} pdfPath
 * @param {number} pageNumber 1-based
 * @param {{dpi?: number}} [options]
 * @returns {Promise<{png: Buffer, sha256: string}>}
 */
async function renderPage(pdfPath, pageNumber, { dpi = DEFAULT_DPI } = {}) {
  const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'readai-page-'));
  const outputBase = path.join(tmpDir, 'page');
  try {
    const page = String(pageNumber);
    await runTool('pdftoppm', ['-r', String(dpi), '-png', '-singlefile', '-f', page, '-l', page, pdfPath, outputBase]);
    const png = await fs.promises.readFile(`${outputBase}.png`);
    return { png, sha256: crypto.createHash('sha256').update(png).digest('hex') };
  } finally {
    try { await fs.promises.rm(tmpDir, { recursive: true, force: true }); } catch { /* best effort */ }
  }
}

module.exports = { pageCount, renderPage, DEFAULT_DPI };
