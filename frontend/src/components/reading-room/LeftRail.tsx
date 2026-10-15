import { LayoutGrid, ListTree, PanelLeftClose, StickyNote, X } from "lucide-react";
import { Button } from "../ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../ui/tabs";
import { useReadingRoom } from "./ReadingRoomContext";
import { ThumbnailList } from "./ThumbnailList";
import { OutlineList } from "./OutlineList";
import { RailNotes } from "./RailNotes";
import type { RailTab } from "./hooks/usePaneLayout";

/** Left pane: page thumbnails, document outline, and notes by page. */
export const LeftRail = ({ onClose }: { onClose?: () => void }) => {
  const { panes } = useReadingRoom();
  const CollapseIcon = onClose ? X : PanelLeftClose;
  const collapseLabel = onClose ? "Close" : "Collapse rail";

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
          onClick={onClose ?? panes.toggleRail}
          aria-label={collapseLabel}
          title={collapseLabel}
        >
          <CollapseIcon className={onClose ? "h-4 w-4" : "h-4 w-4 rtl:rotate-180"} />
        </Button>
      </div>
      <TabsContent value="pages" className="mt-0 min-h-0 flex-1 overflow-hidden">
        <ThumbnailList />
      </TabsContent>
      <TabsContent value="outline" className="mt-0 min-h-0 flex-1 overflow-auto p-2">
        <OutlineList />
      </TabsContent>
      <TabsContent value="notes" className="mt-0 min-h-0 flex-1 overflow-auto p-2">
        <RailNotes />
      </TabsContent>
    </Tabs>
  );
};
