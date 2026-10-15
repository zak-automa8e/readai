  import { ScrollArea } from "./ui/scroll-area";
  import { Button } from "./ui/button";
  import { List, Plus, Trash2 } from "lucide-react";
  import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";
  import { Textarea } from "./ui/textarea";
  import { useEffect, useMemo, useState } from "react";
  import { useBooks } from "../contexts/BooksContext";
  import { useNotes } from "../contexts/NotesContext";
  import ReactMarkdown from 'react-markdown';
  import remarkGfm from 'remark-gfm';

  const card = "rounded-md border border-border bg-card p-3";

  export const NotesWindow = () => {
    const { currentBook } = useBooks();
    const { getNotesForBook, fetchNotes, createNote, deleteNote, isLoading, getError } = useNotes();
    const [isPopoverOpen, setIsPopoverOpen] = useState(false);
    const [newNoteContent, setNewNoteContent] = useState("");
    const [isSubmitting, setIsSubmitting] = useState(false);

    const activeBookId = currentBook?.id ?? "";

    useEffect(() => {
      if (!activeBookId) {
        return;
      }
      fetchNotes(activeBookId).catch(() => {});
    }, [activeBookId, fetchNotes]);

    const notes = useMemo(() => (activeBookId ? getNotesForBook(activeBookId) : []), [activeBookId, getNotesForBook]);
    const loading = activeBookId ? isLoading(activeBookId) : false;
    const error = activeBookId ? getError(activeBookId) : null;

    const handleAddNote = async () => {
      if (!activeBookId || !newNoteContent.trim() || isSubmitting) {
        return;
      }

      setIsSubmitting(true);
      const created = await createNote(activeBookId, { content: newNoteContent.trim() });
      setIsSubmitting(false);

      if (created) {
        setNewNoteContent("");
        setIsPopoverOpen(false);
      }
    };

    const handleDeleteNote = async (noteId: string) => {
      if (!activeBookId) return;
      await deleteNote(activeBookId, noteId);
    };

    if (!currentBook) {
      return (
        <div className="flex-1 h-full flex items-center justify-center text-muted-foreground">
          Select a book to start adding notes.
        </div>
      );
    }
  return (
    <div className="flex-1 h-full flex flex-col gap-4">
      <ScrollArea className="flex-1 pe-4 min-h-0 max-h-[calc(100vh-200px)]">
        <div className="space-y-3">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2 text-muted-foreground">
              <List className="h-4 w-4" />
              <span>Your Notes</span>
            </div>
            <Popover open={isPopoverOpen} onOpenChange={setIsPopoverOpen}>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  className="flex items-center gap-2"
                >
                  <Plus className="h-4 w-4" />
                  Add Note
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-80" align="end">
                <div className="space-y-4">
                  <h3 className="font-medium">Add New Note</h3>
                  <Textarea
                    placeholder="Type your note here..."
                    value={newNoteContent}
                    onChange={(e) => setNewNoteContent(e.target.value)}
                    dir="auto"
                    className="min-h-[100px]"
                  />
                  <div className="flex justify-end gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setNewNoteContent("");
                        setIsPopoverOpen(false);
                      }}
                    >
                      Cancel
                    </Button>
                    <Button size="sm" onClick={handleAddNote} disabled={isSubmitting || !newNoteContent.trim()}>
                      Save Note
                    </Button>
                  </div>
                </div>
              </PopoverContent>
            </Popover>
          </div>

          {loading && (
            <div className={card}>
              <p className="text-sm text-muted-foreground">Loading your notes...</p>
            </div>
          )}

          {!loading && error && (
            <div className={`${card} border-destructive/40`}>
              <p className="text-sm text-destructive">{error}</p>
            </div>
          )}

          {!loading && !error && notes.length === 0 ? (
            <div className={card}>
              <p className="text-sm text-muted-foreground">
                No notes yet. Click the "Add Note" button to create your first note.
              </p>
            </div>
          ) : (
            notes.map(note => {
              const createdAt = note.created_at ? new Date(note.created_at) : null;
              const selection = note.text_selection?.trim();
              return (
                <div key={note.id} className={card}>
                  <div className="flex justify-between items-start gap-4">
                    <div className="min-w-0 flex-1">
                      {note.title && (
                        <p dir="auto" className="text-start text-sm font-semibold mb-1">{note.title}</p>
                      )}
                      {selection && selection !== note.content.trim() && (
                        <blockquote dir="auto" className="mb-2 rounded-sm bg-muted px-2 py-1 text-start font-serif text-sm text-muted-foreground">
                          {selection}
                        </blockquote>
                      )}
                      <div dir="auto" className="text-start text-sm text-foreground prose prose-sm dark:prose-invert max-w-none break-words prose-p:my-2 prose-ul:my-2 prose-ol:my-2 prose-li:my-1">
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>
                          {note.content}
                        </ReactMarkdown>
                      </div>
                      <div className="mt-2 text-xs text-muted-foreground space-x-2 rtl:space-x-reverse">
                        {createdAt && <span>{createdAt.toLocaleString()}</span>}
                        {note.page_number !== null && note.page_number !== undefined && (
                          <span className="font-serif">Page {note.page_number}</span>
                        )}
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-muted-foreground"
                      onClick={() => handleDeleteNote(note.id)}
                    >
                      <Trash2 className="h-4 w-4" />
                      <span className="sr-only">Delete note</span>
                    </Button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </ScrollArea>

    </div>
  );
};
