const { createWavHeader, parseMimeType } = require('../../utils/audioUtils');

/**
 * Read the format and length of a WAV buffer by walking its RIFF chunks.
 * @param {Buffer} buf
 * @returns {{sampleRate: number, channels: number, bitsPerSample: number, dataBytes: number, seconds: number}|null}
 */
function wavInfo(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 12 || buf.toString('ascii', 0, 4) !== 'RIFF') return null;
  let offset = 12;
  let fmt = null;
  let dataBytes = 0;
  while (offset + 8 <= buf.length) {
    const id = buf.toString('ascii', offset, offset + 4);
    const size = buf.readUInt32LE(offset + 4);
    if (id === 'fmt ') {
      fmt = {
        channels: buf.readUInt16LE(offset + 10),
        sampleRate: buf.readUInt32LE(offset + 12),
        bitsPerSample: buf.readUInt16LE(offset + 22),
      };
    }
    if (id === 'data') {
      // Streamed WAVs can declare a size larger than what was written
      dataBytes = Math.min(size, buf.length - offset - 8);
      break;
    }
    offset += 8 + size + (size % 2);
  }
  if (!fmt) return null;
  const bytesPerSecond = fmt.sampleRate * fmt.channels * fmt.bitsPerSample / 8;
  return { ...fmt, dataBytes, seconds: dataBytes / bytesPerSecond };
}

/**
 * Wrap raw PCM samples in a WAV container.
 * @param {{pcm: Buffer, sampleRate: number, channels: number, bitsPerSample: number}} audio
 * @returns {Buffer}
 */
function pcmToWav({ pcm, sampleRate, channels, bitsPerSample }) {
  const header = createWavHeader(pcm.length, { numChannels: channels, sampleRate, bitsPerSample });
  return Buffer.concat([header, pcm]);
}

/**
 * Duration of a WAV buffer, from its header.
 * @param {Buffer} wav
 * @returns {number} seconds
 */
function durationSeconds(wav) {
  const info = wavInfo(wav);
  if (!info) throw new Error('Not a WAV buffer');
  return info.seconds;
}

/**
 * Format of raw PCM described by a MIME type such as "audio/L16;codec=pcm;rate=24000".
 * @param {string} mimeType
 * @returns {{sampleRate: number, channels: number, bitsPerSample: number}}
 */
function pcmFormatFromMime(mimeType) {
  const { sampleRate, numChannels, bitsPerSample } = parseMimeType(mimeType || '');
  return { sampleRate, channels: numChannels, bitsPerSample };
}

module.exports = { wavInfo, pcmToWav, durationSeconds, pcmFormatFromMime };
