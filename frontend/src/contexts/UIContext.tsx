import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useIsMobile } from '@/hooks/use-mobile';

export type Lang = 'en' | 'ar';
export type Dir = 'ltr' | 'rtl';

interface UIContextType {
  isMobile: boolean;
  lang: Lang;
  dir: Dir;
  setLang: (lang: Lang) => void;
}

const LANG_STORAGE_KEY = 'readai:lang';

const readStoredLang = (): Lang => {
  try {
    return localStorage.getItem(LANG_STORAGE_KEY) === 'ar' ? 'ar' : 'en';
  } catch {
    return 'en';
  }
};

const UIContext = createContext<UIContextType | undefined>(undefined);

export function UIProvider({ children }: { children: React.ReactNode }) {
  const isMobile = useIsMobile();
  const [lang, setLangState] = useState<Lang>(readStoredLang);
  const dir: Dir = lang === 'ar' ? 'rtl' : 'ltr';

  const setLang = useCallback((next: Lang) => {
    setLangState(next);
    try {
      localStorage.setItem(LANG_STORAGE_KEY, next);
    } catch {
      // Storage unavailable; the choice just won't persist.
    }
  }, []);

  // Must be the document element: react-resizable-panels reads document dir to invert drag deltas.
  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = dir;
  }, [lang, dir]);

  const value = useMemo(() => ({ isMobile, lang, dir, setLang }), [isMobile, lang, dir, setLang]);

  return (
    <UIContext.Provider value={value}>
      {children}
    </UIContext.Provider>
  );
}

export const useUI = () => {
  const context = useContext(UIContext);
  if (!context) throw new Error('useUI must be used within UIProvider');
  return context;
};
