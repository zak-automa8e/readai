import { createContext, useContext, useState } from 'react';
import { v4 as uuidv4 } from 'uuid';

export interface Book {
  id: string;
  title: string;
  author?: string;
  uploadDate: Date;
  pdfData: Uint8Array; // Store the actual PDF data
  coverUrl?: string;
  defaultCover?: string;
}

interface BooksContextType {
  currentBook: Book | null;
  setCurrentBook: (book: Book | null) => void;
  books: Book[];
  addBook: (bookData: Omit<Book, 'id' | 'uploadDate'>) => string;
  removeBook: (id: string) => void;
  updateBook: (id: string, updates: Partial<Omit<Book, 'id' | 'uploadDate'>>) => void;
  getBookById: (id: string) => Book | undefined;
}

const BooksContext = createContext<BooksContextType | undefined>(undefined);

export function BooksProvider({ children }: { children: React.ReactNode }) {
  const [books, setBooks] = useState<Book[]>([]);
  const [currentBook, setCurrentBook] = useState<Book | null>(null);

  const addBook = (bookData: Omit<Book, 'id' | 'uploadDate'>) => {
    const newBook: Book = {
      ...bookData,
      id: uuidv4(),
      uploadDate: new Date(),
    };
    setBooks(prevBooks => [...prevBooks, newBook]);

    // Return the newly created book ID
    return newBook.id;
  };

  const removeBook = (id: string) => {
    setBooks(prevBooks => prevBooks.filter(book => book.id !== id));
    if (currentBook?.id === id) {
      setCurrentBook(null);
    }
  };

  const updateBook = (id: string, updates: Partial<Omit<Book, 'id' | 'uploadDate'>>) => {
    setBooks(prevBooks => prevBooks.map(book => 
      book.id === id ? { ...book, ...updates } : book
    ));
  };

  const getBookById = (id: string) => {
    return books.find(book => book.id === id);
  };

  return (
    <BooksContext.Provider value={{
      currentBook,
      setCurrentBook,
      books,
      addBook,
      removeBook,
      updateBook,
      getBookById,
    }}>
      {children}
    </BooksContext.Provider>
  );
}

export const useBooks = () => {
  const context = useContext(BooksContext);
  if (!context) throw new Error('useBooks must be used within BooksProvider');
  return context;
};
