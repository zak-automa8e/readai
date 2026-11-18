/**
 * Trim the silence the speech model leaves at both ends of a clip (measured 2026-11-18: 0.2–0.3 s
 * before the voice, 0.15–0.5 s after it). Paragraph clips play back to back, so that silence was
 * heard as a pause of up to a second at every paragraph and heading. A short pad is kept on each
 * side so soft first and last sounds are not cut and paragraphs still breathe.
 */

// ~ -40 dBFS on 16-bit samples: below the quietest voiced sound in the measured clips
const THRESHOLD = 330;
const KEEP_LEAD_SECONDS = 0.08;
const KEEP_TAIL_SECONDS = 0.2;

/**
 * @param {{pcm: Buffer, sampleRate: number, channels: number, bitsPerSample: number}} audio 16-bit little-endian PCM
 * @param {{threshold?: number, keepLead?: number, keepTail?: number}} [options]
 * @returns {{pcm: Buffer, sampleRate: number, channels: number, bitsPerSample: number, trimmedSeconds: number}}
 *   the same audio object shape with `pcm` trimmed; unchanged when it is all silence or not 16-bit
 */
function trimSilence(audio, { threshold = THRESHOLD, keepLead = KEEP_LEAD_SECONDS, keepTail = KEEP_TAIL_SECONDS } = {}) {
  const { pcm, sampleRate, channels, bitsPerSample } = audio;
  if (bitsPerSample !== 16 || !pcm?.length) return { ...audio, trimmedSeconds: 0 };
  const frameBytes = 2 * channels;
  const frames = Math.floor(pcm.length / frameBytes);
  const loud = (frame) => {
    for (let c = 0; c < channels; c++) {
      if (Math.abs(pcm.readInt16LE(frame * frameBytes + c * 2)) >= threshold) return true;
    }
    return false;
  };

  let first = 0;
  while (first < frames && !loud(first)) first++;
  if (first === frames) return { ...audio, trimmedSeconds: 0 };
  let last = frames - 1;
  while (last > first && !loud(last)) last--;

  const start = Math.max(0, first - Math.round(keepLead * sampleRate));
  const end = Math.min(frames, last + 1 + Math.round(keepTail * sampleRate));
  const trimmed = pcm.subarray(start * frameBytes, end * frameBytes);
  return { ...audio, pcm: trimmed, trimmedSeconds: (frames - (end - start)) / sampleRate };
}

module.exports = { trimSilence, THRESHOLD, KEEP_LEAD_SECONDS, KEEP_TAIL_SECONDS };
