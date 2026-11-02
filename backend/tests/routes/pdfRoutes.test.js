jest.mock('../../src/utils/logger', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }));
jest.mock('../../src/services/supabaseService', () => require('../helpers/fakeSupabase')());
jest.mock('../../src/middleware/authMiddleware', () => ({
  authenticateUser: (req, res, next) => {
    req.user = { id: req.headers['x-test-user'] || 'user-1' };
    next();
  },
}));

const express = require('express');
const request = require('supertest');
const db = require('../../src/services/supabaseService');
const pdfController = require('../../src/controllers/pdfController');

const app = express();
app.get('/api/books/:bookId/pdf', require('../../src/middleware/authMiddleware').authenticateUser, pdfController.getBookPdf);

const BOOK = 'book-1';
const pdf = (user, query = '') => request(app).get(`/api/books/${BOOK}/pdf${query}`).set('x-test-user', user);

beforeEach(() => {
  jest.clearAllMocks();
  db.reset();
  db.addBook({ id: BOOK, title: 'A/B: notes', pdf_url: null, pdf_path: 'pdfs/user-1/x/book.pdf', visibility: 'private' });
});

describe('GET /api/books/:bookId/pdf', () => {
  it('gives the owner a short-lived signed link, and a download link with the title as file name', async () => {
    const read = await pdf('user-1');
    expect(read.status).toBe(200);
    expect(read.body.url).toBe('https://signed.test/pdfs/user-1/x/book.pdf');
    expect(Date.parse(read.body.expiresAt) - Date.now()).toBeLessThanOrEqual(600 * 1000);
    expect(db.createSignedUrl).toHaveBeenLastCalledWith('readai-pdfs', 'pdfs/user-1/x/book.pdf', 600, {});

    expect((await pdf('user-1', '?download=1')).status).toBe(200);
    expect(db.createSignedUrl).toHaveBeenLastCalledWith('readai-pdfs', 'pdfs/user-1/x/book.pdf', 600, { download: 'A B notes.pdf' });
  });

  it('refuses another user on a private book, even with a library row (PDF_PRIVATE)', async () => {
    expect((await pdf('stranger')).body.error).toBe('FORBIDDEN');

    db.state.userBooks.push({ user_id: 'reader', book_id: BOOK });
    const res = await pdf('reader');
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('PDF_PRIVATE');
    expect(db.createSignedUrl).not.toHaveBeenCalled();
  });

  it('lets a reader of a public book read it but not download it', async () => {
    db.state.books.get(BOOK).visibility = 'public';
    db.state.userBooks.push({ user_id: 'reader', book_id: BOOK });

    expect((await pdf('reader')).status).toBe(200);
    const download = await pdf('reader', '?download=1');
    expect(download.status).toBe(403);
    expect(download.body.error).toBe('DOWNLOAD_OWNER_ONLY');
    // A public book is not open to someone who has not added it
    expect((await pdf('stranger')).status).toBe(403);
  });

  it('hands back the uploader\'s own link for a book added from a URL; 404 for a missing book', async () => {
    Object.assign(db.state.books.get(BOOK), { pdf_path: null, pdf_url: 'https://example.test/linked.pdf' });
    expect((await pdf('user-1')).body).toEqual({ url: 'https://example.test/linked.pdf', expiresAt: null });

    expect((await request(app).get('/api/books/nope/pdf')).status).toBe(404);
  });
});
