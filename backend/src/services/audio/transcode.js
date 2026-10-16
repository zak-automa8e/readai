const { spawn } = require('child_process');

/**
 * PCM → Ogg Opus through ffmpeg (spike P8: 32 kb/s is ~12× smaller than WAV). ffmpeg is spawned
 * the way pageRenderer spawns poppler; it is not in the production Docker image yet.
 */

const TIMEOUT_MS = 60000;

/**
 * @param {{pcm: Buffer, sampleRate: number, channels: number, bitsPerSample: number}} audio 16-bit little-endian PCM
 * @param {{bitrateKbps?: number, command?: string, timeoutMs?: number}} [options]
 * @returns {Promise<Buffer>}
 */
function pcmToOggOpus({ pcm, sampleRate, channels, bitsPerSample }, { bitrateKbps = 32, command = 'ffmpeg', timeoutMs = TIMEOUT_MS } = {}) {
  if (bitsPerSample !== 16) return Promise.reject(new Error(`Opus transcoding expects 16-bit PCM, got ${bitsPerSample}-bit`));
  return new Promise((resolve, reject) => {
    const proc = spawn(command, [
      '-hide_banner', '-loglevel', 'error',
      '-f', 's16le', '-ar', String(sampleRate), '-ac', String(channels), '-i', 'pipe:0',
      '-c:a', 'libopus', '-b:a', `${bitrateKbps}k`,
      '-f', 'ogg', 'pipe:1',
    ]);
    const chunks = [];
    let stderr = '';
    let settled = false;
    const done = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve(value);
    };
    const timer = setTimeout(() => {
      proc.kill('SIGKILL');
      done(new Error(`${command} timed out after ${timeoutMs} ms`));
    }, timeoutMs);

    proc.stdout.on('data', (d) => chunks.push(d));
    proc.stderr.on('data', (d) => { stderr += d.toString(); });
    proc.on('error', (error) => done(error));
    proc.on('close', (code) => {
      if (code !== 0) return done(new Error(`${command} exited with ${code}: ${stderr.slice(0, 300)}`));
      const out = Buffer.concat(chunks);
      if (!out.length) return done(new Error(`${command} produced no output`));
      return done(null, out);
    });
    // ffmpeg may exit early on bad input; its exit code carries the error, not EPIPE
    proc.stdin.on('error', () => {});
    proc.stdin.end(pcm);
  });
}

module.exports = { pcmToOggOpus };
