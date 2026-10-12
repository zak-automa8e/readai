import { useEffect } from "react";
import { Page } from "react-pdf";
import { useReadingRoom } from "./ReadingRoomContext";

/**
 * The visible PDF page. Must render inside CanvasPane's <Document>.
 * Re-measures on pane resize (dragging a divider resizes the pane without a window resize event).
 */
export const PageCanvas = () => {
  const { canvasRef, pageRef, pageNumber, pageWidth, pageHeight, setCanvasSize } = useReadingRoom();

  useEffect(() => {
    const element = canvasRef.current;
    if (!element) return;

    let frame = 0;
    const measure = () => {
      frame = 0;
      setCanvasSize({ width: element.clientWidth, height: element.clientHeight });
    };
    // Coalesce to one update per frame while a divider is dragged.
    const observer = new ResizeObserver(() => {
      if (!frame) frame = requestAnimationFrame(measure);
    });
    observer.observe(element);
    measure();

    return () => {
      observer.disconnect();
      if (frame) cancelAnimationFrame(frame);
    };
  }, [canvasRef, setCanvasSize]);

  return (
    <div ref={canvasRef} className="h-full min-h-0 flex-1 overflow-auto [scrollbar-gutter:stable]">
      <div className="flex min-h-full w-max min-w-full items-center justify-center p-6">
        <div ref={pageRef} className="pdf-page-container">
          <Page
            pageNumber={pageNumber}
            width={pageWidth}
            height={pageHeight || undefined}
            renderAnnotationLayer={false}
            renderTextLayer={false}
          />
        </div>
      </div>
    </div>
  );
};
