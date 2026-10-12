import { useBooks } from "@/contexts/BooksContext";
import { ReadingRoomProvider } from "@/components/reading-room/ReadingRoomContext";
import { ReadingRoom } from "@/components/reading-room/ReadingRoom";

export default function Index() {
  const { currentBook } = useBooks();

  // Keyed by book so page, playback and pane state never carry over from another book.
  return (
    <ReadingRoomProvider key={currentBook?.id ?? "none"}>
      <ReadingRoom />
    </ReadingRoomProvider>
  );
}
