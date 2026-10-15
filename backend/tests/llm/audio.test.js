const { wavInfo, pcmToWav, durationSeconds, pcmFormatFromMime } = require('../../src/services/llm/audio');

const FORMAT = { sampleRate: 24000, channels: 1, bitsPerSample: 16 };

describe('llm/audio', () => {
  describe('pcmToWav and wavInfo', () => {
    it('wraps PCM in a 44-byte header that wavInfo reads back', () => {
      const pcm = Buffer.alloc(96000);
      const wav = pcmToWav({ pcm, ...FORMAT });

      expect(wav.length).toBe(96044);
      expect(wavInfo(wav)).toEqual({ ...FORMAT, dataBytes: 96000, seconds: 2 });
    });

    it('returns null for a buffer that is not RIFF', () => {
      expect(wavInfo(Buffer.from('not a wav file at all'))).toBeNull();
    });

    it('clips a data chunk that declares more bytes than were written', () => {
      const wav = pcmToWav({ pcm: Buffer.alloc(48000), ...FORMAT });
      wav.writeUInt32LE(0xffffffff, 40);

      expect(wavInfo(wav).dataBytes).toBe(48000);
      expect(wavInfo(wav).seconds).toBe(1);
    });

    it('skips chunks that sit before the data chunk', () => {
      const pcm = Buffer.alloc(48000);
      const base = pcmToWav({ pcm, ...FORMAT });
      const list = Buffer.concat([Buffer.from('LIST'), Buffer.from([4, 0, 0, 0]), Buffer.from('INFO')]);
      const wav = Buffer.concat([base.subarray(0, 36), list, base.subarray(36)]);

      expect(wavInfo(wav).seconds).toBe(1);
    });
  });

  describe('durationSeconds', () => {
    it('uses the real sample rate, not a 44.1 kHz stereo assumption', () => {
      const wav = pcmToWav({ pcm: Buffer.alloc(48000 * 27), ...FORMAT });
      expect(durationSeconds(wav)).toBe(27);
    });

    it('accounts for channels and bit depth', () => {
      const wav = pcmToWav({ pcm: Buffer.alloc(44100 * 4 * 3), sampleRate: 44100, channels: 2, bitsPerSample: 16 });
      expect(durationSeconds(wav)).toBe(3);
    });

    it('throws for a non-WAV buffer', () => {
      expect(() => durationSeconds(Buffer.from('nope'))).toThrow('Not a WAV buffer');
    });
  });

  describe('pcmFormatFromMime', () => {
    it('reads the rate and sample width from a Gemini PCM MIME type', () => {
      expect(pcmFormatFromMime('audio/L16;codec=pcm;rate=24000')).toEqual(FORMAT);
    });

    it('falls back to 22.05 kHz mono 16-bit when the MIME type says nothing', () => {
      expect(pcmFormatFromMime('')).toEqual({ sampleRate: 22050, channels: 1, bitsPerSample: 16 });
    });
  });
});
