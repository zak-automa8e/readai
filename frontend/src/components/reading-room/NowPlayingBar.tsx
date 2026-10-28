import { useEffect, useRef, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Loader2,
  Maximize,
  Maximize2,
  Minimize,
  Minimize2,
  Pause,
  Play,
  Repeat,
  RotateCcw,
  SkipBack,
  SkipForward,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { Button } from "../ui/button";
import { Slider } from "../ui/slider";
import { VoiceSelect } from "./VoiceSelect";
import { usePlayback, useReadingRoom } from "./ReadingRoomContext";
import { ZOOM_MAX, ZOOM_MIN, ZOOM_STEP } from "./hooks/usePageFit";

// Helper function to format time in HH:MM:SS
const formatTime = (seconds: number): string => {
  if (!isFinite(seconds) || seconds < 0) return "00:00:00";
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  return `${String(hrs).padStart(2, "0")}:${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
};

const Divider = () => <div className="h-6 w-px shrink-0 bg-border" aria-hidden="true" />;

const useIsFullscreen = () => {
  const [isFullscreen, setIsFullscreen] = useState(() => Boolean(document.fullscreenElement));
  useEffect(() => {
    const onChange = () => setIsFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);
  return isFullscreen;
};

/** "n / N"; click the current page to type a page number (Enter or blur jumps, Esc cancels). */
const PageJump = ({
  pageNumber,
  numPages,
  onJump,
}: {
  pageNumber: number;
  numPages: number | null;
  onJump: (page: number) => void;
}) => {
  const [draft, setDraft] = useState<string | null>(null);
  // Esc unmounts the input; a blur fired by that removal must not jump
  const cancelledRef = useRef(false);

  const commit = () => {
    const target = Number(draft);
    setDraft(null);
    if (cancelledRef.current) return;
    if (draft && Number.isFinite(target)) onJump(target);
  };

  const startEditing = () => {
    cancelledRef.current = false;
    setDraft(String(pageNumber));
  };

  return (
    <span className="flex items-center gap-1" dir="ltr">
      {draft === null ? (
        <button
          type="button"
          className="rounded-sm px-1 text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:text-muted-foreground"
          onClick={startEditing}
          disabled={!numPages}
          title="Go to page"
          aria-label={`Page ${pageNumber}. Go to page`}
        >
          {pageNumber}
        </button>
      ) : (
        <input
          type="text"
          inputMode="numeric"
          autoFocus
          value={draft}
          onChange={(event) => setDraft(event.target.value.replace(/\D/g, ""))}
          onFocus={(event) => event.target.select()}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === "Enter") event.currentTarget.blur();
            if (event.key === "Escape") {
              cancelledRef.current = true;
              setDraft(null);
            }
          }}
          className="h-7 w-12 rounded-sm border border-input bg-background px-1 text-center font-serif text-sm tabular-nums text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          aria-label={`Go to page, 1 to ${numPages}`}
        />
      )}
      / {numPages || "?"}
    </span>
  );
};

/**
 * Full-width bar under all three panes. Listening is the primary mode, so playback stays here at a
 * fixed height regardless of pane sizes or collapse state. `compact` (mobile) wraps onto rows, puts
 * the seek bar first and drops the view controls (the page is fixed to fit-width there).
 */
export const NowPlayingBar = ({ compact = false }: { compact?: boolean }) => {
  const { pageNumber, numPages, goToPage, fitMode, setFitMode, zoomScale, setZoomScale, roomRef } = useReadingRoom();
  const playback = usePlayback();
  // The segment player steps by paragraph and has no auto-play or redo-page
  const segmentPlayer = playback.kind === "segments" ? playback : null;
  const {
    isPlaying,
    isReading,
    isLoadingPersonas,
    audioDuration,
    audioCurrentTime,
    audioRef,
    autoPlayEnabled,
    setAutoPlayEnabled,
    isPrefetching,
    handleReadPage,
    handlePrevPage,
    handleNextPage,
    redoPage,
    handleSeek,
  } = playback;
  const preparingLabel = segmentPlayer?.status === "waiting-text" ? "Waiting for this page's text" : "Preparing the audio";
  const isFullscreen = useIsFullscreen();

  const toggleFullscreen = () => {
    if (document.fullscreenElement) {
      void document.exitFullscreen();
    } else {
      void roomRef.current?.requestFullscreen();
    }
  };

  return (
    <footer
      className={
        compact
          ? "flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2 overflow-hidden border-t border-border bg-card px-3 py-2"
          : "flex h-14 min-w-0 items-center gap-3 overflow-hidden border-t border-border bg-card px-4"
      }
      aria-label="Now playing"
    >
      {/* Page navigation */}
      <div className="flex shrink-0 items-center gap-1">
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          onClick={() => handlePrevPage()}
          disabled={pageNumber <= 1}
          aria-label="Previous page"
        >
          <ChevronLeft className="h-4 w-4 rtl:rotate-180" />
        </Button>
        <span className="flex min-w-16 items-center justify-center gap-1 font-serif text-sm tabular-nums text-muted-foreground">
          <PageJump pageNumber={pageNumber} numPages={numPages} onJump={goToPage} />
          {isPrefetching && (
            <span
              className="h-1.5 w-1.5 animate-pulse rounded-full bg-primary"
              title={segmentPlayer ? "Preparing the next paragraph" : "Preparing next page"}
              aria-label={segmentPlayer ? "Preparing the next paragraph" : "Preparing next page"}
            />
          )}
        </span>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          onClick={() => handleNextPage(false)}
          disabled={!numPages || pageNumber >= numPages}
          aria-label="Next page"
        >
          <ChevronRight className="h-4 w-4 rtl:rotate-180" />
        </Button>
      </div>

      {!compact && <Divider />}

      {/* Playback */}
      <div className="flex shrink-0 items-center gap-1">
        {segmentPlayer && (
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={() => segmentPlayer.skipParagraph(-1)}
            disabled={segmentPlayer.currentSeq === null || isReading}
            aria-label="Previous paragraph"
            title="Previous paragraph"
          >
            <SkipBack className="h-4 w-4 rtl:rotate-180" />
          </Button>
        )}
        <Button
          variant="ghost"
          size="icon"
          className="h-9 w-9"
          onClick={() => handleReadPage(false)}
          disabled={isReading || isLoadingPersonas || playback.player === "pending"}
          aria-label={isReading ? preparingLabel : isPlaying ? "Pause" : "Play"}
          title={isReading ? preparingLabel : undefined}
        >
          {isReading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : isPlaying ? (
            <Pause className="h-4 w-4" />
          ) : (
            <Play className="h-4 w-4" />
          )}
        </Button>
        {segmentPlayer ? (
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={() => segmentPlayer.skipParagraph(1)}
            disabled={segmentPlayer.currentSeq === null || isReading}
            aria-label="Next paragraph"
            title="Next paragraph"
          >
            <SkipForward className="h-4 w-4 rtl:rotate-180" />
          </Button>
        ) : (
          <>
            <Button
              variant="ghost"
              size="icon"
              className={`h-8 w-8 ${autoPlayEnabled ? "bg-muted text-primary" : ""}`}
              onClick={() => setAutoPlayEnabled(!autoPlayEnabled)}
              aria-pressed={autoPlayEnabled}
              title={autoPlayEnabled ? "Disable auto-play" : "Enable auto-play"}
            >
              <Repeat className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={redoPage}
              disabled={isReading || isLoadingPersonas}
              aria-label="Redo this page"
              title="Redo this page: extract the text and generate the audio again"
            >
              <RotateCcw className="h-4 w-4" />
            </Button>
          </>
        )}
        {segmentPlayer?.status === "limit" && (
          <span className="ms-1 whitespace-nowrap text-xs text-destructive" role="status">
            Daily limit reached
          </span>
        )}
        <div className="ms-1">
          <VoiceSelect />
        </div>
      </div>

      {!compact && <Divider />}

      {/* Seek */}
      <div className={compact ? "order-first flex w-full min-w-0 items-center gap-3" : "flex min-w-0 flex-1 items-center gap-3"}>
        <Slider
          value={[audioDuration > 0 ? (audioCurrentTime / audioDuration) * 100 : 0]}
          max={100}
          step={0.1}
          onValueChange={(value) => handleSeek(value[0])}
          className="min-w-16 flex-1"
          disabled={!audioRef.current || audioDuration === 0}
          aria-label="Seek"
        />
        <span dir="ltr" className="shrink-0 whitespace-nowrap font-mono text-xs text-muted-foreground">
          {formatTime(audioCurrentTime)} / {formatTime(audioDuration)}
        </span>
      </div>

      {!compact && <Divider />}

      {/* View */}
      <div className={compact ? "hidden" : "flex shrink-0 items-center gap-2"}>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          onClick={() => setFitMode(fitMode === "width" ? "page" : "width")}
          title={fitMode === "width" ? "Fit page to window" : "Fit width only"}
        >
          {fitMode === "width" ? <Maximize2 className="h-4 w-4" /> : <Minimize2 className="h-4 w-4" />}
        </Button>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={() => setZoomScale(zoomScale - ZOOM_STEP)}
            disabled={zoomScale <= ZOOM_MIN}
            aria-label="Zoom out"
            title="Zoom out"
          >
            <ZoomOut className="h-4 w-4" />
          </Button>
          <Slider
            value={[zoomScale]}
            min={ZOOM_MIN}
            max={ZOOM_MAX}
            step={ZOOM_STEP}
            onValueChange={(value) => setZoomScale(value[0])}
            className="w-20"
            aria-label="Zoom"
          />
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={() => setZoomScale(zoomScale + ZOOM_STEP)}
            disabled={zoomScale >= ZOOM_MAX}
            aria-label="Zoom in"
            title="Zoom in"
          >
            <ZoomIn className="h-4 w-4" />
          </Button>
        </div>
        <span dir="ltr" className="w-10 text-end font-mono text-xs text-muted-foreground">{zoomScale}%</span>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          onClick={toggleFullscreen}
          aria-label={isFullscreen ? "Exit full screen" : "Full screen"}
          title={isFullscreen ? "Exit full screen" : "Full screen"}
        >
          {isFullscreen ? <Minimize className="h-4 w-4" /> : <Maximize className="h-4 w-4" />}
        </Button>
      </div>
    </footer>
  );
};
