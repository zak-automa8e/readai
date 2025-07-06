export interface PDFPageProxy {
  getViewport: (options: { scale: number }) => {
    width: number;
    height: number;
  };
  render: (options: {
    canvasContext: CanvasRenderingContext2D;
    viewport: { width: number; height: number };
  }) => { promise: Promise<void> };
}

export interface PDFDocumentProxy {
  getPage: (pageNum: number) => Promise<PDFPageProxy>;
  numPages: number;
}
