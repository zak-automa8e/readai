import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import { useNavigate } from "react-router-dom";
import type { DocumentProps } from "react-pdf";
import { useBooks, type Book } from "@/contexts/BooksContext";
import { useVoiceChoice } from "./hooks/useVoiceChoice";
import { usePdfDocument } from "./hooks/usePdfDocument";
import { usePageAudio } from "./hooks/usePageAudio";
import { useSegmentPlayback } from "./hooks/useSegmentPlayback";
import { useBookProcessing, type PlayerKind } from "./hooks/useBookProcessing";
import type { ProcessingStatus } from "@/types/segments";
import { listeningService } from "@/services/listeningService";
import { loadPosition, storePosition } from "./readingPosition";

const SAVE_POSITION_MS = 2000;
import { usePaneLayout, type PaneLayout } from "./hooks/usePaneLayout";
import { useViewPrefs } from "./hooks/usePageFit";
import { copyCanvas, renderPageToCanvas } from "./pageCapture";
import { AssistantProvider } from "./AssistantContext";

export type PdfDocument = Parameters<NonNullable<DocumentProps["onLoadSuccess"]>>[0];
export type FitMode = "width" | "page";

interface ReadingRoomValue {
  book: Book;
  pdfUrl: string | null;
  pdf: PdfDocument | null;
  numPages: number | null;
  onDocumentLoadSuccess: (pdf: PdfDocument) => void;
  onDocumentLoadError: (error: Error) => void;
  pageNumber: number;
  /** Stable. Jumps to a page with the same audio reset as previous/next. */
  goToPage: (page: number) => void;
  fitMode: FitMode;
  setFitMode: (mode: FitMode) => void;
  zoomScale: number;
  setZoomScale: (zoom: number) => void;
  /** The canvas pane's scroll container; the page fit is measured from it. */
  canvasRef: RefObject<HTMLDivElement>;
  pageRef: RefObject<HTMLDivElement>;
  /** The visible page's PDF canvas (current layer only). */
  pageCanvasRef: RefObject<HTMLCanvasElement>;
  prefetchPageRef: RefObject<HTMLDivElement>;
  prefetchPageNumber: number | null;
  roomRef: RefObject<HTMLDivElement>;
  panes: PaneLayout;
}

type PagePlayback = ReturnType<typeof usePageAudio> & { kind: "legacy" };
type SegmentPlayback = ReturnType<typeof useSegmentPlayback>;
/** Either player, plus the voice choice; `kind` tells the segment player's extras apart. */
type PlaybackValue = (PagePlayback | SegmentPlayback) &
  ReturnType<typeof useVoiceChoice> & { player: PlayerKind; processing: ProcessingStatus | null };

const ReadingRoomContext = createContext<ReadingRoomValue | undefined>(undefined);
const PlaybackContext = createContext<PlaybackValue | undefined>(undefined);

