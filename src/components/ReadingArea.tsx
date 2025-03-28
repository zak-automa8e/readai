import { useState, useRef, useEffect } from "react";
import { Card } from "./ui/card";
import { Button } from "./ui/button";
import { Play, Pause, Mic, ChevronLeft, ChevronRight } from "lucide-react";
import { useUI } from "../contexts/UIContext";
import { useBooks } from "../contexts/BooksContext";
import { useNavigate } from "react-router-dom";
import { Document, Page, pdfjs } from 'react-pdf';
import 'react-pdf/dist/Page/AnnotationLayer.css';
import 'react-pdf/dist/Page/TextLayer.css';

// Set the worker source for PDF.js
pdfjs.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.js';

export const ReadingArea = () => {
  const [isPlaying, setIsPlaying] = useState(false);
  const [numPages, setNumPages] = useState<number | null>(null);
  const [pageNumber, setPageNumber] = useState(1);
  const [pageWidth, setPageWidth] = useState<number>(800);
  const [pageHeight, setPageHeight] = useState<number | null>(null);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const { isAICollapsed } = useUI();
  const { currentBook } = useBooks();
  const navigate = useNavigate();
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Create Blob URL when book changes
    if (currentBook?.pdfData) {
      const blob = new Blob([currentBook.pdfData], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      setPdfUrl(url);
      return () => {
        URL.revokeObjectURL(url);
      };
    }
  }, [currentBook]);

  useEffect(() => {
    // Update container dimensions on mount and when window is resized
    updateContainerDimensions();
    
    // Add resize listener
    window.addEventListener('resize', updateContainerDimensions);
    return () => window.removeEventListener('resize', updateContainerDimensions);
  }, []);

  const onDocumentLoadSuccess = ({ numPages }: { numPages: number }) => {
    setNumPages(numPages);
    updateContainerDimensions(); // Update dimensions after document loads
  };

  // Handle window resize for PDF page width
  const updateContainerDimensions = () => {
    if (containerRef.current) {
      const containerWidth = containerRef.current.clientWidth;
      const containerHeight = containerRef.current.clientHeight;
      
      // Calculate a more modest width - approximately 65% of container width
      const maxWidth = Math.min(containerWidth * 0.65, 800);
      
      // Set width to fit within container
      setPageWidth(maxWidth);
      
      // Set height constraint to ensure page fits vertically
      setPageHeight(containerHeight * 0.9);
    }
  };

  // Navigation
  const handlePrevPage = () => setPageNumber(prev => Math.max(1, prev - 1));
  const handleNextPage = () => setPageNumber(prev => prev < (numPages || 0) ? prev + 1 : prev);

  if (!currentBook) {
    navigate('/library');
    return null;
  }

  return (
    <main className={`h-full transition-all duration-300 z-0 
      ${isAICollapsed ? 'sm:pr-[74px]' : 'sm:pr-[calc(35vw-6rem)]'}`}>
      <div className={`relative h-[calc(100vh-1rem)] sm:h-[calc(100vh-2rem)] lg:h-[calc(100vh-3rem)] 
        transition-all duration-300 ease-in-out
        ${isAICollapsed ? 'sm:w-[calc(100%-60px)]' : 'sm:w-[calc(70vw-2rem)] w-full'} 
        px-4 sm:px-8`}>
        
        {/* Reading area with fixed padding at bottom to make room for controls */}
        <Card className="h-[calc(100%-70px)] glass bg-card shadow-lg p-3 sm:p-4 lg:p-8 animate-fade-in overflow-hidden">
          <div ref={containerRef} className="h-full flex items-center justify-center">
            {pdfUrl && (
              <Document
                file={pdfUrl}
                onLoadSuccess={onDocumentLoadSuccess}
                loading={
                  <div className="flex items-center justify-center h-full">
                    <div className="text-center py-4">
                      <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full mb-2"></div>
                      <p>Loading PDF...</p>
                    </div>
                  </div>
                }
                error={
                  <div className="text-center py-4 text-red-500">
                    <p>Error loading PDF. Please try again.</p>
                  </div>
                }
              >
                <Page
                  pageNumber={pageNumber}
                  width={pageWidth}
                  height={pageHeight}
                  renderTextLayer={true}
                  renderAnnotationLayer={true}
                  className="object-contain"
                />
              </Document>
            )}
          </div>
        </Card>
        
        {/* Fixed control bar at bottom */}
        <Card className="absolute bottom-0 left-4 right-4 sm:left-8 sm:right-8 glass bg-card/95 shadow-lg p-2 sm:p-3 lg:p-4 animate-slide-in">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setIsPlaying(!isPlaying)}
                className="hover:bg-primary/10"
              >
                {isPlaying ? <Pause className="h-4 lg:h-5 w-4 lg:w-5" /> : <Play className="h-4 lg:h-5 w-4 lg:w-5" />}
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="hover:bg-primary/10"
              >
                <Mic className="h-4 lg:h-5 w-4 lg:w-5" />
              </Button>

              <div className="flex items-center gap-2 ml-4">
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={handlePrevPage}
                  disabled={pageNumber <= 1}
                  className="hover:bg-primary/10"
                >
                  <ChevronLeft className="h-4 lg:h-5 w-4 lg:w-5" />
                </Button>
                <span className="text-sm text-muted-foreground">
                  {pageNumber} / {numPages || '?'}
                </span>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={handleNextPage}
                  disabled={!numPages || pageNumber >= numPages}
                  className="hover:bg-primary/10"
                >
                  <ChevronRight className="h-4 lg:h-5 w-4 lg:w-5" />
                </Button>
              </div>
            </div>
            <div className="text-sm text-muted-foreground">
              00:00 / 05:30
            </div>
          </div>
        </Card>
      </div>
    </main>
  );
};
