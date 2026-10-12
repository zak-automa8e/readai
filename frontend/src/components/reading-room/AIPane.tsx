import { PanelRightClose } from "lucide-react";
import { Button } from "../ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../ui/tabs";
import { ChatWindow } from "../ChatWindow";
import { NotesWindow } from "../NotesWindow";
import { useReadingRoom } from "./ReadingRoomContext";
import type { AITab } from "./hooks/usePaneLayout";

/** Right pane: the existing Chat and Notes windows until the AI pane story replaces them. */
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
        <TabsList className="grid h-8 min-w-0 flex-1 grid-cols-2 p-0.5">
          <TabsTrigger value="chat" className="h-7">Chat</TabsTrigger>
          <TabsTrigger value="notes" className="h-7">Notes</TabsTrigger>
        </TabsList>
      </div>
      <TabsContent
        value="chat"
        className="mt-0 min-h-0 flex-1 overflow-hidden p-3 data-[state=active]:flex data-[state=active]:flex-col"
      >
        <ChatWindow />
      </TabsContent>
      <TabsContent
        value="notes"
        className="mt-0 min-h-0 flex-1 overflow-hidden p-3 data-[state=active]:flex data-[state=active]:flex-col"
      >
        <NotesWindow />
      </TabsContent>
    </Tabs>
  );
};
