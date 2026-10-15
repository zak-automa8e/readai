import { MessageSquare, PanelRightOpen, Sparkles, StickyNote } from "lucide-react";
import { PaneStripButton } from "./PaneStripButton";
import { useReadingRoom } from "./ReadingRoomContext";

export const AIStrip = () => {
  const { panes } = useReadingRoom();

  return (
    <nav className="flex h-full flex-col items-center gap-1 overflow-hidden py-2" aria-label="AI assistant">
      <PaneStripButton icon={PanelRightOpen} label="Expand assistant" onClick={panes.toggleAI} />
      <div className="my-1 h-px w-6 bg-border" aria-hidden="true" />
      <PaneStripButton icon={MessageSquare} label="Chat" onClick={() => panes.openAITab("chat")} />
      <PaneStripButton icon={StickyNote} label="Notes" onClick={() => panes.openAITab("notes")} />
      <PaneStripButton icon={Sparkles} label="Explain" onClick={() => panes.openAITab("explain")} />
    </nav>
  );
};
