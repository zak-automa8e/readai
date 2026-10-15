const config = require('../config');

/**
 * Utility functions for audio processing
 */

/**
 * Converts raw audio data to WAV format
 * @param {string} rawData - Base64 encoded audio data
 * @param {string} mimeType - MIME type of the audio data
 * @returns {Buffer} - WAV formatted audio buffer
 */
function convertToWav(rawData, mimeType) {
  const options = parseMimeType(mimeType);
  const buffer = Buffer.from(rawData, 'base64');
  const wavHeader = createWavHeader(buffer.length, options);
  return Buffer.concat([wavHeader, buffer]);
}

/**
 * Parses MIME type to extract audio format parameters
 * @param {string} mimeType - MIME type string
 * @returns {Object} - Audio options (numChannels, sampleRate, bitsPerSample)
 */
function parseMimeType(mimeType) {
  const [fileType, ...params] = mimeType.split(';').map(s => s.trim());
  const [_, format] = fileType.split('/');

  const options = {
    numChannels: 1,
    sampleRate: 22050, // Default sample rate
    bitsPerSample: 16, // Default bits per sample
  };

  if (format && format.startsWith('L')) {
    const bits = parseInt(format.slice(1), 10);
    if (!isNaN(bits)) {
      options.bitsPerSample = bits;
    }
  }

  for (const param of params) {
    const [key, value] = param.split('=').map(s => s.trim());
    if (key === 'rate') {
      const rate = parseInt(value, 10);
      if (!isNaN(rate)) {
        options.sampleRate = rate;
      }
    }
  }

  return options;
}

/**
 * Creates a WAV header for raw audio data
 * @param {number} dataLength - Length of the audio data in bytes
 * @param {Object} options - Audio options (numChannels, sampleRate, bitsPerSample)
 * @returns {Buffer} - WAV header buffer
 */
function createWavHeader(dataLength, options) {
  const {
    numChannels,
    sampleRate,
    bitsPerSample,
  } = options;

  // http://soundfile.sapp.org/doc/WaveFormat
  const byteRate = sampleRate * numChannels * bitsPerSample / 8;
  const blockAlign = numChannels * bitsPerSample / 8;
  const buffer = Buffer.alloc(44);

  buffer.write('RIFF', 0); // ChunkID
  buffer.writeUInt32LE(36 + dataLength, 4); // ChunkSize
  buffer.write('WAVE', 8); // Format
  buffer.write('fmt ', 12); // Subchunk1ID
  buffer.writeUInt32LE(16, 16); // Subchunk1Size (PCM)
  buffer.writeUInt16LE(1, 20); // AudioFormat (1 = PCM)
  buffer.writeUInt16LE(numChannels, 22); // NumChannels
  buffer.writeUInt32LE(sampleRate, 24); // SampleRate
  buffer.writeUInt32LE(byteRate, 28); // ByteRate
  buffer.writeUInt16LE(blockAlign, 32); // BlockAlign
  buffer.writeUInt16LE(bitsPerSample, 34); // BitsPerSample
  buffer.write('data', 36); // Subchunk2ID
  buffer.writeUInt32LE(dataLength, 40); // Subchunk2Size

  return buffer;
}

/**
 * Cut text to config.maxTextLength the way the legacy page and preview routes always have.
 * @param {string} text
 * @returns {string}
 */
function truncateForLegacyAudio(text) {
  return text.length > config.maxTextLength
    ? text.substring(0, config.maxTextLength) + '...'
    : text;
}

module.exports = {
  truncateForLegacyAudio,
  convertToWav,
  parseMimeType,
  createWavHeader
};
