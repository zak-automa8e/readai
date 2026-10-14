import { useEffect, useMemo } from "react";
import { useNotes, type BookNote } from "@/contexts/NotesContext";
import { useReadingRoom } from "./ReadingRoomContext";

const noteText = (note: BookNote) => note.title?.trim() || note.content.trim() || note.text_selection?.trim() || "";

/** Notes for this book in page order. Read-only: the assistant pane keeps the editor. */
export const RailNotes = () => {
  const { book, pageNumber, goToPage } = useReadingRoom();
  const { getNotesForBook, fetchNotes, isLoading, getError } = useNotes();

  useEffect(() => {
    fetchNotes(book.id).catch(() => {});
  }, [book.id, fetchNotes]);

  const allNotes = getNotesForBook(book.id);
  const notes = useMemo(
    () =>
      [...allNotes].sort((a, b) => {
        const pageA = a.page_number ?? Number.MAX_SAFE_INTEGER;
        const pageB = b.page_number ?? Number.MAX_SAFE_INTEGER;
        return pageA - pageB || a.created_at.localeCompare(b.created_at);
      }),
    [allNotes]
  );

  if (notes.length === 0) {
    if (isLoading(book.id)) return <p className="p-2 text-sm text-muted-foreground">Loading notes...</p>;
    const error = getError(book.id);
    return (
      <p className={`p-2 text-sm ${error ? "text-destructive" : "text-muted-foreground"}`}>
        {error ?? "No notes yet."}
      </p>
    );
  }

  return (
    <ul aria-label="Notes by page" className="flex flex-col gap-1">
      {notes.map(note => {
        const page = note.page_number ?? null;
        const body = (
          <>
            <span className="block font-serif text-xs tabular-nums text-muted-foreground">
              {page ? `Page ${page}` : "No page"}
            </span>
            <span dir="auto" className="line-clamp-3 block break-words text-start text-sm">
              {noteText(note)}
            </span>
          </>
        );
        return (
          <li key={note.id}>
            {page ? (
              <button
                type="button"
                onClick={() => goToPage(page)}
                aria-current={page === pageNumber ? "page" : undefined}
                className={`w-full rounded-sm border border-border px-3 py-2 text-start hover:bg-muted ${
                  page === pageNumber ? "bg-muted" : ""
                }`}
              >
                {body}
              </button>
            ) : (
              <div className="rounded-sm border border-border px-3 py-2">{body}</div>
            )}
          </li>
        );
      })}
    </ul>
  );
};
