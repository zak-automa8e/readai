import { useState, useRef, useEffect, useCallback } from "react";
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
import { toast } from "@/hooks/use-toast";
import { ScrollArea } from "./ui/scroll-area";
import { Slider } from "./ui/slider";
import apiService from "../services/apiService";
import { useQuery } from "@tanstack/react-query";
import { voicePersonaService } from "@/services/voicePersonaService";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";

const BASE_VOICE_NAME = 'Zephyr';
const BASE_VOICE_OPTION = 'base-voice';

// Worker is configured globally in main.tsx - no need to set it here

interface PrefetchedAudioData {
  audio: HTMLAudioElement;
  url: string;
  duration: number;
  pageNumber: number;
}

export const ReadingArea = () => {
  const [isPlaying, setIsPlaying] = useState(false);
  const [isReading, setIsReading] = useState(false); // For loading state
  const [numPages, setNumPages] = useState<number | null>(null);
  const [pageNumber, setPageNumber] = useState(1);
  const [pageWidth, setPageWidth] = useState<number>(800);
  const [pageHeight, setPageHeight] = useState<number | null>(null);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [fitMode, setFitMode] = useState<'width' | 'page'>('width');
  const [zoomScale, setZoomScale] = useState<number>(100); // 50-150%
  const [audioPausedAt, setAudioPausedAt] = useState<number>(0);
  const [currentAudioUrl, setCurrentAudioUrl] = useState<string | null>(null);
  const [audioDuration, setAudioDuration] = useState<number>(0);
  const [audioCurrentTime, setAudioCurrentTime] = useState<number>(0);
  
  // Auto-play and prefetch state
  const [autoPlayEnabled, setAutoPlayEnabled] = useState(false);
  const [isPrefetching, setIsPrefetching] = useState(false);
  const [prefetchedAudio, setPrefetchedAudio] = useState<Map<number, PrefetchedAudioData>>(new Map());
  const [shouldAutoPlay, setShouldAutoPlay] = useState(false);
  const [prefetchPageNumber, setPrefetchPageNumber] = useState<number | null>(null);
  const prefetchAbortController = useRef<AbortController | null>(null);
  const prefetchPageRef = useRef<HTMLDivElement>(null);
  const { isAICollapsed } = useUI();
  const { currentBook } = useBooks();
  const navigate = useNavigate();
  const containerRef = useRef<HTMLDivElement>(null);
  const pageRef = useRef<HTMLDivElement>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Voice selection: null follows the user's default persona, BASE_VOICE_OPTION forces the base voice
  const [voiceChoice, setVoiceChoice] = useState<string | null>(null);
  const { data: personas, isLoading: isLoadingPersonas } = useQuery({
    queryKey: ['voice-personas', 'my'],
    queryFn: voicePersonaService.getMyPersonas,
    retry: false
  });
  const defaultPersona = personas?.find(p => p.is_default);
  const chosenPersona = personas?.find(p => p.id === voiceChoice);
  const activePersonaId =
    voiceChoice === BASE_VOICE_OPTION ? null : (chosenPersona ?? defaultPersona)?.id ?? null;
  const voiceSelectValue = activePersonaId ?? BASE_VOICE_OPTION;
  // Read at request time so prefetch and playback always use the latest selection
  const activePersonaIdRef = useRef<string | null>(null);
  activePersonaIdRef.current = activePersonaId;

  useEffect(() => {
    // Handle PDF URL from backend or create Blob URL from local data
    if (currentBook?.pdf_url) {
      
      // Try to properly encode the URL to handle any special characters
      let processedUrl = currentBook.pdf_url;
      try {
        // Parse and rebuild the URL to ensure proper encoding
        const url = new URL(currentBook.pdf_url);
        processedUrl = url.toString();
      } catch (error) {
  // Ignore URL parsing issues; fall back to original
      }
      
      setPdfUrl(processedUrl);
    } else if (currentBook?.pdfData) {
      const blob = new Blob([new Uint8Array(currentBook.pdfData)], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      setPdfUrl(url);
      return () => {
        URL.revokeObjectURL(url);
      };
    } else {
      setPdfUrl(null);
    }
  }, [currentBook]);

  useEffect(() => {
    // Update container dimensions on mount and when window is resized
    updateContainerDimensions();
    
    // Add resize listener
    window.addEventListener('resize', updateContainerDimensions);
    return () => window.removeEventListener('resize', updateContainerDimensions);
  }, []);

  // Cleanup audio on unmount only
  useEffect(() => {
    // Store refs in local variables for cleanup
    const currentAudioRef = audioRef;
    const currentPrefetchAbortController = prefetchAbortController;
    
    return () => {
      if (currentAudioRef.current) {
        currentAudioRef.current.pause();
        currentAudioRef.current = null;
      }
      // Cancel any in-flight prefetch
      if (currentPrefetchAbortController.current) {
        currentPrefetchAbortController.current.abort();
      }
    };
  }, []); // Empty dependency array - only run on unmount

  // Redirect to library if no book is selected (must be in useEffect, not during render)
  useEffect(() => {
    if (!currentBook) {
      navigate('/library');
    }
  }, [currentBook, navigate]);

  // Auto-play effect: triggers playback when page changes during auto-play
  useEffect(() => {
    if (shouldAutoPlay && !isPlaying && !isReading) {
      setShouldAutoPlay(false);
      handleReadPage(true);
    }
  }, [pageNumber, shouldAutoPlay, isPlaying, isReading]);

  const onDocumentLoadSuccess = ({ numPages }: { numPages: number }) => {
    setNumPages(numPages);
    updateContainerDimensions(); // Update dimensions after document loads
  };

  const onDocumentLoadError = (error: Error) => {
    toast({
      title: "PDF Load Error",
      description: `Failed to load PDF: ${error.message}`,
      variant: "destructive"
    });
  };

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

  // Prefetch audio for next page - triggers rendering of hidden page
  const prefetchNextPageAudio = useCallback(async (targetPageNumber: number) => {
    if (!currentBook || !numPages || targetPageNumber > numPages || targetPageNumber < 1) {
      return;
    }

    // Don't prefetch if already in progress or already cached
    if (isPrefetching || prefetchedAudio.has(targetPageNumber)) {
      return;
    }

    // Set the prefetch page number to trigger hidden page render
    setPrefetchPageNumber(targetPageNumber);
    setIsPrefetching(true);
    prefetchAbortController.current = new AbortController();
    
    toast({
      title: "Preparing Next Page",
      description: `Pre-loading page ${targetPageNumber}...`,
      duration: 2000,
    });
  }, [currentBook, numPages, isPrefetching, prefetchedAudio]);

  // Effect to capture and process the hidden prefetch page once it's rendered
  useEffect(() => {
    const processPrefetchPage = async () => {
      if (!prefetchPageNumber || !prefetchPageRef.current || !currentBook) {
        return;
      }

      // Check if prefetch was aborted
      if (prefetchAbortController.current?.signal.aborted) {
        setIsPrefetching(false);
        setPrefetchPageNumber(null);
        return;
      }

      try {
        // Wait for the hidden page to render
        await new Promise(resolve => setTimeout(resolve, 1500));

        // Check again if aborted during wait
        if (prefetchAbortController.current?.signal.aborted) {
          return;
        }

        // Capture the hidden page
        const prefetchCanvas = prefetchPageRef.current.querySelector('canvas');
        if (!prefetchCanvas) {
          console.warn('Prefetch: Could not find canvas for page', prefetchPageNumber);
          return;
        }

        // Create a new canvas and copy the PDF canvas content
        const canvas = document.createElement('canvas');
        canvas.width = prefetchCanvas.width;
        canvas.height = prefetchCanvas.height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          console.warn('Prefetch: Could not get canvas context');
          return;
        }
        ctx.drawImage(prefetchCanvas, 0, 0);
        const imageBase64 = canvas.toDataURL('image/png');

        // Get text from API (will use cache if available)
        const textResponse = await apiService.getCachedPageText(
          currentBook.id, 
          prefetchPageNumber, 
          imageBase64
        );

        if (prefetchAbortController.current?.signal.aborted) {
          return;
        }

        const textData = textResponse.text;
        let pageText = '';
        if (textData.header?.trim()) {
          pageText += textData.header.trim() + '\n\n';
        }
        if (textData.body?.trim()) {
          pageText += textData.body.trim();
        }

        if (!pageText.trim()) {
          console.warn('Prefetch: No text found on page', prefetchPageNumber);
          return;
        }

        // Get audio from API (will use cache if available)
        const requestedPersonaId = activePersonaIdRef.current;
        const audioResponse = await apiService.getCachedPageAudio(
          currentBook.id,
          prefetchPageNumber,
          pageText,
          BASE_VOICE_NAME,
          false,
          requestedPersonaId
        );

        if (prefetchAbortController.current?.signal.aborted) {
          return;
        }

        // Voice changed while the request was in flight - discard the stale audio
        if (requestedPersonaId !== activePersonaIdRef.current) {
          return;
        }

        if (!audioResponse?.audioUrl) {
          console.warn('Prefetch: No audio URL returned for page', prefetchPageNumber);
          return;
        }

        // Create and preload the audio element
        const prefetchedAudioElement = new Audio(audioResponse.audioUrl);
        
        // Wait for audio to be ready
        await new Promise<void>((resolve, reject) => {
          prefetchedAudioElement.addEventListener('loadedmetadata', () => resolve());
          prefetchedAudioElement.addEventListener('error', () => reject(new Error('Audio load failed')));
          prefetchedAudioElement.load();
        });

        // Store the prefetched audio
        const prefetchData: PrefetchedAudioData = {
          audio: prefetchedAudioElement,
          url: audioResponse.audioUrl,
          duration: prefetchedAudioElement.duration,
          pageNumber: prefetchPageNumber,
        };

        setPrefetchedAudio(prev => {
          const newMap = new Map(prev);
          newMap.set(prefetchPageNumber, prefetchData);
          return newMap;
        });

        // Only show toast for newly generated audio, not cached
        if (!audioResponse.cached) {
          toast({
            title: "Next Page Ready",
            description: `Page ${prefetchPageNumber} is prepared for playback.`,
            duration: 2000,
          });
        }

      } catch (error) {
        if (error instanceof Error && error.name !== 'AbortError') {
          console.warn('Prefetch failed for page', prefetchPageNumber, error);
        }
      } finally {
        setIsPrefetching(false);
        setPrefetchPageNumber(null);
        prefetchAbortController.current = null;
      }
    };

    processPrefetchPage();
  }, [prefetchPageNumber, currentBook]);

  // Cancel any ongoing prefetch
  const cancelPrefetch = useCallback(() => {
    if (prefetchAbortController.current) {
      prefetchAbortController.current.abort();
      prefetchAbortController.current = null;
    }
    setIsPrefetching(false);
  }, []);

  // Switching voice invalidates loaded and prefetched audio, which belongs to the old voice
  useEffect(() => {
    cancelPrefetch();
    setPrefetchedAudio(new Map());
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    setIsPlaying(false);
    setAudioPausedAt(0);
    setCurrentAudioUrl(null);
    setAudioCurrentTime(0);
    setAudioDuration(0);
  }, [activePersonaId, cancelPrefetch]);

  // Navigation
  const handlePrevPage = useCallback(() => {
    const newPage = Math.max(1, pageNumber - 1);
    if (newPage === pageNumber) return;
    
    setPageNumber(newPage);
    
    // Cancel any ongoing prefetch
    cancelPrefetch();
    
    // Check if we have prefetched audio for this page
    const prefetched = prefetchedAudio.get(newPage);
    
    if (!prefetched) {
      // Reset audio state when changing pages without prefetch
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
      setIsPlaying(false);
      setAudioPausedAt(0);
      setCurrentAudioUrl(null);
      setAudioCurrentTime(0);
      setAudioDuration(0);
    }
    // Keep auto-play enabled on manual navigation
  }, [pageNumber, prefetchedAudio, cancelPrefetch]);
  
  const handleNextPage = useCallback((autoAdvance: boolean = false) => {
    const newPage = pageNumber < (numPages || 0) ? pageNumber + 1 : pageNumber;
    if (newPage === pageNumber) return;
    
    setPageNumber(newPage);
    
    // Cancel any ongoing prefetch
    cancelPrefetch();
    
    // Check if we have prefetched audio for this page
    const prefetched = prefetchedAudio.get(newPage);
    
    if (!prefetched || !autoAdvance) {
      // Reset audio state when changing pages without prefetch
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
      setIsPlaying(false);
      setAudioPausedAt(0);
      setCurrentAudioUrl(null);
      setAudioCurrentTime(0);
      setAudioDuration(0);
    }
    // Keep auto-play enabled on manual navigation
  }, [pageNumber, numPages, prefetchedAudio, cancelPrefetch]);

  const handleReadPage = async (useAutoPlay: boolean = false) => {
    if (isReading || isLoadingPersonas) {
      return;
    }

    // Handle pause
    if (isPlaying) {
      if (audioRef.current) {
        audioRef.current.pause();
        setAudioPausedAt(audioRef.current.currentTime);
        setIsPlaying(false);
      }
      return;
    }

    // Handle resume if same audio exists
    if (audioRef.current && currentAudioUrl && audioPausedAt > 0) {
      audioRef.current.currentTime = audioPausedAt;
      audioRef.current.play().catch(error => {
        toast({ title: "Playback Error", description: error.message, variant: "destructive" });
        setIsPlaying(false);
      });
      setIsPlaying(true);
      return;
    }

    // Check if we have prefetched audio for current page
    const prefetched = prefetchedAudio.get(pageNumber);
    if (prefetched && useAutoPlay) {
      // Use prefetched audio
      if (audioRef.current) {
        audioRef.current.pause();
      }
      
      const prefetchedAudioElement = prefetched.audio;
      audioRef.current = prefetchedAudioElement;
      setCurrentAudioUrl(prefetched.url);
      setAudioDuration(prefetched.duration);
      setAudioPausedAt(0);
      setAudioCurrentTime(0);
      
      // Remove from prefetch cache
      setPrefetchedAudio(prev => {
        const newMap = new Map(prev);
        newMap.delete(pageNumber);
        return newMap;
      });
      
      // Add event listeners to the prefetched audio element
      prefetchedAudioElement.addEventListener('timeupdate', () => {
        setAudioCurrentTime(prefetchedAudioElement.currentTime);
      });
      
      prefetchedAudioElement.addEventListener('playing', () => {
        setIsPlaying(true);
        
        // Start prefetching next page when current audio starts playing
        if (pageNumber < (numPages || 0)) {
          prefetchNextPageAudio(pageNumber + 1);
        }
      });
      
      prefetchedAudioElement.addEventListener('ended', () => {
        setIsPlaying(false);
        setAudioPausedAt(0);
        setAudioCurrentTime(0);
        
        // Auto-advance to next page if enabled
        if (autoPlayEnabled && pageNumber < (numPages || 0)) {
          setShouldAutoPlay(true);
          handleNextPage(true);
        }
      });

      prefetchedAudioElement.addEventListener('error', () => {
        toast({ title: "Error", description: "Could not play audio.", variant: "destructive" });
        setIsPlaying(false);
      });
      
      // Play immediately
      prefetchedAudioElement.play().catch(error => {
        toast({ title: "Playback Error", description: error.message, variant: "destructive" });
        setIsPlaying(false);
      });
      
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

      // 2. Get cached text
      let textResponse;
      try {
        textResponse = await apiService.getCachedPageText(currentBook.id, pageNumber, imageBase64);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : "Cannot connect to backend server. Is it running?";
        toast({ 
          title: "Connection Error", 
          description: errorMessage,
          variant: "destructive" 
        });
        setIsReading(false);
        return;
      }
      
      const textData = textResponse.text;
        
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
        setIsReading(false);
        return;
      }

      // Show cache status for text
      if (textResponse.cached) {
        toast({ 
          title: "Text Loaded from Cache", 
          description: "Previously processed text loaded instantly.",
          duration: 2000
        });
      }

      // 3. Get cached audio
      let audioResponse;
      try {
        audioResponse = await apiService.getCachedPageAudio(currentBook.id, pageNumber, pageText, BASE_VOICE_NAME, false, activePersonaIdRef.current);
      } catch (error) {
        if (error instanceof Error && error.message === "RATE_LIMIT_EXCEEDED") {
          toast({ 
            title: "Rate Limit Reached", 
            description: "Text-to-speech API rate limit reached. Please try again later.",
            duration: 5000
          });
          setIsReading(false);
          return;
        } else {
          toast({ 
            title: "Connection Error", 
            description: "Cannot connect to backend server for audio generation.",
            variant: "destructive" 
          });
          setIsReading(false);
          return;
        }
      }
      
      if (!audioResponse || !audioResponse.audioUrl) {
        throw new Error("Failed to get audio content.");
      }

      // Show cache status for audio
      if (audioResponse.cached) {
        toast({ 
          title: "Audio Loaded from Cache", 
          description: "Previously generated audio loaded instantly.",
          duration: 2000
        });
      }

      // 4. Play audio from URL
      if (audioRef.current) {
        audioRef.current.pause();
      }
      
      const newAudio = new Audio(audioResponse.audioUrl);
      audioRef.current = newAudio;
      setCurrentAudioUrl(audioResponse.audioUrl);
      setAudioPausedAt(0);
      
      // Add event listeners
      newAudio.addEventListener('loadedmetadata', () => {
        setAudioDuration(newAudio.duration);
      });

      newAudio.addEventListener('timeupdate', () => {
        setAudioCurrentTime(newAudio.currentTime);
      });

      newAudio.addEventListener('canplaythrough', () => {
        newAudio.play().catch(error => {
          toast({ title: "Playback Error", description: "Could not play audio: " + error.message, variant: "destructive" });
          setIsPlaying(false);
        });
      });
      
      newAudio.addEventListener('playing', () => {
        setIsPlaying(true);
        
        // Start prefetching next page when current audio starts playing
        if (pageNumber < (numPages || 0)) {
          prefetchNextPageAudio(pageNumber + 1);
        }
      });
      
      newAudio.addEventListener('ended', () => {
        setIsPlaying(false);
        setAudioPausedAt(0);
        setAudioCurrentTime(0);
        
        // Auto-advance to next page if enabled
        if (autoPlayEnabled && pageNumber < (numPages || 0)) {
          setShouldAutoPlay(true); // Flag to trigger auto-play after page change
          handleNextPage(true); // Auto-advance flag
        }
      });

      newAudio.addEventListener('error', (e) => {
        toast({ title: "Error", description: "Could not play audio.", variant: "destructive" });
        setIsPlaying(false);
      });
      
      // Load the audio
      newAudio.load();

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
                onValueChange={(value) => {
                  if (audioRef.current && audioRef.current.readyState >= 2 && audioDuration > 0) {
                    const newTime = (value[0] / 100) * audioDuration;
                    audioRef.current.currentTime = newTime;
                    setAudioCurrentTime(newTime);
                    setAudioPausedAt(newTime);
                  }
                }}
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
