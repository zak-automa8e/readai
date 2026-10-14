import { useEffect, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { useReadingRoom, type PdfDocument } from "./ReadingRoomContext";

type OutlineItems = NonNullable<Awaited<ReturnType<PdfDocument["getOutline"]>>>;
type OutlineItem = OutlineItems[number];

/** Destinations are a name or an explicit array whose first entry is a page reference or index. */
const resolvePageNumber = async (pdf: PdfDocument, dest: OutlineItem["dest"]): Promise<number | null> => {
  try {
    const explicit = typeof dest === "string" ? await pdf.getDestination(dest) : dest;
    if (!Array.isArray(explicit)) return null;
    const target = explicit[0];
    if (typeof target === "number") return target + 1;
    if (target && typeof target === "object") return (await pdf.getPageIndex(target)) + 1;
  } catch {
    // An unresolvable destination is treated as no jump target
  }
  return null;
};

interface OutlineNodeProps {
  item: OutlineItem;
  depth: number;
  onJump: (dest: OutlineItem["dest"]) => void;
}

const OutlineNode = ({ item, depth, onJump }: OutlineNodeProps) => {
  const [open, setOpen] = useState(depth < 1);
  const hasChildren = item.items.length > 0;
  const Chevron = open ? ChevronDown : ChevronRight;

  return (
    <li>
      <div
        className="flex items-start gap-1 rounded-sm pe-2 hover:bg-muted"
        style={{ paddingInlineStart: depth * 12 + 4 }}
      >
        {hasChildren ? (
          <button
            type="button"
            onClick={() => setOpen(value => !value)}
            aria-expanded={open}
            aria-label={open ? "Collapse section" : "Expand section"}
            className="mt-1 flex h-5 w-5 shrink-0 items-center justify-center rounded-sm text-muted-foreground hover:text-foreground"
          >
            <Chevron className="h-4 w-4 rtl:-scale-x-100" />
          </button>
        ) : (
          <span className="w-5 shrink-0" aria-hidden="true" />
        )}
        {item.dest ? (
          <button
            type="button"
            onClick={() => onJump(item.dest)}
            dir="auto"
            className={`min-w-0 flex-1 break-words py-1 text-start font-serif text-sm ${item.bold ? "font-semibold" : ""} ${item.italic ? "italic" : ""}`}
          >
            {item.title}
          </button>
        ) : (
          <span
            dir="auto"
            className="min-w-0 flex-1 break-words py-1 text-start font-serif text-sm text-muted-foreground"
          >
            {item.title}
          </span>
        )}
      </div>
      {hasChildren && open && (
        <ul>
          {item.items.map((child, index) => (
            <OutlineNode key={index} item={child} depth={depth + 1} onJump={onJump} />
          ))}
        </ul>
      )}
    </li>
  );
};

/** The PDF's table of contents, nested; read from the shared PDF proxy. */
export const OutlineList = () => {
  const { pdf, numPages, goToPage } = useReadingRoom();
  const [outline, setOutline] = useState<OutlineItems | null | undefined>(undefined);

  useEffect(() => {
    if (!pdf) return;
    let cancelled = false;
    setOutline(undefined);
    pdf
      .getOutline()
      .then(result => {
        if (!cancelled) setOutline(result);
      })
      .catch(() => {
        if (!cancelled) setOutline(null);
      });
    return () => {
      cancelled = true;
    };
  }, [pdf]);

  if (!pdf || outline === undefined) {
    return <p className="p-2 text-sm text-muted-foreground">Loading outline...</p>;
  }

  if (!outline || outline.length === 0) {
    return <p className="p-2 text-sm text-muted-foreground">This book has no table of contents</p>;
  }

  const onJump = async (dest: OutlineItem["dest"]) => {
    const page = await resolvePageNumber(pdf, dest);
    if (page && numPages && page >= 1 && page <= numPages) goToPage(page);
  };

  return (
    <ul aria-label="Table of contents">
      {outline.map((item, index) => (
        <OutlineNode key={index} item={item} depth={0} onJump={onJump} />
      ))}
    </ul>
  );
};
