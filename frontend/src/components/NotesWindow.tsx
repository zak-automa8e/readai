  import { Card } from "./ui/card";
import { ScrollArea } from "./ui/scroll-area";
import { Button } from "./ui/button";
import { List, Plus } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";
import { Textarea } from "./ui/textarea";
import { useState } from "react";

interface Note {
  id: string;
  content: string;
  timestamp: Date;
}

export const NotesWindow = () => {
  const [notes, setNotes] = useState<Note[]>([]);
  const [isPopoverOpen, setIsPopoverOpen] = useState(false);
  const [newNoteContent, setNewNoteContent] = useState("");

  const handleAddNote = () => {
    if (newNoteContent.trim()) {
      const newNote: Note = {
        id: crypto.randomUUID(),
        content: newNoteContent.trim(),
        timestamp: new Date(),
      };
      setNotes(prev => [newNote, ...prev]); // Add new note at the beginning
      setNewNoteContent("");
      setIsPopoverOpen(false);
    }
  };
  return (
    <div className="flex-1 h-full flex flex-col gap-4">
      <ScrollArea className="flex-1 pr-4 min-h-0 max-h-[calc(100vh-200px)]">
        <div className="space-y-4">
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
                    <Button size="sm" onClick={handleAddNote}>
                      Save Note
                    </Button>
                  </div>
                </div>
              </PopoverContent>
            </Popover>
          </div>
          
          {notes.length === 0 ? (
            <Card className="p-3 lg:p-4 card-gradient">
              <p className="text-sm text-muted-foreground">
                No notes yet. Click the "Add Note" button to create your first note.
              </p>
            </Card>
          ) : (
            notes.map(note => (
              <Card key={note.id} className="p-3 lg:p-4 card-gradient">
                <p className="text-sm mb-2">{note.content}</p>
                <p className="text-xs text-muted-foreground">
                  {note.timestamp.toLocaleString()}
                </p>
              </Card>
            ))
          )}
        </div>
      </ScrollArea>

    </div>
  );
};
