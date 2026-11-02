const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const config = require('../../config');
const supabaseService = require('../supabaseService');

/**
 * PDF bytes for the extraction pipeline: the content hash that identifies "the same book"
 * (books.content_sha256) and a small on-disk cache so one download serves the hash, pdfinfo and
 * every page render of an extraction.
 */

const CACHE_DIR = path.join(os.tmpdir(), 'readai-pdf-cache');
const DOWNLOAD_TIMEOUT_MS = 120000;

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

/** A book's PDF bytes: the private bucket for uploads, the uploader's link otherwise. */
async function downloadBookPdf(book) {
  if (book.pdf_path) return supabaseService.downloadFile(config.pdfs.bucket, book.pdf_path);
  return downloadPdf(book.pdf_url);
}

async function downloadPdf(url) {
  if (!url) throw Object.assign(new Error('Book has no PDF'), { nonRetriable: true });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) {
      const error = new Error(`PDF download failed: HTTP ${response.status}`);
      error.status = response.status;
      throw error;
    }
    return Buffer.from(await response.arrayBuffer());
  } finally {
    clearTimeout(timer);
  }
}

function cachePath(contentSha256) {
  return path.join(CACHE_DIR, `${contentSha256}.pdf`);
}

async function rememberPdf(contentSha256, buffer) {
  await fs.promises.mkdir(CACHE_DIR, { recursive: true });
  const target = cachePath(contentSha256);
  const partial = `${target}.${process.pid}.${Date.now()}.part`;
  await fs.promises.writeFile(partial, buffer);
  await fs.promises.rename(partial, target);
  return target;
}

/**
 * Local path of the PDF, downloading it once. A download whose hash differs from the expected
 * content hash is refused: the book's file changed after it was hashed.
 * @param {{book: Object, contentSha256: string}} source
 * @returns {Promise<string>}
 */
async function getPdfFile({ book, contentSha256 }) {
  const target = cachePath(contentSha256);
  try {
    await fs.promises.access(target, fs.constants.R_OK);
    return target;
  } catch {
    // not cached yet
  }
  const buffer = await downloadBookPdf(book);
  const actual = sha256(buffer);
  if (actual !== contentSha256) {
    throw Object.assign(
      new Error(`PDF content changed: expected sha256 ${contentSha256}, downloaded ${actual}`),
      { nonRetriable: true },
    );
  }
  return rememberPdf(contentSha256, buffer);
}

async function forgetPdf(contentSha256) {
  await fs.promises.rm(cachePath(contentSha256), { force: true });
}

module.exports = { sha256, downloadPdf, downloadBookPdf, rememberPdf, getPdfFile, forgetPdf, cachePath };
