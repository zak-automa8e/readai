import { useState, useRef, useEffect } from "react";
import { Card } from "./ui/card";
import { Button } from "./ui/button";
import { Play, Pause, Mic, ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
import { useUI } from "../contexts/UIContext";
import { useBooks } from "../contexts/BooksContext";
import { useNavigate } from "react-router-dom";
import { Document, Page, pdfjs } from 'react-pdf';
import 'react-pdf/dist/Page/AnnotationLayer.css';
import 'react-pdf/dist/Page/TextLayer.css';
import html2canvas from 'html2canvas';
import { toast } from "@/hooks/use-toast";
import { ScrollArea } from "./ui/scroll-area";

// Set the worker source for PDF.js (using local file)
pdfjs.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.js'; // This should match the file in public folder

// Preload the PDF.js worker to ensure it's available
const preloadPdfWorker = async () => {
  try {
    // Test if the worker file is accessible by making a HEAD request
    const response = await fetch('/pdf.worker.min.js', { method: 'HEAD' });
    if (!response.ok) {
      console.error('PDF worker file not found or not accessible');
      return false;
    }
    return true;
  } catch (error) {
    console.error('Error preloading PDF worker:', error);
    return false;
  }
};

// Call the preload function to verify the worker is available
preloadPdfWorker().then(available => {
  if (!available) {
    console.warn('PDF worker may not be available. PDF rendering might be limited.');
  }
});

export const ReadingArea = () => {
  const [isPlaying, setIsPlaying] = useState(false);
  const [isReading, setIsReading] = useState(false); // For loading state
  const [numPages, setNumPages] = useState<number | null>(null);
  const [pageNumber, setPageNumber] = useState(1);
  const [pageWidth, setPageWidth] = useState<number>(800);
  const [pageHeight, setPageHeight] = useState<number | null>(null);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const { isAICollapsed } = useUI();
  const { currentBook } = useBooks();
  const navigate = useNavigate();
  const containerRef = useRef<HTMLDivElement>(null);
  const pageRef = useRef<HTMLDivElement>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

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

  // Cleanup audio on unmount
  useEffect(() => {
    return () => {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
    };
  }, []);

  const onDocumentLoadSuccess = ({ numPages }: { numPages: number }) => {
    setNumPages(numPages);
    updateContainerDimensions(); // Update dimensions after document loads
  };

  // Handle window resize for PDF page width
  const updateContainerDimensions = () => {
    if (containerRef.current) {
      const containerWidth = containerRef.current.clientWidth;

      // Calculate width to fully fit the container
      const maxWidth = Math.min(containerWidth * 0.9, 800);

      // Adjust width to fit within container
      setPageWidth(maxWidth);

      // Let the page height be determined by its aspect ratio for scrolling
      setPageHeight(null);
    }
  };

  // Navigation
  const handlePrevPage = () => setPageNumber(prev => Math.max(1, prev - 1));
  const handleNextPage = () => setPageNumber(prev => prev < (numPages || 0) ? prev + 1 : prev);

  const handleReadPage = async () => {
    if (isReading) {
      return;
    }

    if (isPlaying) {
      if (audioRef.current) {
        audioRef.current.pause();
        setIsPlaying(false);
      }
      return;
    }

    if (!pageRef.current) {
      toast({ title: "Error", description: "Reading area not found.", variant: "destructive" });
      return;
    }

    try {
      setIsReading(true);
      
      // Add delay to ensure PDF is fully rendered
      await new Promise(resolve => setTimeout(resolve, 1000)); // Increased delay to 1 second
      
    // 1. Convert page to image
    let canvas;
    try {
      // Use different html2canvas configuration to improve capture
      canvas = await html2canvas(pageRef.current, { 
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
      canvas = await capturePageContent();
      
      if (!canvas) {
        toast({ title: "Capture Failed", description: "Could not capture the current page content.", variant: "destructive" });
        setIsReading(false);
        return;
      }
    }
      const imageBase64 = canvas.toDataURL('image/png');

      // 2. Send image to get text
      let textResponse;
      try {
        textResponse = await fetch("http://localhost:3001/api/image-to-text", {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ image: imageBase64 }),
        });
      } catch (networkError) {
        toast({ 
          title: "Connection Error", 
          description: "Cannot connect to backend server. Is it running?",
          variant: "destructive" 
        });
        return;
      }

      if (!textResponse.ok) {
        const errorData = await textResponse.json();
        throw new Error(errorData.error || "Failed to extract text from page.");
      }

      const textData = await textResponse.json();
        
      // Combine header and body for better reading experience
      let pageText = '';
      if (textData.header && textData.header.trim().length > 0) {
        pageText += textData.header.trim() + '\n\n';
      }
      if (textData.body && textData.body.trim().length > 0) {
        pageText += textData.body.trim();
      }

      if (!pageText || pageText.trim().length === 0) {
        toast({ title: "No Text Found", description: "Could not find any text on the current page." });
        return;
      }

      // 3. Send text to get audio
      let audioResponse;
      let isRateLimited = false;
      let audioBlob = null;
      let audioUrl = null;
      
      try {
        audioResponse = await fetch("http://localhost:3001/api/text-to-audio", {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: pageText }),
        });
        
        if (audioResponse.status === 429) {
          isRateLimited = true;
          toast({ 
            title: "Rate Limit Reached", 
            description: "Text-to-speech API rate limit reached. Using text reading mode instead.",
            duration: 5000
          });
        } else if (!audioResponse.ok) {
          throw new Error("Failed to generate audio: " + audioResponse.statusText);
        } else {
          // Successfully got audio response
          audioBlob = await audioResponse.blob();
          audioUrl = URL.createObjectURL(audioBlob);
        }
      } catch (networkError) {
        toast({ 
          title: "Connection Error", 
          description: "Cannot connect to backend server for audio generation.",
          variant: "destructive" 
        });
        return;
      }
      
      // If rate limited, provide visual feedback instead of audio
      if (isRateLimited) {
        toast({
          title: "Reading Text",
          description: "Audio generation unavailable. Please read the text on screen.",
          duration: 10000,
        });
        return;
      }
      
      if (!audioBlob || !audioUrl) {
        throw new Error("Failed to generate audio content.");
      }

      // 4. Play audio
      if (audioRef.current) {
        audioRef.current.pause();
      }
      const newAudio = new Audio(audioUrl);
      audioRef.current = newAudio;
      
      // Add a load event listener to ensure audio is ready
      newAudio.addEventListener('canplaythrough', () => {
        newAudio.play().catch(error => {
          toast({ title: "Playback Error", description: "Could not play audio: " + error.message, variant: "destructive" });
          setIsPlaying(false);
        });
      });
      
      newAudio.addEventListener('playing', () => {
        setIsPlaying(true);
      });
      
      // Try to load the audio
      newAudio.load();

      newAudio.onended = () => {
        setIsPlaying(false);
        URL.revokeObjectURL(audioUrl);
      };

      newAudio.onerror = (e) => {
        toast({ title: "Error", description: "Could not play audio.", variant: "destructive" });
        setIsPlaying(false);
        URL.revokeObjectURL(audioUrl);
      };

    } catch (error) {
      toast({ title: "Reading Failed", description: error instanceof Error ? error.message : "An unknown error occurred.", variant: "destructive" });
    } finally {
      setIsReading(false);
    }
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



  if (!currentBook) {
    navigate('/library');
    return null;
  }

  return (
    <main className={`h-full transition-all duration-300 z-0 
      ${isAICollapsed ? 'sm:pr-[74px]' : 'sm:pr-[calc(35vw-6rem)]'}`}>
      <div className={`relative h-[calc(100vh-2rem)] sm:h-[calc(100vh-2rem)] lg:h-[calc(100vh-3rem)] 
        transition-all duration-300 ease-in-out
        ${isAICollapsed ? 'sm:w-[calc(100%-60px)]' : 'sm:w-[calc(70vw-2rem)] w-full'} 
        px-4 sm:px-8`}>
        
        {/* Reading area with fixed padding at bottom to make room for controls */}
        <Card className="h-[calc(100%-70px)] glass bg-card shadow-lg p-3 sm:p-4 lg:p-8 animate-fade-in">
          <ScrollArea className="h-full w-full">
            <div ref={containerRef} className="flex justify-center p-4">
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
                  <div ref={pageRef} className="pdf-page-container">
                    <Page
                      pageNumber={pageNumber}
                      width={pageWidth}
                      height={pageHeight || undefined}
                      renderAnnotationLayer={false}
                      renderTextLayer={false}
                    />
                  </div>
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
                onClick={handleReadPage}
                disabled={isReading}
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
