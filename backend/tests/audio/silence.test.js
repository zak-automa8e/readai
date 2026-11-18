const { trimSilence } = require('../../src/services/audio/silence');

const RATE = 1000; // 1 frame = 1 ms keeps the arithmetic readable

// mono 16-bit PCM: `lead` ms of silence, `voiced` ms at amplitude `amp`, `tail` ms of silence
function clip(lead, voiced, tail, amp = 4000) {
  const pcm = Buffer.alloc((lead + voiced + tail) * 2);
  for (let i = 0; i < voiced; i++) pcm.writeInt16LE(i % 2 ? amp : -amp, (lead + i) * 2);
  return { pcm, sampleRate: RATE, channels: 1, bitsPerSample: 16, usage: { costUsd: 0.01 } };
}

describe('trimSilence', () => {
  it('cuts the edge silence down to the kept pads and keeps every voiced sample', () => {
    const out = trimSilence(clip(250, 1000, 400), { keepLead: 0.08, keepTail: 0.2 });
    expect(out.pcm.length / 2).toBe(80 + 1000 + 200);
    expect(out.trimmedSeconds).toBeCloseTo(0.37, 5);
    expect(out.pcm.readInt16LE(80 * 2)).toBe(-4000); // first voiced sample sits right after the pad
    expect(out.usage).toEqual({ costUsd: 0.01 }); // the rest of the audio object is carried over
  });

  it('keeps what is there when an edge is shorter than its pad', () => {
    const out = trimSilence(clip(30, 500, 50), { keepLead: 0.08, keepTail: 0.2 });
    expect(out.pcm.length / 2).toBe(580);
    expect(out.trimmedSeconds).toBe(0);
  });

  it('leaves all-silent audio and non-16-bit audio untouched', () => {
    const silent = clip(500, 0, 0);
    expect(trimSilence(silent).pcm).toBe(silent.pcm);
    const eight = { ...clip(100, 100, 100), bitsPerSample: 8 };
    expect(trimSilence(eight).pcm).toBe(eight.pcm);
  });

  it('a quiet sound under the threshold counts as silence; one above it does not', () => {
    // all of it under the threshold = all silence = left as it is (400 frames)
    expect(trimSilence(clip(100, 200, 100, 200), { keepLead: 0, keepTail: 0 }).pcm.length / 2).toBe(400);
    expect(trimSilence(clip(100, 200, 100, 400), { keepLead: 0, keepTail: 0 }).pcm.length / 2).toBe(200);
  });
});
