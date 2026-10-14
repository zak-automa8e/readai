import { useState, useRef, useEffect, useCallback, type RefObject } from "react";
import { toast } from "@/hooks/use-toast";
import apiService from "@/services/apiService";
import type { Book } from "@/contexts/BooksContext";
import { BASE_VOICE_NAME } from "./useVoiceChoice";
import { isBlankCanvas } from "../blankPage";

interface PrefetchedAudioData {
  audio: HTMLAudioElement;
  url: string;
  duration: number;
  pageNumber: number;
}

interface UsePageAudioParams {
  currentBook: Book | null;
  pageNumber: number;
  setPageNumber: (page: number) => void;
  numPages: number | null;
  activePersonaId: string | null;
  activePersonaIdRef: RefObject<string | null>;
  isLoadingPersonas: boolean;
  pageRef: RefObject<HTMLDivElement>;
  capturePage: () => Promise<HTMLCanvasElement | null>;
}

export const usePageAudio = ({
  currentBook,
  pageNumber,
  setPageNumber,
  numPages,
  activePersonaId,
  activePersonaIdRef,
  isLoadingPersonas,
  pageRef,
  capturePage,
}: UsePageAudioParams) => {
  const [isPlaying, setIsPlaying] = useState(false);
  const [isReading, setIsReading] = useState(false); // For loading state
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
  const audioRef = useRef<HTMLAudioElement | null>(null);
  // Pages found to have nothing to read; auto-play and prefetch step over them
  const emptyPagesRef = useRef<Set<number>>(new Set());

  // First page at or after `from` not known to be empty, or null past the end
  const nextReadablePage = useCallback((from: number) => {
    let page = from;
    while (page <= (numPages || 0) && emptyPagesRef.current.has(page)) page++;
    return page <= (numPages || 0) ? page : null;
  }, [numPages]);

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

  // Auto-play effect: triggers playback when page changes during auto-play
  useEffect(() => {
    if (shouldAutoPlay && !isPlaying && !isReading) {
      setShouldAutoPlay(false);
      handleReadPage(true);
    }
  }, [pageNumber, shouldAutoPlay, isPlaying, isReading]);

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

      // Set when this page has nothing to read, so the prefetch moves on to the next one
      let skipTo: number | null = null;

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

        if (isBlankCanvas(canvas)) {
          emptyPagesRef.current.add(prefetchPageNumber);
          skipTo = nextReadablePage(prefetchPageNumber + 1);
          return;
        }
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
          emptyPagesRef.current.add(prefetchPageNumber);
          skipTo = nextReadablePage(prefetchPageNumber + 1);
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
        // A cancelled prefetch has already cleared the controller, so it never chains
        const stillActive = prefetchAbortController.current && !prefetchAbortController.current.signal.aborted;
        if (skipTo && stillActive && !prefetchedAudio.has(skipTo)) {
          prefetchAbortController.current = new AbortController();
          setPrefetchPageNumber(skipTo);
        } else {
          setIsPrefetching(false);
          setPrefetchPageNumber(null);
          prefetchAbortController.current = null;
        }
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
    // Auto-advance steps over pages known to be empty; manual navigation still shows them
    const target = autoAdvance ? nextReadablePage(pageNumber + 1) : pageNumber + 1;
    const newPage = target && target <= (numPages || 0) ? target : pageNumber;
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
  }, [pageNumber, numPages, prefetchedAudio, cancelPrefetch, nextReadablePage]);

  // Jump to any page (page counter, later the rail). Same reset as a manual handleNextPage:
  // the current page's audio always stops, even when the target page is already prefetched,
  // otherwise the old page keeps playing over the new one. Prefetched audio stays cached.
  const goToPage = useCallback((target: number) => {
    if (!numPages || !Number.isFinite(target)) return;
    const newPage = Math.min(numPages, Math.max(1, Math.round(target)));
    if (newPage === pageNumber) return;

    setPageNumber(newPage);

    // Cancel any ongoing prefetch
    cancelPrefetch();

    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    setIsPlaying(false);
    setAudioPausedAt(0);
    setCurrentAudioUrl(null);
    setAudioCurrentTime(0);
    setAudioDuration(0);
    // Keep auto-play enabled on manual navigation
  }, [pageNumber, numPages, cancelPrefetch, setPageNumber]);

  // forceRefresh re-extracts the page text and regenerates its audio, bypassing both caches
  const handleReadPage = async (useAutoPlay: boolean = false, forceRefresh: boolean = false) => {
    if (isReading || isLoadingPersonas) {
      return;
    }

    // Handle pause
    if (isPlaying && !forceRefresh) {
      if (audioRef.current) {
        audioRef.current.pause();
        setAudioPausedAt(audioRef.current.currentTime);
        setIsPlaying(false);
      }
      return;
    }

    // Handle resume if same audio exists
    if (!forceRefresh && audioRef.current && currentAudioUrl && audioPausedAt > 0) {
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
    if (prefetched && useAutoPlay && !forceRefresh) {
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
        const nextPage = nextReadablePage(pageNumber + 1);
        if (nextPage) {
          prefetchNextPageAudio(nextPage);
        }
      });
      
      prefetchedAudioElement.addEventListener('ended', () => {
        setIsPlaying(false);
        setAudioPausedAt(0);
        setAudioCurrentTime(0);
        
        // Auto-advance to next page if enabled
        if (autoPlayEnabled && nextReadablePage(pageNumber + 1)) {
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
    const canvas = await capturePage();

    if (!canvas) {
      toast({ title: "Capture Failed", description: "Could not capture the current page content.", variant: "destructive" });
      setIsReading(false);
      return;
    }

      // Nothing to read on this page: remember it, and keep going when auto-play is on
      const handleEmptyPage = () => {
        emptyPagesRef.current.add(pageNumber);
        if (autoPlayEnabled && nextReadablePage(pageNumber + 1)) {
          toast({ title: "Blank Page Skipped", description: `Page ${pageNumber} has nothing to read.`, duration: 2000 });
          setShouldAutoPlay(true);
          handleNextPage(true);
        } else {
          toast({ title: "No Text Found", description: "Could not find any text on the current page." });
        }
      };

      // Blank pages are never sent for text extraction
      if (isBlankCanvas(canvas)) {
        handleEmptyPage();
        return;
      }
      const imageBase64 = canvas.toDataURL('image/png');

      // 2. Get cached text
      let textResponse;
      try {
        textResponse = await apiService.getCachedPageText(currentBook.id, pageNumber, imageBase64, forceRefresh);
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
        handleEmptyPage();
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
        audioResponse = await apiService.getCachedPageAudio(currentBook.id, pageNumber, pageText, BASE_VOICE_NAME, forceRefresh, activePersonaIdRef.current);
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
        const nextPage = nextReadablePage(pageNumber + 1);
        if (nextPage) {
          prefetchNextPageAudio(nextPage);
        }
      });
      
      newAudio.addEventListener('ended', () => {
        setIsPlaying(false);
        setAudioPausedAt(0);
        setAudioCurrentTime(0);
        
        // Auto-advance to next page if enabled
        if (autoPlayEnabled && nextReadablePage(pageNumber + 1)) {
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

  // Re-extract and re-voice the current page when its cached text or audio came out wrong
  const redoPage = () => {
    if (isReading || isLoadingPersonas) return;
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    setIsPlaying(false);
    setAudioPausedAt(0);
    setCurrentAudioUrl(null);
    setAudioCurrentTime(0);
    setAudioDuration(0);
    emptyPagesRef.current.delete(pageNumber);
    setPrefetchedAudio(prev => {
      if (!prev.has(pageNumber)) return prev;
      const next = new Map(prev);
      next.delete(pageNumber);
      return next;
    });
    handleReadPage(false, true);
  };

  const handleSeek = (percent: number) => {
    if (audioRef.current && audioRef.current.readyState >= 2 && audioDuration > 0) {
      const newTime = (percent / 100) * audioDuration;
      audioRef.current.currentTime = newTime;
      setAudioCurrentTime(newTime);
      setAudioPausedAt(newTime);
    }
  };

  return {
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
    goToPage,
    redoPage,
    handleSeek,
  };
};
