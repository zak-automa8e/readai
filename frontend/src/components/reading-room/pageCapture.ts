import type { PdfDocument } from "./ReadingRoomContext";

/**
 * Width every page image sent for text extraction is rendered at, whatever the pane width, zoom or
 * screen density. The hidden prefetch page renders at the same width with a device pixel ratio of 1,
 * so a page captured on screen and a page captured ahead of time give the OCR the same pixels.
 */
export const CAPTURE_WIDTH_PX = 1200;

/** Renders one PDF page straight from pdf.js into a fresh canvas: page pixels only, no text layer. */
export async function renderPageToCanvas(
  pdf: PdfDocument,
  pageNumber: number,
  width: number = CAPTURE_WIDTH_PX
): Promise<HTMLCanvasElement | null> {
  const page = await pdf.getPage(pageNumber);
  const base = page.getViewport({ scale: 1 });
  const viewport = page.getViewport({ scale: width / base.width });
  const canvas = document.createElement("canvas");
  canvas.width = Math.floor(viewport.width);
  canvas.height = Math.floor(viewport.height);
  // Same context options react-pdf uses for the visible page
  const context = canvas.getContext("2d", { alpha: false });
  if (!context) return null;
  await page.render({ canvasContext: context, viewport }).promise;
  return canvas;
}

/** Copies a rendered canvas so later redraws of the source cannot change what is sent. */
export function copyCanvas(source: HTMLCanvasElement): HTMLCanvasElement | null {
  if (!source.width || !source.height) return null;
  const canvas = document.createElement("canvas");
  canvas.width = source.width;
  canvas.height = source.height;
  const context = canvas.getContext("2d");
  if (!context) return null;
  context.drawImage(source, 0, 0);
  return canvas;
}
