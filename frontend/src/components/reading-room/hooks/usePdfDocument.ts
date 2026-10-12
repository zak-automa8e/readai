import { useState, useEffect } from "react";
import { toast } from "@/hooks/use-toast";
import type { Book } from "@/contexts/BooksContext";

export const usePdfDocument = (currentBook: Book | null, onLoaded: () => void) => {
  const [numPages, setNumPages] = useState<number | null>(null);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);

  useEffect(() => {
    // Handle PDF URL from backend or create Blob URL from local data
    if (currentBook?.pdf_url) {
      
      // Try to properly encode the URL to handle any special characters
      let processedUrl = currentBook.pdf_url;
      try {
        // Parse and rebuild the URL to ensure proper encoding
        const url = new URL(currentBook.pdf_url);
        processedUrl = url.toString();
      } catch (error) {
  // Ignore URL parsing issues; fall back to original
      }
      
      setPdfUrl(processedUrl);
    } else if (currentBook?.pdfData) {
      const blob = new Blob([new Uint8Array(currentBook.pdfData)], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      setPdfUrl(url);
      return () => {
        URL.revokeObjectURL(url);
      };
    } else {
      setPdfUrl(null);
    }
  }, [currentBook]);

  const onDocumentLoadSuccess = ({ numPages }: { numPages: number }) => {
    setNumPages(numPages);
    onLoaded(); // Update dimensions after document loads
  };

  const onDocumentLoadError = (error: Error) => {
    toast({
      title: "PDF Load Error",
      description: `Failed to load PDF: ${error.message}`,
      variant: "destructive"
    });
  };

  return { pdfUrl, numPages, onDocumentLoadSuccess, onDocumentLoadError };
};
