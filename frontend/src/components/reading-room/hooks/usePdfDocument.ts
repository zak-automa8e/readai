import { useState, useEffect, useCallback, useRef } from "react";
import { toast } from "@/hooks/use-toast";
import type { Book } from "@/contexts/BooksContext";
import { ListeningApiError, listeningService } from "@/services/listeningService";

/** Why the PDF is not shown: the owner made a shared book private, or the link could not be fetched. */
export type PdfUnavailable = "private" | "failed" | null;

/**
 * react-pdf options: load the whole file in one request, so the short-lived link (sharing spec
 * story 0) may expire once the document has loaded. Module level: react-pdf reloads on a new object.
 */
export const PDF_OPTIONS = { disableRange: true, disableStream: true } as const;

export const usePdfDocument = (currentBook: Book | null, onLoaded: () => void) => {
  const [numPages, setNumPages] = useState<number | null>(null);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [unavailable, setUnavailable] = useState<PdfUnavailable>(null);
  const [attempt, setAttempt] = useState(0);
  const retried = useRef(false);

  const bookId = currentBook?.id;
  const hasPdf = currentBook?.has_pdf;
  const pdfData = currentBook?.pdfData;

  useEffect(() => {
    retried.current = false;
    setAttempt(0);
  }, [bookId]);

  useEffect(() => {
    setUnavailable(null);
    if (bookId && hasPdf) {
      let cancelled = false;
      listeningService
        .getPdfLink(bookId)
        .then(({ url }) => {
          if (!cancelled) setPdfUrl(url);
        })
        .catch((error) => {
          if (cancelled) return;
          setPdfUrl(null);
          setUnavailable(error instanceof ListeningApiError && error.code === "PDF_PRIVATE" ? "private" : "failed");
        });
      return () => {
        cancelled = true;
      };
    }
    if (pdfData) {
      const blob = new Blob([new Uint8Array(pdfData)], { type: "application/pdf" });
      const url = URL.createObjectURL(blob);
      setPdfUrl(url);
      return () => {
        URL.revokeObjectURL(url);
      };
    }
    setPdfUrl(null);
  }, [bookId, hasPdf, pdfData, attempt]);

  const onDocumentLoadSuccess = ({ numPages }: { numPages: number }) => {
    setNumPages(numPages);
    onLoaded(); // Update dimensions after document loads
  };

  const onDocumentLoadError = useCallback((error: Error) => {
    // The link may have expired before the file loaded: ask for a fresh one once
    if (hasPdf && !retried.current) {
      retried.current = true;
      setAttempt((n) => n + 1);
      return;
    }
    toast({
      title: "PDF Load Error",
      description: `Failed to load PDF: ${error.message}`,
      variant: "destructive"
    });
  }, [hasPdf]);

  return { pdfUrl, numPages, unavailable, onDocumentLoadSuccess, onDocumentLoadError };
};
