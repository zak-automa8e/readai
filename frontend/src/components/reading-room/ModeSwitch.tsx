import { useState } from "react";
import { BookOpen, Headphones } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "../ui/alert-dialog";
import { toast } from "@/hooks/use-toast";
import type { BookMode } from "@/types/segments";
import { useReadingRoom } from "./ReadingRoomContext";

const OPTIONS: { value: BookMode; label: string; Icon: typeof BookOpen }[] = [
  { value: "read", label: "Read", Icon: BookOpen },
  { value: "listen", label: "Listen", Icon: Headphones },
];

/**
 * Read | Listen for this reader (spec O1, O14). Listen asks first, since it starts preparing the
 * book's text; Read switches at once and keeps the audio made so far.
 */
export const ModeSwitch = () => {
  const { mode, switchMode } = useReadingRoom();
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState(false);

  const apply = async (next: BookMode) => {
    setSaving(true);
    try {
      await switchMode(next);
      if (next === "read") {
        toast({ title: "Switched to Read", description: "The audio made so far is kept for when you listen again." });
      }
    } catch (error) {
      console.warn("Mode switch failed", error);
      toast({ title: "Could not switch the mode", description: "Try again in a moment.", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const choose = (next: BookMode) => {
    if (next === mode || saving) return;
    if (next === "listen") setConfirming(true);
    else void apply(next);
  };

  return (
    <>
      <div role="radiogroup" aria-label="Book mode" className="flex shrink-0 items-center gap-0.5 rounded-md bg-muted p-0.5">
        {OPTIONS.map(({ value, label, Icon }) => (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={mode === value}
            disabled={saving}
            onClick={() => choose(value)}
            title={value === "read" ? "Read: the PDF page, chat and notes" : "Listen: read aloud paragraph by paragraph"}
            className={`flex h-7 items-center gap-1.5 rounded-sm px-2 text-xs transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-60 ${
              mode === value ? "bg-card text-foreground ring-1 ring-border" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <Icon className="h-3.5 w-3.5" aria-hidden="true" />
            <span className="hidden sm:inline">{label}</span>
          </button>
        ))}
      </div>

      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Listen to this book?</AlertDialogTitle>
            <AlertDialogDescription>
              The book's text is prepared first. The first pages take a few minutes and the rest follows while you
              listen; you can keep reading meanwhile. Each page you listen to counts toward your daily pages.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => void apply("listen")}>Listen</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};
