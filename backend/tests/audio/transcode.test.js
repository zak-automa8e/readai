const { spawnSync } = require('child_process');
const { pcmToOggOpus } = require('../../src/services/audio/transcode');

const hasFfmpeg = !spawnSync('ffmpeg', ['-version']).error;

// 1 s of a 440 Hz tone, 24 kHz mono 16-bit
function tone(seconds = 1, rate = 24000) {
  const pcm = Buffer.alloc(seconds * rate * 2);
  for (let i = 0; i < seconds * rate; i++) pcm.writeInt16LE(Math.round(Math.sin((2 * Math.PI * 440 * i) / rate) * 8000), i * 2);
  return { pcm, sampleRate: rate, channels: 1, bitsPerSample: 16 };
}

describe('pcmToOggOpus', () => {
  (hasFfmpeg ? it : it.skip)('encodes PCM to a much smaller Ogg Opus stream (needs ffmpeg)', async () => {
    const audio = tone(2);
    const ogg = await pcmToOggOpus(audio, { bitrateKbps: 32 });
    expect(ogg.toString('ascii', 0, 4)).toBe('OggS');
    expect(ogg.includes(Buffer.from('OpusHead'))).toBe(true);
    expect(ogg.length).toBeLessThan(audio.pcm.length / 5);
  });

  it('rejects with ENOENT when the binary is missing', async () => {
    await expect(pcmToOggOpus(tone(1), { command: 'ffmpeg-not-installed-here' })).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('refuses PCM that is not 16-bit', async () => {
    await expect(pcmToOggOpus({ ...tone(1), bitsPerSample: 24 })).rejects.toThrow(/16-bit/);
  });
});
