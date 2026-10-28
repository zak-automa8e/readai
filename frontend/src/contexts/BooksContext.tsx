import { createContext, useContext, useState, useEffect } from 'react';
import { useAuth } from './AuthContext';
import apiService from '@/services/apiService';
import { toast } from '@/hooks/use-toast';

export interface Book {
  id: string;
  title: string;
  author?: string;
  description?: string;
  uploadDate: Date;
  pdfData?: Uint8Array; // For local processing only
  pdf_url?: string; // URL from backend storage
  pdf_source?: 'upload' | 'url';
  coverUrl?: string;
  defaultCover?: string;
  thumbnail_url?: string;
  total_pages?: number;
  processing_status?: 'pending' | 'processing' | 'completed' | 'failed';
  last_read_page?: number;
  reading_progress?: number;
  total_reading_time_minutes?: number;
  created_at?: string;
  updated_at?: string;
}

interface BooksContextType {
  currentBook: Book | null;
  setCurrentBook: (book: Book | null) => void;
  books: Book[];
  loading: boolean;
  error: string | null;
  addBook: (bookData: Omit<Book, 'id' | 'uploadDate'>) => Promise<string>;
  removeBook: (id: string) => Promise<void>;
  updateBook: (id: string, updates: Partial<Omit<Book, 'id' | 'uploadDate'>>) => Promise<void>;
  getBookById: (id: string) => Book | undefined;
  uploadPDF: (file: File, metadata: { title: string; author?: string; description?: string }) => Promise<Book>;
  refreshLibrary: () => Promise<void>;
}

const BooksContext = createContext<BooksContextType | undefined>(undefined);

