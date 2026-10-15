import { useCallback, useMemo, useRef, useState } from "react";
import type { ImperativePanelHandle } from "react-resizable-panels";

export type RailTab = "pages" | "outline" | "notes";
export type AITab = "chat" | "notes" | "explain";

/** Sizes are percentages of the panel group width (react-resizable-panels 2.x has no pixel units). */
export const PANE_SIZES = {
  rail: { defaultSize: 18, minSize: 14, collapsedSize: 4 },
  canvas: { defaultSize: 54, minSize: 30 },
  ai: { defaultSize: 28, minSize: 22, collapsedSize: 4 },
} as const;

/** localStorage key suffix; the library stores it as `react-resizable-panels:<autoSaveId>`. */
export const paneLayoutSaveId = (bookId: string) => `readai:room:${bookId}`;

const togglePanel = (panel: ImperativePanelHandle | null) => {
  if (!panel) return;
  if (panel.isCollapsed()) panel.expand();
  else panel.collapse();
};

export const usePaneLayout = () => {
  const railRef = useRef<ImperativePanelHandle>(null);
  const aiRef = useRef<ImperativePanelHandle>(null);
  // Driven by the panels' onCollapse/onExpand callbacks, which the library fires from the same
  // layout effect that restores the saved layout, so the strip/full view is settled before paint.
  const [railCollapsed, setRailCollapsed] = useState(false);
  const [aiCollapsed, setAICollapsed] = useState(false);
  const [railTab, setRailTab] = useState<RailTab>("pages");
  const [aiTab, setAITab] = useState<AITab>("chat");
  // True while either divider is held; the page canvas defers redraws until release
  const [dividerDragging, setDividerDragging] = useState(false);
  const onDividerDragging = useCallback((isDragging: boolean) => setDividerDragging(isDragging), []);

  const toggleRail = useCallback(() => togglePanel(railRef.current), []);
  const toggleAI = useCallback(() => togglePanel(aiRef.current), []);

  const openRailTab = useCallback((tab: RailTab) => {
    setRailTab(tab);
    railRef.current?.expand();
  }, []);

  const openAITab = useCallback((tab: AITab) => {
    setAITab(tab);
    aiRef.current?.expand();
  }, []);

  const onRailCollapse = useCallback(() => setRailCollapsed(true), []);
  const onRailExpand = useCallback(() => setRailCollapsed(false), []);
  const onAICollapse = useCallback(() => setAICollapsed(true), []);
  const onAIExpand = useCallback(() => setAICollapsed(false), []);

  return useMemo(
    () => ({
      railRef,
      aiRef,
      railCollapsed,
      aiCollapsed,
      railTab,
      setRailTab,
      aiTab,
      setAITab,
      toggleRail,
      toggleAI,
      openRailTab,
      openAITab,
      onRailCollapse,
      onRailExpand,
      onAICollapse,
      onAIExpand,
      dividerDragging,
      onDividerDragging,
    }),
    [
      dividerDragging,
      onDividerDragging,
      railCollapsed,
      aiCollapsed,
      railTab,
      aiTab,
      toggleRail,
      toggleAI,
      openRailTab,
      openAITab,
      onRailCollapse,
      onRailExpand,
      onAICollapse,
      onAIExpand,
    ]
  );
};

export type PaneLayout = ReturnType<typeof usePaneLayout>;
