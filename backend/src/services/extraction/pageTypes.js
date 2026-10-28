// Page types the listening window passes over (O8 defaults: never voiced unless the listener asks for them)
const DEFAULT_SKIPPED_TYPES = new Set(['cover', 'title', 'copyright', 'blank', 'toc', 'index', 'back_cover', 'dedication', 'author_note']);
// "Read all front matter" (user_books.read_front_matter) brings these back
const FRONT_MATTER_TYPES = new Set(['title', 'copyright', 'dedication', 'author_note', 'toc']);

module.exports = { DEFAULT_SKIPPED_TYPES, FRONT_MATTER_TYPES };
