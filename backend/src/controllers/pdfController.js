const supabaseService = require('../services/supabaseService');
const pdfAccess = require('../services/pdfAccess');
const logger = require('../utils/logger');

/**
 * A book's PDF (sharing spec story 0): the owner, or a reader of a public book in their library,
 * gets a short-lived link; only the owner may download.
 */
const pdfController = {
  /**
   * GET /api/books/:bookId/pdf[?download=1] → { url, expiresAt }
   */
  async getBookPdf(req, res) {
    try {
      const userId = req.user.id;
      const book = await supabaseService.getBookById(req.params.bookId).catch(() => null);
      if (!book) return res.status(404).json({ error: 'NOT_FOUND', message: 'Book not found' });

      const access = await pdfAccess.readAccess(userId, book);
      if (access === 'private') {
        return res.status(403).json({ error: 'PDF_PRIVATE', message: 'The owner made this book private.' });
      }
      if (access !== 'ok') return res.status(403).json({ error: 'FORBIDDEN', message: 'Access denied to this book' });

      const download = req.query.download === '1';
      if (download && !pdfAccess.canDownload(userId, book)) {
        return res.status(403).json({ error: 'DOWNLOAD_OWNER_ONLY', message: 'Only the person who uploaded this book can download it.' });
      }

      const link = await pdfAccess.linkFor(book, { download });
      if (!link) return res.status(404).json({ error: 'NO_PDF', message: 'This book has no PDF.' });
      res.set('Cache-Control', 'no-store');
      return res.json(link);
    } catch (error) {
      logger.error('Error in getBookPdf:', error);
      return res.status(500).json({ error: 'PDF_LINK_FAILED', message: 'Failed to open this book.' });
    }
  },
};

module.exports = pdfController;
