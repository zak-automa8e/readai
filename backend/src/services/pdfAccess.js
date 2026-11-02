const config = require('../config');
const supabaseService = require('./supabaseService');

/**
 * Who may open a book's PDF (sharing spec S5, S6). Uploaded PDFs sit in the private bucket at
 * books.pdf_path; a book added from a link keeps the uploader's own books.pdf_url.
 */

const isPublic = (book) => book.visibility === 'public';

/** 'ok', or why not: 'private' = the reader has it in their library but the owner made it private. */
async function readAccess(userId, book) {
  if (book.user_id === userId) return 'ok';
  const inLibrary = Boolean(await supabaseService.getUserBook(userId, book.id));
  if (!inLibrary) return 'forbidden';
  return isPublic(book) ? 'ok' : 'private';
}

const canDownload = (userId, book) => book.user_id === userId;

const hasPdf = (book) => Boolean(book.pdf_path || book.pdf_url);

const downloadName = (book) => `${(book.title || 'book').replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim() || 'book'}.pdf`;

/**
 * A link the browser (or the server's own fetch) can open: signed for uploads, the external link otherwise.
 * @returns {Promise<{url: string, expiresAt: string|null}|null>}
 */
async function linkFor(book, { download = false } = {}) {
  if (book.pdf_path) {
    const { bucket, linkSeconds } = config.pdfs;
    const url = await supabaseService.createSignedUrl(bucket, book.pdf_path, linkSeconds, download ? { download: downloadName(book) } : {});
    return { url, expiresAt: new Date(Date.now() + linkSeconds * 1000).toISOString() };
  }
  if (book.pdf_url) return { url: book.pdf_url, expiresAt: null };
  return null;
}

module.exports = { readAccess, canDownload, hasPdf, linkFor };