export function BooksProvider({ children }: { children: React.ReactNode }) {
  const [books, setBooks] = useState<Book[]>([]);
  const [currentBook, setCurrentBook] = useState<Book | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { user, session } = useAuth();

  // Load user's library when authenticated
  useEffect(() => {
    if (user && session) {
      refreshLibrary();
    } else {
      // Clear books when user logs out
      setBooks([]);
      setCurrentBook(null);
    }
  }, [user, session]);

  const refreshLibrary = async () => {
    if (!user || !session) return;

    setLoading(true);
    setError(null);
    try {
  const response = await apiService.getUserLibrary();
      
      if (response.success && response.books) {
        // Transform backend book data to match our interface
        const transformedBooks: Book[] = response.books
          .filter((userBook: any) => userBook && userBook.books) // Filter out invalid entries
          .map((userBook: any) => {
            return {
              id: userBook.books.id, // Use the actual book ID from nested books object
              title: userBook.books.title ?? 'Untitled',
              author: userBook.books.author ?? undefined,
              description: userBook.books.description ?? undefined,
              uploadDate: new Date(userBook.books.created_at || Date.now()),
              pdf_url: userBook.books.pdf_url || undefined,
              pdf_source: userBook.books.pdf_source || 'upload',
              thumbnail_url: userBook.books.thumbnail_url || undefined,
              total_pages: userBook.books.total_pages || undefined,
              processing_status: userBook.books.processing_status || 'pending',
              last_read_page: userBook.last_read_page || 0,
              reading_progress: userBook.reading_progress || 0,
              total_reading_time_minutes: userBook.total_reading_time_minutes || 0,
              created_at: userBook.books.created_at || undefined,
              updated_at: userBook.books.updated_at || undefined,
            };
          });
        setBooks(transformedBooks);
        
      } else {
        setBooks([]);
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to load library';
      setError(errorMessage);
      toast({
        title: "Error",
        description: errorMessage,
        variant: "destructive"
      });
    } finally {
      setLoading(false);
    }
  };

  const generateBookThumbnail = async (book: Book): Promise<string | undefined> => {
    if (book.thumbnail_url || book.coverUrl || book.defaultCover) {
      return book.thumbnail_url || book.coverUrl || book.defaultCover;
    }

    if (!book.pdf_url) {
      return undefined;
    }

    try {
      // Test if URL is accessible first
      const headResponse = await fetch(book.pdf_url, { method: 'HEAD' });
      
      if (!headResponse.ok) {
        throw new Error(`PDF not accessible: ${headResponse.status} ${headResponse.statusText}`);
      }
      
  // SIMPLE APPROACH: Create a basic thumbnail with canvas
      // Create a simple canvas with book title as thumbnail
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      
      if (!ctx) {
        throw new Error('Could not get canvas context');
      }
      
      canvas.width = 200;
      canvas.height = 300;
      
      // Narwi palette (brand/tokens): paper background, hairline border
      ctx.fillStyle = '#F7F5EF';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      // Add border
      ctx.strokeStyle = '#E2E0D8';
      ctx.lineWidth = 2;
      ctx.strokeRect(1, 1, canvas.width - 2, canvas.height - 2);

      // PDF label on lapis
      ctx.fillStyle = '#1E3A8A';
      ctx.fillRect(20, 20, 160, 40);
      ctx.fillStyle = '#FFFFFF';
      ctx.font = '600 16px "Readex Pro", Arial, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('PDF', 100, 45);

      // Add book title
      ctx.fillStyle = '#161A2B';
      ctx.font = '14px "Readex Pro", Arial, sans-serif';
      ctx.textAlign = 'center';
      
      // Word wrap the title
      const words = book.title.split(' ');
      let line = '';
      let y = 100;
      
      for (let n = 0; n < words.length; n++) {
        const testLine = line + words[n] + ' ';
        const metrics = ctx.measureText(testLine);
        const testWidth = metrics.width;
        
        if (testWidth > 160 && n > 0) {
          ctx.fillText(line.trim(), 100, y);
          line = words[n] + ' ';
          y += 20;
          if (y > 250) break; // Don't overflow
        } else {
          line = testLine;
        }
      }
      ctx.fillText(line.trim(), 100, y);
      
      const thumbnailUrl = canvas.toDataURL('image/png');
      if (thumbnailUrl && thumbnailUrl !== '/placeholder.svg') {
        // Update the book in our local state with the generated thumbnail
        setBooks(prevBooks => {
          const updatedBooks = prevBooks.map(b => 
            b.id === book.id 
              ? { ...b, defaultCover: thumbnailUrl }
              : b
          );
          return updatedBooks;
        });
        
        return thumbnailUrl;
      } else {
        return undefined;
      }
    } catch (error) {
  // Silent fail; no console spam
    }
    
    return undefined;
  };

  // Generate thumbnails for books without covers
  useEffect(() => {
    if (books.length > 0) {
      books.forEach((book) => {
        if (!book.thumbnail_url && !book.coverUrl && !book.defaultCover && book.pdf_url) {
          generateBookThumbnail(book).catch(() => {});
        }
      });
    }
  }, [books.length]);

  const addBook = async (bookData: Omit<Book, 'id' | 'uploadDate'>): Promise<string> => {
    if (!user || !session) {
      throw new Error('User must be authenticated to add books');
    }

    try {
      setLoading(true);
      
      // Create book in backend
      const response = await apiService.createBook({
        title: bookData.title,
        author: bookData.author,
        description: bookData.description,
        pdf_url: bookData.pdf_url,
        pdf_source: bookData.pdf_source || 'upload',
        thumbnail_url: bookData.thumbnail_url,
        total_pages: bookData.total_pages
      });

      if (response.success) {
        // Transform and add to local state
        const newBook: Book = {
          id: response.book.id,
          title: response.book.title,
          author: response.book.author,
          description: response.book.description,
          uploadDate: new Date(response.book.created_at),
          pdf_url: response.book.pdf_url,
          pdf_source: response.book.pdf_source,
          thumbnail_url: response.book.thumbnail_url,
          total_pages: response.book.total_pages,
          processing_status: response.book.processing_status,
          created_at: response.book.created_at,
          updated_at: response.book.updated_at,
          // Include local data if provided
          pdfData: bookData.pdfData,
          defaultCover: bookData.defaultCover,
        };

        setBooks(prevBooks => [...prevBooks, newBook]);
        
        toast({
          title: "Success",
          description: "Book added to library",
        });

        // Background refresh: poll for thumbnail_url update up to ~30s
        try {
          const start = Date.now();
          const poll = async () => {
            // Stop after 30s
            if (Date.now() - start > 30000) return;
            await refreshLibrary();
            const updated = (prevId: string) => {
              const b = books.find(x => x.id === prevId);
              return b?.thumbnail_url;
            };
            if (!updated(newBook.id)) {
              await new Promise(r => setTimeout(r, 2000));
              await poll();
            }
          };
          // Fire and forget
          poll().catch(() => {});
        } catch {}

        return newBook.id;
      } else {
        throw new Error('Failed to create book');
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to add book';
      setError(errorMessage);
      toast({
        title: "Error",
        description: errorMessage,
        variant: "destructive"
      });
      throw err;
    } finally {
      setLoading(false);
    }
  };

  const uploadPDF = async (file: File, metadata: { title: string; author?: string; description?: string }): Promise<Book> => {
    if (!user || !session) {
      throw new Error('User must be authenticated to upload PDFs');
    }

    try {
      setLoading(true);
      
      const response = await apiService.uploadPDF(file, metadata);

      if (response.success) {
        const newBook: Book = {
          id: response.book.id,
          title: response.book.title,
          author: response.book.author,
          description: response.book.description,
          uploadDate: new Date(response.book.created_at),
          pdf_url: response.book.pdf_url,
          pdf_source: response.book.pdf_source,
          thumbnail_url: response.book.thumbnail_url,
          total_pages: response.book.total_pages,
          processing_status: response.book.processing_status,
          created_at: response.book.created_at,
          updated_at: response.book.updated_at,
        };

        setBooks(prevBooks => [...prevBooks, newBook]);
        
        toast({
          title: "Success",
          description: "PDF uploaded successfully",
        });

        // Background refresh: poll for thumbnail_url update up to ~30s
        try {
          const start = Date.now();
          const poll = async () => {
            if (Date.now() - start > 30000) return;
            await refreshLibrary();
            const updated = (prevId: string) => {
              const b = books.find(x => x.id === prevId);
              return b?.thumbnail_url;
            };
            if (!updated(newBook.id)) {
              await new Promise(r => setTimeout(r, 2000));
              await poll();
            }
          };
          poll().catch(() => {});
        } catch {}

        return newBook;
      } else {
        throw new Error('Failed to upload PDF');
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to upload PDF';
      setError(errorMessage);
      toast({
        title: "Error",
        description: errorMessage,
        variant: "destructive"
      });
      throw err;
    } finally {
      setLoading(false);
    }
  };

  const removeBook = async (id: string): Promise<void> => {
    if (!user || !session) {
      throw new Error('User must be authenticated to remove books');
    }
    setLoading(true);
    try {
      const response = await apiService.deleteBook(id);
      setBooks(prevBooks => prevBooks.filter(book => book.id !== id));
      if (currentBook?.id === id) {
        setCurrentBook(null);
      }
      toast({
        title: "Success",
        description: response.fullyDeleted
          ? "Book fully deleted from library."
          : "Book removed from your library.",
      });
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to remove book';
      setError(errorMessage);
      toast({
        title: "Error",
        description: errorMessage,
        variant: "destructive"
      });
      throw err;
    } finally {
      setLoading(false);
    }
  };

  const updateBook = async (
    id: string,
    updates: Partial<Omit<Book, 'id' | 'uploadDate'>> & { coverFile?: File }
  ): Promise<void> => {
    if (!user || !session) {
      throw new Error('User must be authenticated to update books');
    }
    setLoading(true);
    try {
      const response = await apiService.updateBook(id, updates);
      if (response.success && response.book) {
        setBooks(prevBooks => prevBooks.map(book =>
          book.id === id ? { ...book, ...response.book } : book
        ));
        if (currentBook?.id === id) {
          setCurrentBook({ ...currentBook, ...response.book });
        }
        toast({
          title: "Success",
          description: "Book updated successfully",
        });
      } else {
        throw new Error('Failed to update book');
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to update book';
      setError(errorMessage);
      toast({
        title: "Error",
        description: errorMessage,
        variant: "destructive"
      });
      throw err;
    } finally {
      setLoading(false);
    }
  };

  const getBookById = (id: string) => {
    return books.find(book => book.id === id);
  };

  return (
    <BooksContext.Provider value={{
      currentBook,
      setCurrentBook,
      books,
      loading,
      error,
      addBook,
      removeBook,
      updateBook,
      getBookById,
      uploadPDF,
      refreshLibrary,
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
