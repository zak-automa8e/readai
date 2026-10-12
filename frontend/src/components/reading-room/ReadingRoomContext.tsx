import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import { useNavigate } from "react-router-dom";
import type { DocumentProps } from "react-pdf";
import html2canvas from "html2canvas";
import { useBooks, type Book } from "@/contexts/BooksContext";
import { useVoiceChoice } from "./hooks/useVoiceChoice";
import { usePdfDocument } from "./hooks/usePdfDocument";
import { usePageAudio } from "./hooks/usePageAudio";
import { usePaneLayout, type PaneLayout } from "./hooks/usePaneLayout";

export type PdfDocument = Parameters<NonNullable<DocumentProps["onLoadSuccess"]>>[0];
export type FitMode = "width" | "page";

interface CanvasSize {
  width: number;
  height: number;
}

/** Padding around the page inside the canvas scroll container (p-6 on both sides). */
const CANVAS_PADDING_PX = 48;

interface ReadingRoomValue {
  book: Book;
  pdfUrl: string | null;
  pdf: PdfDocument | null;
  numPages: number | null;
  onDocumentLoadSuccess: (pdf: PdfDocument) => void;
  onDocumentLoadError: (error: Error) => void;
  pageNumber: number;
  fitMode: FitMode;
  setFitMode: (mode: FitMode) => void;
  zoomScale: number;
  setZoomScale: (zoom: number) => void;
  pageWidth: number;
  pageHeight: number | null;
  setCanvasSize: (size: CanvasSize) => void;
  canvasRef: RefObject<HTMLDivElement>;
  pageRef: RefObject<HTMLDivElement>;
  prefetchPageRef: RefObject<HTMLDivElement>;
  prefetchPageNumber: number | null;
  roomRef: RefObject<HTMLDivElement>;
  panes: PaneLayout;
}

type PlaybackValue = ReturnType<typeof usePageAudio> & ReturnType<typeof useVoiceChoice>;

const ReadingRoomContext = createContext<ReadingRoomValue | undefined>(undefined);
const PlaybackContext = createContext<PlaybackValue | undefined>(undefined);