export const ReadingRoomProvider = ({ children }: { children: ReactNode }) => {
  const { currentBook } = useBooks();
  const navigate = useNavigate();

  const [pageNumber, setPageNumber] = useState(1);
  const [resumeSeq, setResumeSeq] = useState<number | null>(null);
  /** The page being restored for a newly opened book: not saved back until it is on screen. */
  const restoringPageRef = useRef<number | null>(null);
  const { fitMode, setFitMode, zoomScale, setZoomScale } = useViewPrefs(currentBook?.id);
  const [pdf, setPdf] = useState<PdfDocument | null>(null);

  const canvasRef = useRef<HTMLDivElement>(null);
  const pageRef = useRef<HTMLDivElement>(null);
  const pageCanvasRef = useRef<HTMLCanvasElement>(null);
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

  // Reopen a book where the reader left it
  const bookId = currentBook?.id;
  useEffect(() => {
    if (!bookId) return;
    const position = loadPosition(bookId, currentBook?.last_read_page);
    restoringPageRef.current = position.page;
    setPageNumber(position.page);
    setResumeSeq(position.seq);
    // last_read_page is read once per opened book, not on every library refresh
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookId]);

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

  // Text extraction gets the page drawn straight from pdf.js at a fixed width, not the on-screen
  // canvas: that one follows pane width and zoom, can be mid-redraw, and sits under a text layer.
  const capturePage = async (): Promise<HTMLCanvasElement | null> => {
    if (pdf) {
      try {
        const canvas = await renderPageToCanvas(pdf, pageNumber);
        if (canvas) return canvas;
      } catch (error) {
        console.warn("Capture: direct render failed for page", pageNumber, error);
      }
    }
    // Fallback: a copy of the visible PDF canvas (page pixels only, no text layer)
    return pageCanvasRef.current ? copyCanvas(pageCanvasRef.current) : null;
  };

  const { processing, player } = useBookProcessing(currentBook);

  // The page player stays mounted but does nothing until its play is pressed (Read-mode books)
  const pageAudio = usePageAudio({
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

  const segmentAudio = useSegmentPlayback({
    enabled: player === "segments",
    book: currentBook,
    pageNumber,
    setPageNumber,
    numPages,
    activePersonaId: voice.activePersonaId,
    processing,
    resumeSeq,
  });

  // A stored page past the end of the PDF (replaced file): the last page
  useEffect(() => {
    if (numPages && pageNumber > numPages) setPageNumber(numPages);
  }, [numPages, pageNumber]);

  // Remember the position: in this browser at once, on the server shortly after (and on leaving)
  const pendingSaveRef = useRef<{ bookId: string; page: number } | null>(null);
  const saveTimerRef = useRef(0);
  const flushSave = useCallback(() => {
    window.clearTimeout(saveTimerRef.current);
    const pending = pendingSaveRef.current;
    pendingSaveRef.current = null;
    if (pending) listeningService.saveReadingPosition(pending.bookId, pending.page).catch(() => {});
  }, []);
  const currentSeq = segmentAudio.currentSeq;
  const currentSeqRef = useRef(currentSeq);
  currentSeqRef.current = currentSeq;

  useEffect(() => {
    if (!bookId) return;
    if (restoringPageRef.current !== null) {
      // The restored page is not on screen yet, or just arrived: nothing new to save
      if (pageNumber === restoringPageRef.current) restoringPageRef.current = null;
      return;
    }
    storePosition(bookId, { page: pageNumber, seq: currentSeqRef.current });
    pendingSaveRef.current = { bookId, page: pageNumber };
    window.clearTimeout(saveTimerRef.current);
    saveTimerRef.current = window.setTimeout(flushSave, SAVE_POSITION_MS);
  }, [bookId, pageNumber, flushSave]);

  // The paragraph being listened to, so play resumes there next time
  useEffect(() => {
    if (!bookId || currentSeq === null || restoringPageRef.current !== null) return;
    storePosition(bookId, { page: pageNumber, seq: currentSeq });
    setResumeSeq(currentSeq);
    // Saved with the page it is on; page changes save themselves
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookId, currentSeq]);

  // Leaving the room or switching books sends the last page at once
  useEffect(() => flushSave, [bookId, flushSave]);

  // Until the first status answer the (inert) segment player is shown, so play cannot start the
  // page player's OCR path on a Listen-mode book
  const audio: PagePlayback | SegmentPlayback = player === "legacy" ? { ...pageAudio, kind: "legacy" } : segmentAudio;

  const { prefetchPageRef } = pageAudio;
  const prefetchPageNumber = player === "legacy" ? pageAudio.prefetchPageNumber : null;

  // Stable wrapper so page-jump callers (the counter, later the rail) don't re-render with playback
  const goToPageRef = useRef(audio.goToPage);
  goToPageRef.current = audio.goToPage;
  const goToPage = useCallback((page: number) => goToPageRef.current(page), []);

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
            goToPage,
            fitMode,
            setFitMode,
            zoomScale,
            setZoomScale,
            canvasRef,
            pageRef,
            pageCanvasRef,
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
      goToPage,
      fitMode,
      setFitMode,
      zoomScale,
      setZoomScale,
      prefetchPageRef,
      prefetchPageNumber,
      panes,
    ]
  );

  // Playback changes several times a second while audio plays; only the now-playing bar reads it.
  const playback: PlaybackValue = { ...audio, ...voice, player, processing };

  // Don't render anything if no book (useEffect above will handle redirect)
  if (!room) {
    return null;
  }

  return (
    <ReadingRoomContext.Provider value={room}>
      <AssistantProvider book={currentBook}>
        <PlaybackContext.Provider value={playback}>{children}</PlaybackContext.Provider>
      </AssistantProvider>
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
