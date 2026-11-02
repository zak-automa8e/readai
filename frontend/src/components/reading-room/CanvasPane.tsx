import type { ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { Document, Page } from "react-pdf";
import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";
import { Button } from "../ui/button";
import { useReadingRoom } from "./ReadingRoomContext";
import { CAPTURE_WIDTH_PX } from "./pageCapture";
import { PDF_OPTIONS } from "./hooks/usePdfDocument";

// Worker is configured globally in main.tsx - no need to set it here

/**
 * Middle pane. Owns the single react-pdf <Document> and the hidden prefetch page used by audio,
 * and renders `children` as the visible view (today the PDF page; later stories can swap in or
 * add a text view without unmounting the document or the prefetch page).
 */
export const CanvasPane = ({ children }: { children: ReactNode }) => {
  const navigate = useNavigate();
  const { book, pdfUrl, pdfUnavailable, onDocumentLoadSuccess, onDocumentLoadError, prefetchPageNumber, prefetchPageRef } =
    useReadingRoom();

  if (!pdfUrl) {
    // Still asking for the link
    if (book.has_pdf && !pdfUnavailable) {
      return (
        <div className="flex h-full items-center justify-center">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" aria-label="Loading PDF" />
        </div>
      );
    }
    return (
      <div className="flex h-full items-center justify-center p-6 text-center">
        <div>
          <p className="mb-2 text-foreground">
            {pdfUnavailable === "private" ? "The owner made this book private." : "This book's PDF could not be opened."}
          </p>
          <p className="mb-4 text-sm text-muted-foreground">
            {pdfUnavailable === "private"
              ? "Your notes and progress are kept in your library."
              : "Try again in a moment."}
          </p>
          <Button onClick={() => navigate("/library")} variant="outline">
            Back to Library
          </Button>
        </div>
      </div>
    );
  }

  return (
    <Document
      file={pdfUrl}
      options={PDF_OPTIONS}
      onLoadSuccess={onDocumentLoadSuccess}
      onLoadError={onDocumentLoadError}
      className="flex h-full min-h-0 flex-col"
      loading={
        <div className="flex h-full items-center justify-center">
          <div className="py-4 text-center">
            <div className="mx-auto mb-2 h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent"></div>
            <p>Loading PDF...</p>
          </div>
        </div>
      }
      error={
        <div className="py-4 text-center text-destructive">
          <p>Error loading PDF. Please try again.</p>
        </div>
      }
    >
      <div className="flex min-h-0 flex-1 flex-col">{children}</div>
      {/* Hidden page for prefetching: rendered in a zero-height clip, not positioned off-screen.
          Fixed width and pixel ratio, so its OCR input matches capturePage and ignores the pane. */}
      {prefetchPageNumber && (
        <div ref={prefetchPageRef} className="pointer-events-none h-0 overflow-hidden" aria-hidden="true">
          <Page
            pageNumber={prefetchPageNumber}
            width={CAPTURE_WIDTH_PX}
            devicePixelRatio={1}
            renderAnnotationLayer={false}
            renderTextLayer={false}
          />
        </div>
      )}
    </Document>
  );
};