export const ReadingRoomProvider = ({ children }: { children: ReactNode }) => {
  const { currentBook } = useBooks();
  const navigate = useNavigate();

  const [pageNumber, setPageNumber] = useState(1);
  const [fitMode, setFitMode] = useState<FitMode>("width");
  const [zoomScale, setZoomScale] = useState<number>(100); // 50-150%
  const [canvasSize, setCanvasSizeState] = useState<CanvasSize | null>(null);
  const [pdf, setPdf] = useState<PdfDocument | null>(null);

  const canvasRef = useRef<HTMLDivElement>(null);
  const pageRef = useRef<HTMLDivElement>(null);
  const roomRef = useRef<HTMLDivElement>(null);

  const panes = usePaneLayout();
  const voice = useVoiceChoice();

  // The canvas pane re-measures itself (ResizeObserver), so there is nothing to do on load here.
  const { pdfUrl, numPages, onDocumentLoadSuccess, onDocumentLoadError } = usePdfDocument(currentBook, () => {});

  // Redirect to library if no book is selected (must be in useEffect, not during render)
  useEffect(() => {
    if (!currentBook) {
      navigate("/library");
    }
  }, [currentBook, navigate]);

  // Keep Document callbacks stable so the room context value only changes with real state.
  const loadSuccessRef = useRef(onDocumentLoadSuccess);
  loadSuccessRef.current = onDocumentLoadSuccess;
  const loadErrorRef = useRef(onDocumentLoadError);
  loadErrorRef.current = onDocumentLoadError;
  const handleLoadSuccess = useCallback((doc: PdfDocument) => {
    setPdf(doc);
    loadSuccessRef.current(doc);
  }, []);
  const handleLoadError = useCallback((error: Error) => loadErrorRef.current(error), []);

  const setCanvasSize = useCallback((size: CanvasSize) => {
    setCanvasSizeState(prev =>
      prev && Math.abs(prev.width - size.width) < 1 && Math.abs(prev.height - size.height) < 1 ? prev : size
    );
  }, []);

  // Same fit rules as before the shell rewrite, but measured from the canvas pane instead of the window.
  // react-pdf ignores `height` whenever `width` is set, so fit-page is still effectively 90% width (story 3).
  const { pageWidth, pageHeight } = useMemo(() => {
    if (!canvasSize) return { pageWidth: 800, pageHeight: null };
    const scale = zoomScale / 100;
    if (fitMode === "page") {
      return {
        pageWidth: canvasSize.width * 0.9 * scale,
        pageHeight: Math.max(0, canvasSize.height - CANVAS_PADDING_PX) * scale,
      };
    }
    return { pageWidth: Math.min(canvasSize.width * 0.9, 800) * scale, pageHeight: null };
  }, [canvasSize, fitMode, zoomScale]);

  // Fallback method to capture the entire container if pageRef doesn't work
  const capturePageContent = async () => {
    if (!canvasRef.current) {
      return null;
    }

    try {
      // Add a larger delay to ensure rendering is complete
      await new Promise(resolve => setTimeout(resolve, 500));

      // Try different target elements to find one that works
      const canvas = document.createElement("canvas");
      const targetElement = canvasRef.current.querySelector(".react-pdf__Page");

      if (targetElement) {
        // If we find the react-pdf Page element, try to capture just that
        const rect = targetElement.getBoundingClientRect();
        canvas.width = rect.width * 2; // Higher resolution
        canvas.height = rect.height * 2;

        // Manual approach - try to draw the PDF canvas onto our own canvas
        const pdfCanvas = targetElement.querySelector("canvas");
        if (pdfCanvas) {
          const ctx = canvas.getContext("2d");
          if (ctx) {
            ctx.drawImage(pdfCanvas, 0, 0, canvas.width, canvas.height);
            return canvas;
          }
        }

        // If direct canvas copy fails, fall back to html2canvas
        return await html2canvas(targetElement as HTMLElement, {
          useCORS: true,
          allowTaint: true,
          foreignObjectRendering: false, // Disable foreignObject rendering
          scale: 2,
          imageTimeout: 0,
          removeContainer: false,
        });
      }

      // If can't find the page element, try the pdf-page-container
      const pdfContainer = canvasRef.current.querySelector(".pdf-page-container");
      if (pdfContainer) {
        return await html2canvas(pdfContainer as HTMLElement, {
          useCORS: true,
          allowTaint: true,
          foreignObjectRendering: false,
          scale: 2,
          imageTimeout: 0,
          removeContainer: false,
        });
      }

      // Last resort - try the entire container
      return await html2canvas(canvasRef.current, {
        useCORS: true,
        allowTaint: true,
        foreignObjectRendering: false,
        scale: 2,
        imageTimeout: 0,
        removeContainer: false,
      });
    } catch (error) {
      return null;
    }
  };

  // Capture the rendered page as a canvas for OCR
  const capturePage = async (): Promise<HTMLCanvasElement | null> => {
    try {
      // Use different html2canvas configuration to improve capture
      return await html2canvas(pageRef.current, {
        useCORS: true,
        allowTaint: true,
        foreignObjectRendering: false, // Changed to false to avoid ForeignObject rendering issues
        scale: 2, // Higher resolution capture
        imageTimeout: 0, // No timeout for images
        removeContainer: false,
        ignoreElements: (element) => {
          // Ignore UI elements that might interfere with capture
          return element.tagName === "BUTTON" ||
                element.classList.contains("absolute");
        }
      });
    } catch (captureError) {
      return await capturePageContent();
    }
  };

  const audio = usePageAudio({
    currentBook,
    pageNumber,
    setPageNumber,
    numPages,
    activePersonaId: voice.activePersonaId,
    activePersonaIdRef: voice.activePersonaIdRef,
    isLoadingPersonas: voice.isLoadingPersonas,
    pageRef,
    capturePage,
  });

  const { prefetchPageRef, prefetchPageNumber } = audio;

  const room = useMemo<ReadingRoomValue | undefined>(
    () =>
      currentBook
        ? {
            book: currentBook,
            pdfUrl,
            pdf,
            numPages,
            onDocumentLoadSuccess: handleLoadSuccess,
            onDocumentLoadError: handleLoadError,
            pageNumber,
            fitMode,
            setFitMode,
            zoomScale,
            setZoomScale,
            pageWidth,
            pageHeight,
            setCanvasSize,
            canvasRef,
            pageRef,
            prefetchPageRef,
            prefetchPageNumber,
            roomRef,
            panes,
          }
        : undefined,
    [
      currentBook,
      pdfUrl,
      pdf,
      numPages,
      handleLoadSuccess,
      handleLoadError,
      pageNumber,
      fitMode,
      zoomScale,
      pageWidth,
      pageHeight,
      setCanvasSize,
      prefetchPageRef,
      prefetchPageNumber,
      panes,
    ]
  );

  // Playback changes several times a second while audio plays; only the now-playing bar reads it.
  const playback: PlaybackValue = { ...audio, ...voice };

  // Don't render anything if no book (useEffect above will handle redirect)
  if (!room) {
    return null;
  }

  return (
    <ReadingRoomContext.Provider value={room}>
      <PlaybackContext.Provider value={playback}>{children}</PlaybackContext.Provider>
    </ReadingRoomContext.Provider>
  );
};

export const useReadingRoom = () => {
  const context = useContext(ReadingRoomContext);
  if (!context) throw new Error("useReadingRoom must be used within ReadingRoomProvider");
  return context;
};

export const usePlayback = () => {
  const context = useContext(PlaybackContext);
  if (!context) throw new Error("usePlayback must be used within ReadingRoomProvider");
  return context;
};
