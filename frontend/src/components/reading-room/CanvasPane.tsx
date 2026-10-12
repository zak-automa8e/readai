import type { ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { Document, Page } from "react-pdf";
import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";
import { Button } from "../ui/button";
import { useReadingRoom } from "./ReadingRoomContext";

// Worker is configured globally in main.tsx - no need to set it here

/**
 * Middle pane. Owns the single react-pdf <Document> and the hidden prefetch page used by audio,
 * and renders `children` as the visible view (today the PDF page; later stories can swap in or
 * add a text view without unmounting the document or the prefetch page).
 */
export const CanvasPane = ({ children }: { children: ReactNode }) => {
  const navigate = useNavigate();
  const { book, pdfUrl, onDocumentLoadSuccess, onDocumentLoadError, prefetchPageNumber, prefetchPageRef, pageWidth } =
    useReadingRoom();

  if (!pdfUrl) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-center">
        <div>
          <p className="mb-2 text-destructive">PDF not available</p>
          <p className="mb-4 text-sm text-muted-foreground">
            PDF URL: {book.pdf_url || "Not provided"}
            <br />
            Local Data: {book.pdfData ? "Available" : "Not available"}
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
      onLoadSuccess={onDocumentLoadSuccess}
      onLoadError={onDocumentLoadError}
      className="flex h-full min-h-0 flex-col"
      loading={
        <div className="flex h-full items-center justify-center">
          <div className="py-4 text-center">
            <div className="mx-auto mb-2 h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent"></div>
            <p>Loading PDF...</p>
            <p className="mt-2 text-xs text-muted-foreground">URL: {pdfUrl}</p>
          </div>
        </div>
      }
      error={
        <div className="py-4 text-center text-destructive">
          <p>Error loading PDF. Please try again.</p>
          <p className="mt-2 text-xs text-muted-foreground">URL: {pdfUrl}</p>
          <p className="mt-1 text-xs text-destructive">Check console for detailed error information</p>
        </div>
      }
    >
      <div className="flex min-h-0 flex-1 flex-col">{children}</div>
      {/* Hidden page for prefetching: rendered in a zero-height clip, not positioned off-screen */}
      {prefetchPageNumber && (
        <div ref={prefetchPageRef} className="pointer-events-none h-0 overflow-hidden" aria-hidden="true">
          <Page
            pageNumber={prefetchPageNumber}
            width={pageWidth}
            renderAnnotationLayer={false}
            renderTextLayer={false}
          />
        </div>
      )}
    </Document>
  );
};
