import { useUI } from "@/contexts/UIContext";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "../ui/resizable";
import { useReadingRoom } from "./ReadingRoomContext";
import { RoomHeader } from "./RoomHeader";
import { LeftRail } from "./LeftRail";
import { RailStrip } from "./RailStrip";
import { CanvasPane } from "./CanvasPane";
import { PageCanvas } from "./PageCanvas";
import { AIPane } from "./AIPane";
import { AIStrip } from "./AIStrip";
import { NowPlayingBar } from "./NowPlayingBar";
import { MobileReadingRoom } from "./MobileReadingRoom";
import { PANE_SIZES, paneLayoutSaveId } from "./hooks/usePaneLayout";

/**
 * Reading room shell. Three grid rows own the layout: header strip, one horizontal panel group,
 * and the full-width now-playing bar. Nothing here is positioned; edges align by construction.
 */
export const ReadingRoom = () => {
  const { book, panes, roomRef } = useReadingRoom();
  const { isMobile } = useUI();

  // A separate tree: panels are never mounted conditionally inside the group
  if (isMobile) return <MobileReadingRoom />;

  return (
    <div ref={roomRef} className="grid h-full w-full grid-rows-[44px_minmax(0,1fr)_auto] bg-background text-foreground">
      <RoomHeader />

      <ResizablePanelGroup
        key={book.id}
        direction="horizontal"
        autoSaveId={paneLayoutSaveId(book.id)}
        className="min-h-0"
      >
        <ResizablePanel
          id="rail"
          order={1}
          ref={panes.railRef}
          collapsible
          {...PANE_SIZES.rail}
          onCollapse={panes.onRailCollapse}
          onExpand={panes.onRailExpand}
          className="bg-card"
        >
          {/* Both views stay mounted so collapsing never resets pane state */}
          <div className={panes.railCollapsed ? "hidden" : "h-full"}>
            <LeftRail />
          </div>
          <div className={panes.railCollapsed ? "h-full" : "hidden"}>
            <RailStrip />
          </div>
        </ResizablePanel>

        <ResizableHandle onDragging={panes.onDividerDragging} />

        <ResizablePanel id="canvas" order={2} {...PANE_SIZES.canvas} className="min-w-0 bg-background">
          <CanvasPane>
            <PageCanvas />
          </CanvasPane>
        </ResizablePanel>

        <ResizableHandle onDragging={panes.onDividerDragging} />

        <ResizablePanel
          id="ai"
          order={3}
          ref={panes.aiRef}
          collapsible
          {...PANE_SIZES.ai}
          onCollapse={panes.onAICollapse}
          onExpand={panes.onAIExpand}
          className="bg-card"
        >
          <div className={panes.aiCollapsed ? "hidden" : "h-full"}>
            <AIPane />
          </div>
          <div className={panes.aiCollapsed ? "h-full" : "hidden"}>
            <AIStrip />
          </div>
        </ResizablePanel>
      </ResizablePanelGroup>

      <NowPlayingBar />
    </div>
  );
};
