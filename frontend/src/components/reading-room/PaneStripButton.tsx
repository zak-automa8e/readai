import type { LucideIcon } from "lucide-react";
import { Button } from "../ui/button";

interface PaneStripButtonProps {
  icon: LucideIcon;
  label: string;
  onClick: () => void;
}

/** One icon in a collapsed pane's strip. */
export const PaneStripButton = ({ icon: Icon, label, onClick }: PaneStripButtonProps) => (
  <Button
    variant="ghost"
    size="icon"
    className="h-8 w-8 shrink-0 text-muted-foreground hover:text-foreground"
    onClick={onClick}
    aria-label={label}
    title={label}
  >
    <Icon className="h-5 w-5" />
  </Button>
);
