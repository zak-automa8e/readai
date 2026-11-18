import { useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useBooks } from "@/contexts/BooksContext";

/** The reader's address for one book; a reload or a copied link reopens it. */
export const readPath = (bookId: string) => `/read?book=${encodeURIComponent(bookId)}`;

/**
 * Keeps the open book and the `?book=` address in step.
 * - A book is open but the address does not name it: the address is rewritten (no new history entry).
 * - The address names a book that is not open (a reload): it is reopened from the library once
 *   the library has loaded.
 * - Nothing to open, or the book is not in the library: back to the Library.
 */
export function useBookFromUrl() {
  const { currentBook, setCurrentBook, books, libraryLoaded } = useBooks();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const wanted = params.get("book");

  useEffect(() => {
    if (currentBook) {
      if (wanted !== currentBook.id) setParams({ book: currentBook.id }, { replace: true });
      return;
    }
    if (!wanted) {
      navigate("/library", { replace: true });
      return;
    }
    if (!libraryLoaded) return;
    const book = books.find((b) => b.id === wanted);
    if (book) setCurrentBook(book);
    else navigate("/library", { replace: true });
  }, [currentBook, wanted, books, libraryLoaded, setCurrentBook, setParams, navigate]);
}
