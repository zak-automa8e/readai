const express = require('express');
const multer = require('multer');
const { authenticateUser } = require('../middleware/authMiddleware');
const booksController = require('../controllers/booksController');
const notesController = require('../controllers/notesController');
const pdfController = require('../controllers/pdfController');

const router = express.Router();

// Configure multer for file uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB limit
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/pdf') {
      cb(null, true);
    } else {
      cb(new Error('Only PDF files are allowed'), false);
    }
  }
});

// Public routes (no authentication required)
router.get('/public', booksController.getPublicBooks);


// Protected routes (authentication required)
router.get('/library', authenticateUser, booksController.getUserLibrary);
router.post('/', authenticateUser, booksController.createBook);
router.post('/upload', authenticateUser, upload.single('pdf'), booksController.uploadPDF);
router.post('/:bookId/add-to-library', authenticateUser, booksController.addToLibrary);
router.put('/:bookId/progress', authenticateUser, booksController.updateProgress);
router.get('/:bookId/pdf', authenticateUser, pdfController.getBookPdf);

// Notes routes
router.get('/:bookId/notes', authenticateUser, notesController.listNotes);
router.post('/:bookId/notes', authenticateUser, notesController.createNote);
router.patch('/:bookId/notes/:noteId', authenticateUser, notesController.updateNote);
router.delete('/:bookId/notes/:noteId', authenticateUser, notesController.deleteNote);

// PATCH for book details (title, author, cover)
const coverUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB for cover
  fileFilter: (req, file, cb) => {
    if (["image/png", "image/jpeg"].includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error("Only PNG/JPG images allowed for cover"), false);
    }
  }
});
router.patch('/:bookId', authenticateUser, coverUpload.single('cover'), booksController.updateBookDetails);
// Allow PUT as an alias for update to be tolerant to client differences
router.put('/:bookId', authenticateUser, coverUpload.single('cover'), booksController.updateBookDetails);

// DELETE for book (remove from library or full delete)
router.delete('/:bookId', authenticateUser, booksController.deleteBookOrRemoveFromLibrary);

module.exports = router;
