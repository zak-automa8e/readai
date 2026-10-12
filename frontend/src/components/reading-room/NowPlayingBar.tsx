import { useEffect, useState } from "react";
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
} from "lucide-react";
import { Button } from "../ui/button";
import { Slider } from "../ui/slider";
import { VoiceSelect } from "./VoiceSelect";
import { usePlayback, useReadingRoom } from "./ReadingRoomContext";

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

/**
 * Full-width bar under all three panes. Listening is the primary mode, so playback stays here at a
 * fixed height regardless of pane sizes or collapse state.
 */
export const NowPlayingBar = () => {
  const { pageNumber, numPages, fitMode, setFitMode, zoomScale, setZoomScale, roomRef } = useReadingRoom();
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
    handleSeek,
  } = usePlayback();
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
      className="flex h-14 min-w-0 items-center gap-3 overflow-hidden border-t border-border bg-card px-4"
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
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <span className="flex min-w-16 items-center justify-center gap-1 font-serif text-sm tabular-nums text-muted-foreground">
          {pageNumber} / {numPages || "?"}
          {isPrefetching && (
            <span
              className="h-1.5 w-1.5 animate-pulse rounded-full bg-primary"
              title="Preparing next page"
              aria-label="Preparing next page"
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
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>

      <Divider />

      {/* Playback */}
      <div className="flex shrink-0 items-center gap-1">
        <Button
          variant="ghost"
          size="icon"
          className="h-9 w-9"
          onClick={() => handleReadPage(false)}
          disabled={isReading || isLoadingPersonas}
          aria-label={isPlaying ? "Pause" : "Play"}
        >
          {isReading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : isPlaying ? (
            <Pause className="h-4 w-4" />
          ) : (
            <Play className="h-4 w-4" />
          )}
        </Button>
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
        <div className="ms-1">
          <VoiceSelect />
        </div>
      </div>

      <Divider />

      {/* Seek */}
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <Slider
          value={[audioDuration > 0 ? (audioCurrentTime / audioDuration) * 100 : 0]}
          max={100}
          step={0.1}
          onValueChange={(value) => handleSeek(value[0])}
          className="min-w-16 flex-1"
          disabled={!audioRef.current || audioDuration === 0}
          aria-label="Seek"
        />
        <span className="shrink-0 whitespace-nowrap font-mono text-xs text-muted-foreground">
          {formatTime(audioCurrentTime)} / {formatTime(audioDuration)}
        </span>
      </div>

      <Divider />

      {/* View */}
      <div className="flex shrink-0 items-center gap-2">
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          onClick={() => setFitMode(fitMode === "width" ? "page" : "width")}
          title={fitMode === "width" ? "Fit page to window" : "Fit width only"}
        >
          {fitMode === "width" ? <Maximize2 className="h-4 w-4" /> : <Minimize2 className="h-4 w-4" />}
        </Button>
        <Slider
          value={[zoomScale]}
          min={50}
          max={150}
          step={5}
          onValueChange={(value) => setZoomScale(value[0])}
          className="w-20"
          aria-label="Zoom"
        />
        <span className="w-10 text-end font-mono text-xs text-muted-foreground">{zoomScale}%</span>
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
