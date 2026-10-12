import { useState, useRef, useEffect } from "react";
import { Card } from "./ui/card";
import { Button } from "./ui/button";
import { Play, Pause, Mic, ChevronLeft, ChevronRight, Loader2, Maximize2, Minimize2, Repeat } from "lucide-react";
import { useUI } from "../contexts/UIContext";
import { useBooks } from "../contexts/BooksContext";
import { useNavigate } from "react-router-dom";
import { Document, Page, pdfjs } from 'react-pdf';
import 'react-pdf/dist/Page/AnnotationLayer.css';
import 'react-pdf/dist/Page/TextLayer.css';
import html2canvas from 'html2canvas';
import { ScrollArea } from "./ui/scroll-area";
import { Slider } from "./ui/slider";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { useVoiceChoice, BASE_VOICE_NAME, BASE_VOICE_OPTION } from "./reading-room/hooks/useVoiceChoice";
import { usePdfDocument } from "./reading-room/hooks/usePdfDocument";
import { usePageAudio } from "./reading-room/hooks/usePageAudio";

// Worker is configured globally in main.tsx - no need to set it here

export const ReadingArea = () => {
  const [pageNumber, setPageNumber] = useState(1);
  const [pageWidth, setPageWidth] = useState<number>(800);
  const [pageHeight, setPageHeight] = useState<number | null>(null);
  const [fitMode, setFitMode] = useState<'width' | 'page'>('width');
  const [zoomScale, setZoomScale] = useState<number>(100); // 50-150%
  
  const { isAICollapsed } = useUI();
  const { currentBook } = useBooks();
  const navigate = useNavigate();
  const containerRef = useRef<HTMLDivElement>(null);
  const pageRef = useRef<HTMLDivElement>(null);

  const {
    setVoiceChoice,
    personas,
    isLoadingPersonas,
    activePersonaId,
    voiceSelectValue,
    activePersonaIdRef,
  } = useVoiceChoice();

  const { pdfUrl, numPages, onDocumentLoadSuccess, onDocumentLoadError } = usePdfDocument(
    currentBook,
    () => updateContainerDimensions()
  );

  useEffect(() => {
    // Update container dimensions on mount and when window is resized
    updateContainerDimensions();
    
    // Add resize listener
    window.addEventListener('resize', updateContainerDimensions);
    return () => window.removeEventListener('resize', updateContainerDimensions);
  }, []);

  // Redirect to library if no book is selected (must be in useEffect, not during render)
  useEffect(() => {
    if (!currentBook) {
      navigate('/library');
    }
  }, [currentBook, navigate]);


  // Handle window resize for PDF page width
  const updateContainerDimensions = () => {
    if (containerRef.current) {
      const containerWidth = containerRef.current.clientWidth;
      const scale = zoomScale / 100; // Convert percentage to decimal

      if (fitMode === 'page') {
        // Calculate available viewport height more accurately
        // Account for: top bar (~2-3rem), card padding (~3-8rem), container padding (~2-6rem), control bar (70px)
        const viewportHeight = window.innerHeight;
        const reservedHeight = 100; // Top bar + margins
        const cardPadding = 64; // Card padding (p-3 to p-8)
        const containerPadding = 48; // Container padding (p-2 to p-6)
        const controlBar = 70; // Bottom control bar
        
        const availableHeight = (viewportHeight - reservedHeight - cardPadding - containerPadding - controlBar) * scale;
        const maxWidth = containerWidth * 0.9 * scale;
        
        setPageWidth(maxWidth);
        setPageHeight(availableHeight);
      } else {
        // Fit width only, let height scroll
        const maxWidth = Math.min(containerWidth * 0.9, 800) * scale;
        setPageWidth(maxWidth);
        setPageHeight(null);
      }
    }
  };

  // Re-calculate dimensions when fit mode or zoom changes
  useEffect(() => {
    updateContainerDimensions();
  }, [fitMode, zoomScale]);

  // Helper function to format time in HH:MM:SS
  const formatTime = (seconds: number): string => {
    if (!isFinite(seconds) || seconds < 0) return '00:00:00';
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    return `${String(hrs).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  };

  // Fallback method to capture the entire container if pageRef doesn't work
  const capturePageContent = async () => {
    if (!containerRef.current) {
      return null;
    }
    
    try {
      // Add a larger delay to ensure rendering is complete
      await new Promise(resolve => setTimeout(resolve, 500));
      
      // Try different target elements to find one that works
      const canvas = document.createElement('canvas');
      const targetElement = containerRef.current.querySelector('.react-pdf__Page');
      
      if (targetElement) {
        // If we find the react-pdf Page element, try to capture just that
        const rect = targetElement.getBoundingClientRect();
        canvas.width = rect.width * 2; // Higher resolution
        canvas.height = rect.height * 2;
        
        // Manual approach - try to draw the PDF canvas onto our own canvas
        const pdfCanvas = targetElement.querySelector('canvas');
        if (pdfCanvas) {
          const ctx = canvas.getContext('2d');
          if (ctx) {
            ctx.drawImage(pdfCanvas, 0, 0, canvas.width, canvas.height);
            return canvas;
          }
        }
        
        // If direct canvas copy fails, fall back to html2canvas
        return await html2canvas(targetElement as HTMLElement, { 
          useCORS: true,
          allowTaint: true,
          foreignObjectRendering: false, // Disable foreignObject rendering
          scale: 2,
          imageTimeout: 0,
          removeContainer: false,
        });
      } 
      
      // If can't find the page element, try the pdf-page-container
      const pdfContainer = containerRef.current.querySelector('.pdf-page-container');
      if (pdfContainer) {
        return await html2canvas(pdfContainer as HTMLElement, { 
          useCORS: true,
          allowTaint: true,
          foreignObjectRendering: false,
          scale: 2,
          imageTimeout: 0,
          removeContainer: false,
        });
      }
      
      // Last resort - try the entire container
      return await html2canvas(containerRef.current, { 
        useCORS: true,
        allowTaint: true,
        foreignObjectRendering: false,
        scale: 2,
        imageTimeout: 0,
        removeContainer: false,
      });
    } catch (error) {
      return null;
    }
  };

  // Capture the rendered page as a canvas for OCR
  const capturePage = async (): Promise<HTMLCanvasElement | null> => {
    try {
      // Use different html2canvas configuration to improve capture
      return await html2canvas(pageRef.current, { 
        useCORS: true,
        allowTaint: true,
        foreignObjectRendering: false, // Changed to false to avoid ForeignObject rendering issues
        scale: 2, // Higher resolution capture
        imageTimeout: 0, // No timeout for images
        removeContainer: false,
        ignoreElements: (element) => {
          // Ignore UI elements that might interfere with capture
          return element.tagName === 'BUTTON' || 
                element.classList.contains('absolute');
        }
      });
    } catch (captureError) {
      return await capturePageContent();
    }
  };

  const {
    isPlaying,
    isReading,
    audioDuration,
    audioCurrentTime,
    audioRef,
    autoPlayEnabled,
    setAutoPlayEnabled,
    isPrefetching,
    prefetchPageNumber,
    prefetchPageRef,
    handleReadPage,
    handlePrevPage,
    handleNextPage,
    handleSeek,
  } = usePageAudio({
    currentBook,
    pageNumber,
    setPageNumber,
    numPages,
    activePersonaId,
    activePersonaIdRef,
    isLoadingPersonas,
    pageRef,
    capturePage,
  });



  // Don't render anything if no book (useEffect above will handle redirect)
  if (!currentBook) {
    return null;
  }

  return (
    <main className={`h-full transition-all duration-300 z-0 
      ${isAICollapsed ? 'sm:pr-[74px]' : 'sm:pr-[calc(35vw-6rem)]'}`}>
      <div className={`relative h-[calc(100vh-2rem)] sm:h-[calc(100vh-2rem)] lg:h-[calc(100vh-2rem)] 
        transition-all duration-300 ease-in-out
        ${isAICollapsed ? 'sm:w-[calc(100%-60px)]' : 'sm:w-[calc(70vw-2rem)] w-full'} 
        px-4 sm:px-8 mt-4`}>
        
        {/* Reading area with fixed padding at bottom to make room for controls */}
        <Card className="h-[calc(100%-70px)] glass bg-card shadow-lg p-3 sm:p-4 lg:p-8 animate-fade-in">
          <ScrollArea className="h-full">
            <div ref={containerRef} className="relative flex items-center justify-center min-h-full p-2 sm:p-4 lg:p-6">
              {currentBook && pdfUrl && (
                <div className="absolute top-4 right-4 z-10 flex flex-col gap-2 bg-background/95 backdrop-blur-sm rounded-lg p-2 shadow-lg">
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => setFitMode(fitMode === 'width' ? 'page' : 'width')}
                    className="hover:bg-primary/10 h-8 w-8"
                    title={fitMode === 'width' ? 'Fit page to window' : 'Fit width only'}
                  >
                    {fitMode === 'width' ? (
                      <Maximize2 className="h-4 w-4" />
                    ) : (
                      <Minimize2 className="h-4 w-4" />
                    )}
                  </Button>
                  <div className="w-full h-px bg-border" />
                  <div className="flex flex-col items-center gap-1 px-1">
                    <span className="text-xs text-muted-foreground">{zoomScale}%</span>
                    <Slider
                      value={[zoomScale]}
                      min={50}
                      max={150}
                      step={5}
                      onValueChange={(value) => setZoomScale(value[0])}
                      className="h-24"
                      orientation="vertical"
                    />
                  </div>
                </div>
              )}
              {!currentBook && (
                <div className="flex items-center justify-center h-full text-center">
                  <div className="py-8">
                    <p className="text-muted-foreground mb-4">No book selected</p>
                    <Button onClick={() => navigate('/library')} variant="outline">
                      Go to Library
                    </Button>
                  </div>
                </div>
              )}
              
              {currentBook && !pdfUrl && (
                <div className="flex items-center justify-center h-full text-center">
                  <div className="py-8">
                    <p className="text-red-500 mb-2">PDF not available</p>
                    <p className="text-sm text-muted-foreground mb-4">
                      PDF URL: {currentBook.pdf_url || 'Not provided'}<br/>
                      Local Data: {currentBook.pdfData ? 'Available' : 'Not available'}
                    </p>
                    <Button onClick={() => navigate('/library')} variant="outline">
                      Back to Library
                    </Button>
                  </div>
                </div>
              )}
              
              {pdfUrl && (
                <Document
                  file={pdfUrl}
                  onLoadSuccess={onDocumentLoadSuccess}
                  onLoadError={onDocumentLoadError}
                  loading={
                    <div className="flex items-center justify-center h-full">
                      <div className="text-center py-4">
                        <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full mb-2"></div>
                        <p>Loading PDF...</p>
                        <p className="text-xs text-muted-foreground mt-2">URL: {pdfUrl}</p>
                      </div>
                    </div>
                  }
                  error={
                    <div className="text-center py-4 text-red-500">
                      <p>Error loading PDF. Please try again.</p>
                      <p className="text-xs text-muted-foreground mt-2">URL: {pdfUrl}</p>
                      <p className="text-xs text-red-400 mt-1">Check console for detailed error information</p>
                    </div>
                  }
                >
                  <div ref={pageRef} className="pdf-page-container">
                    <Page
                      pageNumber={pageNumber}
                      width={pageWidth}
                      height={pageHeight || undefined}
                      renderAnnotationLayer={false}
                      renderTextLayer={false}
                    />
                  </div>
                  {/* Hidden page for prefetching - renders off-screen */}
                  {prefetchPageNumber && (
                    <div 
                      ref={prefetchPageRef} 
                      className="absolute -left-[9999px] -top-[9999px] opacity-0 pointer-events-none"
                      aria-hidden="true"
                    >
                      <Page
                        pageNumber={prefetchPageNumber}
                        width={pageWidth}
                        renderAnnotationLayer={false}
                        renderTextLayer={false}
                      />
                    </div>
                  )}
                </Document>
              )}
            </div>
          </ScrollArea>
        </Card>

        {/* Fixed control bar at bottom */}
        <Card className="absolute bottom-0 left-4 right-4 sm:left-8 sm:right-8 glass bg-card/95 shadow-lg p-2 sm:p-3 lg:p-4 animate-slide-in">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="icon"
                onClick={() => handleReadPage(false)}
                disabled={isReading || isLoadingPersonas}
                className="hover:bg-primary/10"
              >
                {isReading ? (
                  <Loader2 className="h-4 lg:h-5 w-4 lg:w-5 animate-spin" />
                ) : isPlaying ? (
                  <Pause className="h-4 lg:h-5 w-4 lg:w-5" />
                ) : (
                  <Play className="h-4 lg:h-5 w-4 lg:w-5" />
                )}
              </Button>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setAutoPlayEnabled(!autoPlayEnabled)}
                className={`hover:bg-primary/10 ${autoPlayEnabled ? 'bg-primary/20 text-primary' : ''}`}
                title={autoPlayEnabled ? 'Disable auto-play' : 'Enable auto-play'}
              >
                <Repeat className="h-4 lg:h-5 w-4 lg:w-5" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="hover:bg-primary/10"
              >
                <Mic className="h-4 lg:h-5 w-4 lg:w-5" />
              </Button>
              <Select
                value={voiceSelectValue}
                onValueChange={setVoiceChoice}
                disabled={isLoadingPersonas}
              >
                <SelectTrigger className="h-8 w-[120px] sm:w-[160px] text-xs lg:text-sm" aria-label="Reading voice">
                  <SelectValue placeholder="Voice" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={BASE_VOICE_OPTION}>Base voice ({BASE_VOICE_NAME})</SelectItem>
                  {personas?.map(persona => (
                    <SelectItem key={persona.id} value={persona.id}>
                      {persona.name}{persona.is_default ? ' (default)' : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>


              <div className="flex items-center gap-2 ml-4">
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => handlePrevPage()}
                  disabled={pageNumber <= 1}
                  className="hover:bg-primary/10"
                >
                  <ChevronLeft className="h-4 lg:h-5 w-4 lg:w-5" />
                </Button>
                <div className="flex items-center gap-1">
                  <span className="text-sm text-muted-foreground">
                    {pageNumber} / {numPages || '?'}
                  </span>
                  {isPrefetching && (
                    <span className="text-xs text-primary animate-pulse" title="Preparing next page">
                      ●
                    </span>
                  )}
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => handleNextPage(false)}
                  disabled={!numPages || pageNumber >= numPages}
                  className="hover:bg-primary/10"
                >
                  <ChevronRight className="h-4 lg:h-5 w-4 lg:w-5" />
                </Button>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <Slider
                value={[audioDuration > 0 ? (audioCurrentTime / audioDuration) * 100 : 0]}
                max={100}
                step={0.1}
                onValueChange={(value) => handleSeek(value[0])}
                className="w-24 sm:w-32"
                disabled={!audioRef.current || audioDuration === 0}
              />
              <div className="text-xs sm:text-sm text-muted-foreground whitespace-nowrap">
                {formatTime(audioCurrentTime)} / {formatTime(audioDuration)}
              </div>
            </div>
          </div>
        </Card>
      </div>
    </main>
  );
};
