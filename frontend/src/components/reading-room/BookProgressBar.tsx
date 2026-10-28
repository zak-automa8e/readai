import { useRef, useState, type KeyboardEvent, type MouseEvent } from "react";

/** Seconds of speech per character of text (bake-off F4: 99.9 s per 1 000 characters). */
const SECONDS_PER_CHAR = 0.0999;
/** Arrow keys move about a minute of listening. */
const KEY_STEP_CHARS = 600;

export const formatTime = (seconds: number): string => {
  if (!isFinite(seconds) || seconds < 0) return "00:00:00";
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  return `${String(hrs).padStart(2, "0")}:${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
};

interface BookProgress {
  playedChars: number;
  readyChars: number;
  totalChars: number;
  complete: boolean;
}

/**
 * One bar for the whole book, like a video's: the played part in the brand colour, the audio
 * already prepared ahead of it lighter, the rest the track. Positions are characters of text
 * (most of the book's audio does not exist yet), so the times are estimates. Click or use the
 * arrow keys to move; playback continues from the paragraph there.
 */
export const BookProgressBar = ({ progress, onSeek }: { progress: BookProgress; onSeek: (fraction: number) => void }) => {
  const barRef = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  const { playedChars, readyChars, totalChars, complete } = progress;

  const percent = (chars: number) => Math.min(Math.max(chars / totalChars, 0), 1) * 100;
  const isRtl = () => (barRef.current ? getComputedStyle(barRef.current).direction === "rtl" : false);

  const fractionAt = (event: MouseEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const fraction = (event.clientX - rect.left) / rect.width;
    return Math.min(Math.max(isRtl() ? 1 - fraction : fraction, 0), 1);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const forward = isRtl() ? "ArrowLeft" : "ArrowRight";
    const back = isRtl() ? "ArrowRight" : "ArrowLeft";
    if (event.key !== forward && event.key !== back) return;
    event.preventDefault();
    const step = event.key === forward ? KEY_STEP_CHARS : -KEY_STEP_CHARS;
    onSeek(Math.min(Math.max((playedChars + step) / totalChars, 0), 1));
  };

  const elapsed = playedChars * SECONDS_PER_CHAR;
  const total = totalChars * SECONDS_PER_CHAR;
  const estimate = complete ? "" : " (still being prepared)";

  return (
    <>
      <div
        ref={barRef}
        role="slider"
        tabIndex={0}
        aria-label="Position in the book"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(percent(playedChars))}
        aria-valuetext={`About ${formatTime(elapsed)} of ${formatTime(total)}`}
        className="group relative h-5 min-w-16 flex-1 cursor-pointer rounded-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        onClick={(event) => onSeek(fractionAt(event))}
        onMouseMove={(event) => setHover(fractionAt(event))}
        onMouseLeave={() => setHover(null)}
        onKeyDown={onKeyDown}
      >
        <div className="absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 overflow-hidden rounded-full bg-border transition-[height] group-hover:h-1.5">
          <div className="absolute inset-y-0 start-0 bg-muted-foreground/35" style={{ width: `${percent(readyChars)}%` }} />
          <div className="absolute inset-y-0 start-0 bg-primary" style={{ width: `${percent(playedChars)}%` }} />
        </div>
        <div
          className="absolute top-1/2 h-3 w-3 -translate-y-1/2 rounded-full bg-primary ring-2 ring-card opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
          style={{ insetInlineStart: `calc(${percent(playedChars)}% - 6px)` }}
          aria-hidden="true"
        />
        {hover !== null && (
          <div
            dir="ltr"
            className="pointer-events-none absolute bottom-full mb-1 -translate-x-1/2 whitespace-nowrap rounded-sm border border-border bg-popover px-1.5 py-0.5 font-mono text-[11px] text-popover-foreground"
            style={{ left: `${(isRtl() ? 1 - hover : hover) * 100}%` }}
          >
            ≈ {formatTime(hover * total)}
          </div>
        )}
      </div>
      <span
        dir="ltr"
        className="shrink-0 whitespace-nowrap font-mono text-xs text-muted-foreground"
        title={`Estimated from the length of the text${estimate}`}
      >
        ≈ {formatTime(elapsed)} / {formatTime(total)}
      </span>
    </>
  );
};
