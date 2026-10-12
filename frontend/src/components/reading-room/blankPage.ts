// A page counts as blank when almost no pixels differ from its background.
// Scanned pages carry speckle and a grey tint, so we compare against the median
// luminance rather than pure white and allow a small fraction of noise.
// Thresholds lean towards "not blank": a missed blank page only costs one
// extraction call, while a false positive would skip real text.
const SAMPLE_WIDTH = 300;
const INK_DELTA = 50;
const MAX_INK_FRACTION = 0.0015;

export function isBlankCanvas(source: HTMLCanvasElement): boolean {
  if (!source.width || !source.height) return false;

  const width = Math.min(SAMPLE_WIDTH, source.width);
  const height = Math.max(1, Math.round((source.height / source.width) * width));
  const sample = document.createElement('canvas');
  sample.width = width;
  sample.height = height;
  const ctx = sample.getContext('2d', { willReadFrequently: true });
  if (!ctx) return false;
  ctx.drawImage(source, 0, 0, width, height);

  const { data } = ctx.getImageData(0, 0, width, height);
  const luminance = new Uint8Array(width * height);
  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    luminance[p] = (data[i] * 299 + data[i + 1] * 587 + data[i + 2] * 114) / 1000;
  }

  const sorted = Uint8Array.from(luminance).sort();
  const background = sorted[sorted.length >> 1];
  let ink = 0;
  for (const value of luminance) {
    if (Math.abs(value - background) > INK_DELTA) ink++;
  }
  return ink / luminance.length < MAX_INK_FRACTION;
}
