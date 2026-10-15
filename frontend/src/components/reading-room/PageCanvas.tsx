import { useState } from "react";
import { Page } from "react-pdf";
import { useReadingRoom } from "./ReadingRoomContext";
import { usePageFit } from "./hooks/usePageFit";
import { SelectionPopover } from "./SelectionPopover";

interface DrawnLayer {
  page: number;
  width: number;
}

/**
 * The visible PDF page. Must render inside CanvasPane's <Document>.
 *
 * While the pane is resizing, the last drawn canvas is CSS-scaled to the live width instead of being
 * redrawn every frame. When a new width settles, the new canvas draws hidden on top of the old one
 * (same grid cell) and replaces it only once it has finished, so the page never flashes blank.
 * `fixedFit` pins fit-width at 100% (mobile).
 */
export const PageCanvas = ({ fixedFit = false }: { fixedFit?: boolean }) => {
  const { canvasRef, pageRef, pageCanvasRef, pdf, pageNumber, fitMode, zoomScale, panes } = useReadingRoom();
  const { displayWidth, renderWidth, aspect } = usePageFit({
    paneRef: canvasRef,
    pdf,
    pageNumber,
    // The mobile room always fits the width at 100%; the saved desktop fit/zoom don't apply
    fitMode: fixedFit ? "width" : fitMode,
    zoomScale: fixedFit ? 100 : zoomScale,
    dividerDragging: panes.dividerDragging,
  });
  const [drawn, setDrawn] = useState<DrawnLayer | null>(null);

  // Keep the last fully drawn width of this page underneath until the new width has drawn
  const layers: number[] = [];
  if (renderWidth !== null) {
    if (drawn && drawn.page === pageNumber && drawn.width !== renderWidth) layers.push(drawn.width);
    layers.push(renderWidth);
  }

  return (
    <div ref={canvasRef} className="h-full min-h-0 flex-1 overflow-auto [scrollbar-gutter:stable]">
      <div className="flex min-h-full w-max min-w-full items-center justify-center p-6">
        {displayWidth !== null && aspect !== null && (
          // The page itself has no reading direction; ltr keeps the scale origin on the drawn corner
          <div
            ref={pageRef}
            dir="ltr"
            className="pdf-page-container grid overflow-hidden bg-card ring-1 ring-border"
            style={{ width: displayWidth, height: Math.floor(displayWidth / aspect) }}
          >
            {layers.map(width => {
              const isCurrent = width === renderWidth;
              const isPending = isCurrent && layers.length > 1;
              const scale = displayWidth / width;
              return (
                <div
                  key={`${pageNumber}@${width}`}
                  className={`[grid-area:1/1] ${isPending ? "invisible" : ""}`}
                  style={scale === 1 ? undefined : { transform: `scale(${scale})`, transformOrigin: "top left" }}
                >
                  <Page
                    pageNumber={pageNumber}
                    width={width}
                    canvasRef={isCurrent ? pageCanvasRef : undefined}
                    loading={null}
                    onRenderSuccess={() => setDrawn({ page: pageNumber, width })}
                    renderAnnotationLayer={false}
                    renderTextLayer={isCurrent}
                  />
                </div>
              );
            })}
          </div>
        )}
      </div>
      <SelectionPopover />
    </div>
  );
};
