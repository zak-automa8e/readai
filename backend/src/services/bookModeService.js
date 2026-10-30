const supabaseService = require('./supabaseService');

const MODES = new Set(['read', 'listen']);

// The owner still decides for everyone until the book leaves their hands
const isPrivate = (book) => !book.visibility || book.visibility === 'private';

/**
 * Read or Listen per reader (spec O14): the reader's own choice, else the book's mode, which is
 * the owner's choice and every reader's starting point once the book is shared.
 */
const bookModeService = {
  isMode: (value) => MODES.has(value),

  async modeFor(userId, book) {
    const userBook = await supabaseService.getUserBook(userId, book.id);
    return userBook?.mode || book.mode;
  },

  /**
   * While private, the owner's switch changes the book itself; after sharing, every switch
   * (the owner's too) changes only that reader's own copy. Audio is kept either way.
   */
  async setMode(userId, book, mode) {
    if (book.user_id === userId && isPrivate(book)) {
      if (book.mode !== mode) await supabaseService.updateBook(book.id, { mode });
      await supabaseService.setUserBookMode(userId, book.id, null);
    } else {
      await supabaseService.setUserBookMode(userId, book.id, mode);
    }
    return mode;
  },
};

module.exports = bookModeService;
