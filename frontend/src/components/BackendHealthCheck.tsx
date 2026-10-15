import { useEffect, useState } from 'react';
import apiService from '@/services/apiService';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { AlertCircle, CheckCircle } from 'lucide-react';

export function BackendHealthCheck() {
  const [isBackendAvailable, setIsBackendAvailable] = useState<boolean | null>(null);
  const [checkAttempts, setCheckAttempts] = useState(0);
  const [isVisible, setIsVisible] = useState(false);
  const [useAlternateMethod, setUseAlternateMethod] = useState(false);

  useEffect(() => {
    const checkBackendHealth = async () => {
      try {
        let isHealthy = false;

        if (useAlternateMethod) {
          // Try a different approach - simple image-to-text request with minimal data
          try {
            // Send a tiny base64 image (1x1 transparent pixel)
            const minimalPixel = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";
            await apiService.imageToText(minimalPixel);
            isHealthy = true;
          } catch (error) {
            // Silent fail; alternate health check may fail without spamming console
            isHealthy = false;
          }
        } else {
          // Try standard health check first
          isHealthy = await apiService.checkHealth();
        }

        setIsBackendAvailable(isHealthy);
        setIsVisible(true);
        
        if (!isHealthy && checkAttempts < 3) {
          // If standard method fails after first attempt, try alternate method
          if (checkAttempts === 1 && !useAlternateMethod) {
            setUseAlternateMethod(true);
          }
          
          // Retry with increasing delay
          setTimeout(() => {
            setCheckAttempts(prev => prev + 1);
          }, 2000 + (checkAttempts * 1000)); // Increasing backoff
        }
      } catch (error) {
        setIsBackendAvailable(false);
        setIsVisible(true);
        
        // If standard method fails after first attempt, try alternate method
        if (checkAttempts === 1 && !useAlternateMethod) {
          setUseAlternateMethod(true);
        }
        
        if (checkAttempts < 3) {
          // Retry with increasing delay
          setTimeout(() => {
            setCheckAttempts(prev => prev + 1);
          }, 2000 + (checkAttempts * 1000)); // Increasing backoff
        }
      }
    };

    checkBackendHealth();
  }, [checkAttempts, useAlternateMethod]);

  // Auto-hide the success alert after 5 seconds
  useEffect(() => {
    if (isBackendAvailable === true) {
      const timer = setTimeout(() => {
        setIsVisible(false);
      }, 5000);
      return () => clearTimeout(timer);
    }
  }, [isBackendAvailable]);

  if (!isVisible) return null;

  return (
    <div className="fixed bottom-4 end-4 z-50 max-w-md">
      {isBackendAvailable === true && (
        <Alert className="bg-card border-primary">
          <CheckCircle className="h-4 w-4 text-primary" />
          <AlertTitle className="text-primary">Connected</AlertTitle>
          <AlertDescription className="text-muted-foreground">
            Successfully connected to the backend server.
          </AlertDescription>
        </Alert>
      )}
      
      {isBackendAvailable === false && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Connection Error</AlertTitle>
          <AlertDescription>
            Cannot connect to the backend server. Some features may not work properly.
            <div className="mt-2">
              <ul className="list-disc ps-5 text-sm">
                <li>Make sure the backend server is running</li>
                <li>Check if it's running on the correct port (3001)</li>
                <li>Restart the application if problems persist</li>
              </ul>
            </div>
          </AlertDescription>
        </Alert>
      )}
    </div>
  );
}
