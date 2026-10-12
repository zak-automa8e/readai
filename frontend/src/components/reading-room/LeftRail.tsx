import { LayoutGrid, ListTree, PanelLeftClose, StickyNote } from "lucide-react";
import { Button } from "../ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../ui/tabs";
import { useReadingRoom } from "./ReadingRoomContext";
import type { RailTab } from "./hooks/usePaneLayout";

const PLACEHOLDERS: Record<RailTab, string> = {
  pages: "Page thumbnails are not available yet.",
  outline: "The document outline is not available yet.",
  notes: "Notes by page are not available yet.",
};

/** Left pane. Tab content is a placeholder until the rail story fills it. */
export const LeftRail = () => {
  const { panes } = useReadingRoom();

  return (
    <Tabs
      value={panes.railTab}
      onValueChange={(value) => panes.setRailTab(value as RailTab)}
      className="flex h-full min-w-0 flex-col"
    >
      <div className="flex h-11 shrink-0 items-center gap-1 border-b border-border px-2">
        <TabsList className="h-8 min-w-0 flex-1 justify-start bg-transparent p-0">
          <TabsTrigger value="pages" className="h-8 px-2" aria-label="Pages" title="Pages">
            <LayoutGrid className="h-4 w-4" />
          </TabsTrigger>
          <TabsTrigger value="outline" className="h-8 px-2" aria-label="Outline" title="Outline">
            <ListTree className="h-4 w-4" />
          </TabsTrigger>
          <TabsTrigger value="notes" className="h-8 px-2" aria-label="Notes" title="Notes">
            <StickyNote className="h-4 w-4" />
          </TabsTrigger>
        </TabsList>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 shrink-0 text-muted-foreground"
          onClick={panes.toggleRail}
          aria-label="Collapse rail"
          title="Collapse rail"
        >
          <PanelLeftClose className="h-4 w-4" />
        </Button>
      </div>
      {(Object.keys(PLACEHOLDERS) as RailTab[]).map((tab) => (
        <TabsContent key={tab} value={tab} className="mt-0 min-h-0 flex-1 overflow-auto p-4">
          <p className="text-sm text-muted-foreground">{PLACEHOLDERS[tab]}</p>
        </TabsContent>
      ))}
    </Tabs>
  );
};
