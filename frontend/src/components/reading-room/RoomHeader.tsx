import { ArrowLeft, Moon, Sun } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useTheme } from "next-themes";
import { Button } from "../ui/button";
import { useReadingRoom } from "./ReadingRoomContext";

export const RoomHeader = () => {
  const navigate = useNavigate();
  const { book } = useReadingRoom();
  const { resolvedTheme, setTheme } = useTheme();
  const isDark = resolvedTheme === "dark";

  return (
    <header className="flex h-11 min-w-0 items-center gap-3 border-b border-border bg-card px-2">
      <Button
        variant="ghost"
        size="sm"
        className="h-8 shrink-0 gap-2 px-2 text-muted-foreground"
        onClick={() => navigate("/library")}
      >
        <ArrowLeft className="h-4 w-4 rtl:rotate-180" />
        Library
      </Button>
      <div className="h-5 w-px shrink-0 bg-border" aria-hidden="true" />
      <div className="flex min-w-0 flex-1 items-baseline gap-2">
        <h1 className="truncate font-serif text-base font-medium leading-none">{book.title}</h1>
        {book.author && <span className="truncate text-sm text-muted-foreground">{book.author}</span>}
      </div>
      <Button
        variant="ghost"
        size="icon"
        className="h-8 w-8 shrink-0"
        onClick={() => setTheme(isDark ? "light" : "dark")}
        aria-label={isDark ? "Switch to light theme" : "Switch to dark theme"}
        title={isDark ? "Light theme" : "Dark theme"}
      >
        {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
      </Button>
    </header>
  );
};
