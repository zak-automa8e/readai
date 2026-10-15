import { useUI } from "../contexts/UIContext";
import { useBooks } from "../contexts/BooksContext";
import { useNavigate } from "react-router-dom";
import { Button } from "./ui/button";
import { ChevronLeft } from "lucide-react";

export const SimpleReadingArea = () => {
  const { currentBook } = useBooks();
  const navigate = useNavigate();

  if (!currentBook?.pdf_url) {
    return (
      <div className="flex flex-col h-full">
        <div className="flex items-center p-4 border-b">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => navigate('/library')}
            className="mr-4"
          >
            <ChevronLeft className="h-4 w-4 mr-1" />
            Back to Library
          </Button>
          <h1 className="text-lg font-semibold">No PDF available</h1>
        </div>
        <div className="flex-1 flex items-center justify-center">
          <p className="text-muted-foreground">Please select a book to read</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center p-4 border-b bg-background">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => navigate('/library')}
          className="mr-4"
        >
          <ChevronLeft className="h-4 w-4 mr-1" />
          Back to Library
        </Button>
        <div className="flex-1">
          <h1 className="text-lg font-semibold">{currentBook.title}</h1>
          {currentBook.author && (
            <p className="text-sm text-muted-foreground">{currentBook.author}</p>
          )}
        </div>
      </div>

      {/* PDF Viewer using browser's native viewer */}
      <div className="flex-1 p-4">
        <iframe
          src={currentBook.pdf_url}
          width="100%"
          height="100%"
          style={{ border: 'none', borderRadius: '8px' }}
          title={`PDF Viewer - ${currentBook.title}`}
          loading="lazy"
        >
          {/* Fallback for browsers that don't support iframe */}
          <object
            data={currentBook.pdf_url}
            type="application/pdf"
            width="100%"
            height="100%"
            className="rounded-lg"
          >
            <div className="flex flex-col items-center justify-center h-full space-y-4">
              <p>Your browser doesn't support inline PDF viewing.</p>
              <Button asChild>
                <a 
                  href={currentBook.pdf_url} 
                  target="_blank" 
                  rel="noopener noreferrer"
                >
                  Open PDF in New Tab
                </a>
              </Button>
            </div>
          </object>
        </iframe>
      </div>
    </div>
  );
};
