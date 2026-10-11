import { useEffect } from "react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter } from "react-router-dom";
import { updateViewportHeight } from "@/lib/utils";
import { UIProvider } from './contexts/UIContext';
import { BooksProvider } from './contexts/BooksContext';
import { NotesProvider } from './contexts/NotesContext';
import { AuthProvider } from './contexts/AuthContext';
import { BackendHealthCheck } from "./components/BackendHealthCheck";
import { AppRouter } from "./components/AppRouter";
import { ThemeProvider } from "next-themes";

const queryClient = new QueryClient();

const App = () => {
  useEffect(() => {
    // Initialize viewport height
    updateViewportHeight();
    
    // Update on resize and orientation change
    window.addEventListener('resize', updateViewportHeight);
    window.addEventListener('orientationchange', updateViewportHeight);
    
    return () => {
      window.removeEventListener('resize', updateViewportHeight);
      window.removeEventListener('orientationchange', updateViewportHeight);
    };
  }, []);

  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
      <AuthProvider>
        <BooksProvider>
          <NotesProvider>
            <UIProvider>
              <QueryClientProvider client={queryClient}>
                <TooltipProvider>
                  <Toaster />
                  <Sonner />
                  <BackendHealthCheck />
                  <BrowserRouter>
                    <AppRouter />
                  </BrowserRouter>
                </TooltipProvider>
              </QueryClientProvider>
            </UIProvider>
          </NotesProvider>
        </BooksProvider>
      </AuthProvider>
    </ThemeProvider>
  );
};

export default App;
