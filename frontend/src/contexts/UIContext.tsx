import { createContext, useContext, useState, useEffect } from 'react';
import { useIsMobile } from '@/hooks/use-mobile';

interface UIContextType {
  isAICollapsed: boolean;
  setIsAICollapsed: (collapsed: boolean) => void;
  isMobile: boolean;
}

const UIContext = createContext<UIContextType | undefined>(undefined);

export function UIProvider({ children }: { children: React.ReactNode }) {
  const [isAICollapsed, setIsAICollapsed] = useState(false);
  const isMobile = useIsMobile();
  
  // Auto-collapse on mobile when component mounts
  useEffect(() => {
    if (isMobile) {
      setIsAICollapsed(true);
    }
  }, [isMobile]);
  
  return (
    <UIContext.Provider value={{ isAICollapsed, setIsAICollapsed, isMobile }}>
      {children}
    </UIContext.Provider>
  );
}

export const useUI = () => {
  const context = useContext(UIContext);
  if (!context) throw new Error('useUI must be used within UIProvider');
  return context;
};
