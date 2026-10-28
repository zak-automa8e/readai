/**
 * Where the reader was in a book: the page, and the paragraph being listened to (segment player).
 * Kept in this browser so reopening lands on it at once; the page also goes to the server
 * (user_books.last_read_page), which is the fallback on another device.
 */
export interface ReadingPosition {
  page: number;
  seq: number | null;
}

const key = (bookId: string) => `readai:position:${bookId}`;

export function loadPosition(bookId: string, serverPage?: number): ReadingPosition {
  try {
    const stored = JSON.parse(localStorage.getItem(key(bookId)) || "null");
    if (stored && Number.isInteger(stored.page) && stored.page > 0) {
      return { page: stored.page, seq: Number.isInteger(stored.seq) ? stored.seq : null };
    }
  } catch {
    // Unreadable: fall back to the server's page
  }
  return { page: serverPage && serverPage > 0 ? serverPage : 1, seq: null };
}

export function storePosition(bookId: string, position: ReadingPosition) {
  try {
    localStorage.setItem(key(bookId), JSON.stringify(position));
  } catch {
    // Storage full or blocked: the server copy of the page still works
  }
}
