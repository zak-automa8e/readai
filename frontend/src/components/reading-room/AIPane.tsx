import { MessageSquare, PanelRightClose, Sparkles, StickyNote } from "lucide-react";
import { Button } from "../ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../ui/tabs";
import { ChatWindow } from "../ChatWindow";
import { NotesWindow } from "../NotesWindow";
import { ExplainTab } from "./ExplainTab";
import { useReadingRoom } from "./ReadingRoomContext";
import type { AITab } from "./hooks/usePaneLayout";

const TABS: { value: AITab; label: string; icon: typeof MessageSquare }[] = [
  { value: "chat", label: "Chat", icon: MessageSquare },
  { value: "notes", label: "Notes", icon: StickyNote },
  { value: "explain", label: "Explain", icon: Sparkles },
];

const contentClass =
  "mt-0 min-h-0 flex-1 overflow-hidden p-3 data-[state=active]:flex data-[state=active]:flex-col";

/** Right pane: Chat | Notes | Explain over the book's shared conversation (AssistantContext). */
export const AIPane = () => {
  const { panes } = useReadingRoom();

  return (
    <Tabs
      value={panes.aiTab}
      onValueChange={(value) => panes.setAITab(value as AITab)}
      className="flex h-full min-w-0 flex-col"
    >
      <div className="flex h-11 shrink-0 items-center gap-1 border-b border-border px-2">
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 shrink-0 text-muted-foreground"
          onClick={panes.toggleAI}
          aria-label="Collapse assistant"
          title="Collapse assistant"
        >
          <PanelRightClose className="h-4 w-4" />
        </Button>
        <TabsList className="grid h-8 min-w-0 flex-1 grid-cols-3 p-0.5">
          {TABS.map(({ value, label, icon: Icon }) => (
            <TabsTrigger key={value} value={value} className="h-7 min-w-0 gap-1 px-1" title={label}>
              <Icon className="h-4 w-4 shrink-0" />
              <span className="truncate">{label}</span>
            </TabsTrigger>
          ))}
        </TabsList>
      </div>
      <TabsContent value="chat" className={contentClass}>
        <ChatWindow />
      </TabsContent>
      <TabsContent value="notes" className={contentClass}>
        <NotesWindow />
      </TabsContent>
      <TabsContent value="explain" className={contentClass}>
        <ExplainTab />
      </TabsContent>
    </Tabs>
  );
};
