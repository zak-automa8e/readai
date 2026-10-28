import { useEffect, useState } from "react";
import { Volume1, Volume2, VolumeX } from "lucide-react";
import { Button } from "../ui/button";
import { Slider } from "../ui/slider";
import { usePlayback } from "./ReadingRoomContext";

const STORAGE_KEY = "readai:volume";

interface VolumeState {
  volume: number;
  muted: boolean;
}

const clamp = (value: number) => Math.min(Math.max(value, 0), 1);

const readVolume = (): VolumeState => {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
    if (stored && typeof stored.volume === "number") return { volume: clamp(stored.volume), muted: Boolean(stored.muted) };
  } catch {
    // Unreadable: full volume
  }
  return { volume: 1, muted: false };
};

/**
 * Speaker button (mute) and volume slider, remembered between visits. Applies to whichever audio
 * element is playing: the page player swaps elements between pages, so it is re-applied as
 * playback moves. `compact` (mobile) keeps the button only; phones have volume keys.
 */
export const VolumeControl = ({ compact = false }: { compact?: boolean }) => {
  const { audioRef, isPlaying, audioCurrentTime } = usePlayback();
  const [state, setState] = useState<VolumeState>(readVolume);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      // Not remembered this time
    }
  }, [state]);

  const element = audioRef.current;
  useEffect(() => {
    if (!element) return;
    element.volume = state.volume;
    element.muted = state.muted;
  }, [element, state, isPlaying, audioCurrentTime]);

  const silent = state.muted || state.volume === 0;
  const Icon = silent ? VolumeX : state.volume < 0.5 ? Volume1 : Volume2;

  const toggleMute = () =>
    setState((current) =>
      // Unmuting from zero gives the slider something to hear
      current.muted || current.volume === 0 ? { volume: current.volume || 0.5, muted: false } : { ...current, muted: true }
    );

  return (
    <div className="flex shrink-0 items-center gap-1">
      <Button
        variant="ghost"
        size="icon"
        className="h-8 w-8"
        onClick={toggleMute}
        aria-label={silent ? "Unmute" : "Mute"}
        title={silent ? "Unmute" : "Mute"}
      >
        <Icon className="h-4 w-4 rtl:-scale-x-100" />
      </Button>
      {!compact && (
        <Slider
          value={[silent ? 0 : Math.round(state.volume * 100)]}
          max={100}
          step={1}
          onValueChange={(value) => setState({ volume: clamp(value[0] / 100), muted: false })}
          className="w-20"
          aria-label="Volume"
        />
      )}
    </div>
  );
};
