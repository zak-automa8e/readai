import { LayoutGrid, ListTree, PanelLeftOpen, StickyNote } from "lucide-react";
import { PaneStripButton } from "./PaneStripButton";
import { useReadingRoom } from "./ReadingRoomContext";

export const RailStrip = () => {
  const { panes } = useReadingRoom();

  return (
    <nav className="flex h-full flex-col items-center gap-1 overflow-hidden py-2" aria-label="Reading rail">
      <PaneStripButton icon={PanelLeftOpen} label="Expand rail" onClick={panes.toggleRail} mirror />
      <div className="my-1 h-px w-6 bg-border" aria-hidden="true" />
      <PaneStripButton icon={LayoutGrid} label="Pages" onClick={() => panes.openRailTab("pages")} />
      <PaneStripButton icon={ListTree} label="Outline" onClick={() => panes.openRailTab("outline")} />
      <PaneStripButton icon={StickyNote} label="Notes" onClick={() => panes.openRailTab("notes")} />
    </nav>
  );
};
