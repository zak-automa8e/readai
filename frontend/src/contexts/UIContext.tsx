import { createContext, useContext } from 'react';
import { useIsMobile } from '@/hooks/use-mobile';

interface UIContextType {
  isMobile: boolean;
}

const UIContext = createContext<UIContextType | undefined>(undefined);

export function UIProvider({ children }: { children: React.ReactNode }) {
  const isMobile = useIsMobile();

  return (
    <UIContext.Provider value={{ isMobile }}>
      {children}
    </UIContext.Provider>
  );
}

export const useUI = () => {
  const context = useContext(UIContext);
  if (!context) throw new Error('useUI must be used within UIProvider');
  return context;
};
