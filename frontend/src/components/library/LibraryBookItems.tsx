import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Trash2, Pencil, FileText, Share2, Headphones } from "lucide-react";
import type { Book } from "@/contexts/BooksContext";
import { toast } from "@/hooks/use-toast";

/** Listen-mode books carry a headphones mark (spec O1). */
const ListenMark = ({ book }: { book: Book }) =>
  book.mode === "listen" ? (
    <Headphones className="h-3.5 w-3.5 shrink-0 text-primary" aria-label="Listen mode" role="img" />
  ) : null;

interface BookItemProps {
  book: Book;
  onOpen: () => void;
  onEdit: () => void;
  onDelete: () => void;
}

/** One book in the library's grid view. */
export const BookGridCard = ({ book, loading, onOpen, onEdit, onDelete }: BookItemProps & { loading: boolean }) => (
  <Card
    className="shadow-none p-4 flex flex-col relative cursor-pointer transition-colors hover:border-primary/40 group"
    onClick={onOpen}
  >
    <div className="aspect-[3/4] bg-muted mb-4 rounded-sm overflow-hidden">
      {(() => {
        const coverSrc = book.thumbnail_url || book.coverUrl || book.defaultCover;
        return coverSrc ? (
          <img
            src={coverSrc}
            alt={book.title}
            className="w-full h-full object-cover"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-muted-foreground text-sm">No Cover</div>
        );
      })()}
    </div>

    <div className="flex-1">
      <h3 className="font-serif font-medium mb-1 line-clamp-2 text-base leading-tight">{book.title}</h3>
      {book.author && (
        <p className="text-xs text-muted-foreground mb-2 line-clamp-1">{book.author}</p>
      )}
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <ListenMark book={book} />
        Added {new Date(book.uploadDate).toLocaleDateString()}
      </p>
    </div>

    <div className="absolute bottom-2 end-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
      <Button
        variant="ghost"
        size="icon"
        className="h-8 w-8"
        onClick={(e) => {
          e.stopPropagation();
          toast({
            title: "Coming soon",
            description: "Share functionality will be available soon",
          });
        }}
        disabled={loading}
      >
        <Share2 className="h-4 w-4" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className="h-8 w-8"
        onClick={(e) => {
          e.stopPropagation();
          onEdit();
        }}
        disabled={loading}
      >
        <Pencil className="h-4 w-4" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className="h-8 w-8"
        onClick={(e) => {
          e.stopPropagation();
          onDelete();
        }}
        disabled={loading}
      >
        <Trash2 className="h-4 w-4" />
      </Button>
    </div>
  </Card>
);

/** One book in the library's list view. */
export const BookListRow = ({ book, onOpen, onEdit, onDelete }: BookItemProps) => (
  <Card
    className="shadow-none p-4 hover:bg-accent/50 transition-colors cursor-pointer"
    onClick={onOpen}
  >
    <div className="flex items-center gap-4">
      <div className="flex-shrink-0">
        <div className="w-12 h-16 bg-muted rounded-sm flex items-center justify-center">
          {(book.coverUrl || book.defaultCover || book.thumbnail_url) ? (
            <img
              src={book.thumbnail_url || book.coverUrl || book.defaultCover}
              alt={book.title}
              className="w-full h-full object-cover rounded-sm"
            />
          ) : (
            <FileText className="w-6 h-6 text-muted-foreground" />
          )}
        </div>
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between">
          <div className="flex-1 min-w-0">
            <h3 className="font-serif font-medium text-foreground line-clamp-2 text-base leading-tight">
              {book.title}
            </h3>
            {book.author && (
              <p className="text-xs text-muted-foreground line-clamp-1">
                by {book.author}
              </p>
            )}
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <ListenMark book={book} />
              Added {new Date(book.uploadDate).toLocaleDateString()}
            </p>
          </div>

          <div className="flex items-center gap-2 ms-4">
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={(e) => {
                e.stopPropagation();
                onEdit();
              }}
            >
              <Pencil className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={(e) => {
                e.stopPropagation();
                onDelete();
              }}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  </Card>
);
