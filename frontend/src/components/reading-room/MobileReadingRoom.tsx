import { useEffect, type ReactNode } from "react";
import { LayoutGrid, MessageSquare } from "lucide-react";
import { Button } from "../ui/button";
import { Drawer, DrawerContent, DrawerDescription, DrawerTitle } from "../ui/drawer";
import { useReadingRoom } from "./ReadingRoomContext";
import { RoomHeader } from "./RoomHeader";
import { LeftRail } from "./LeftRail";
import { CanvasPane } from "./CanvasPane";
import { PageCanvas } from "./PageCanvas";
import { AIPane } from "./AIPane";
import { NowPlayingBar } from "./NowPlayingBar";

const Sheet = ({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}) => (
  <Drawer open={open} onOpenChange={next => !next && onClose()} shouldScaleBackground={false}>
    <DrawerContent className="h-[85dvh]">
      <DrawerTitle className="sr-only">{title}</DrawerTitle>
      <DrawerDescription className="sr-only">{title} for this book</DrawerDescription>
      <div className="mt-2 min-h-0 flex-1 border-t border-border">{children}</div>
    </DrawerContent>
  </Drawer>
);

/**
 * Reading room under 768px: one page pane, the now-playing bar, and the rail and assistant as
 * bottom sheets opened from the header. A separate tree, so no panel group exists at this width.
 */
export const MobileReadingRoom = () => {
  const { roomRef, pageNumber, panes } = useReadingRoom();
  const { mobileSheet, setMobileSheet } = panes;
  const closeSheet = () => setMobileSheet(null);

  // Picking a page in the rail jumps to it, so the sheet gets out of the way
  useEffect(() => {
    setMobileSheet(current => (current === "rail" ? null : current));
  }, [pageNumber, setMobileSheet]);

  return (
    <div ref={roomRef} className="grid h-full w-full grid-rows-[44px_minmax(0,1fr)_auto] bg-background text-foreground">
      <RoomHeader>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 shrink-0 text-muted-foreground"
          onClick={() => setMobileSheet("rail")}
          aria-label="Pages, outline and notes"
          title="Pages, outline and notes"
        >
          <LayoutGrid className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 shrink-0 text-muted-foreground"
          onClick={() => setMobileSheet("ai")}
          aria-label="Assistant"
          title="Assistant"
        >
          <MessageSquare className="h-4 w-4" />
        </Button>
      </RoomHeader>

      <main className="min-h-0 min-w-0 bg-background">
        <CanvasPane>
          <PageCanvas fixedFit />
        </CanvasPane>
      </main>

      <NowPlayingBar compact />

      <Sheet open={mobileSheet === "rail"} onClose={closeSheet} title="Pages, outline and notes">
        <LeftRail onClose={closeSheet} />
      </Sheet>
      <Sheet open={mobileSheet === "ai"} onClose={closeSheet} title="Assistant">
        <AIPane onClose={closeSheet} />
      </Sheet>
    </div>
  );
};
