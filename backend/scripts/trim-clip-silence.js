#!/usr/bin/env node
// Trim the edge silence from clips made before trimming moved into generation (2026-11-18).
// Each ready WAV clip is downloaded, trimmed (services/audio/silence.js), uploaded over the same
// storage path and its duration_seconds / size_bytes updated. Safe to run twice: a trimmed clip
// keeps its pads. Ogg clips are counted and left alone. Dry run by default; --apply writes.
//   node scripts/trim-clip-silence.js [--apply]
const config = require('../src/config');
const supabaseService = require('../src/services/supabaseService');
const { storagePath } = require('../src/services/audio/segmentAudioService');
const { trimSilence } = require('../src/services/audio/silence');
const { wavInfo, pcmToWav } = require('../src/services/llm/audio');

// The PCM inside a WAV buffer: the bytes of its 'data' chunk
function pcmOf(buf) {
  let offset = 12;
  while (offset + 8 <= buf.length) {
    const size = buf.readUInt32LE(offset + 4);
    if (buf.toString('ascii', offset, offset + 4) === 'data') return buf.subarray(offset + 8, offset + 8 + Math.min(size, buf.length - offset - 8));
    offset += 8 + size + (size % 2);
  }
  return null;
}

async function readyClips() {
  const { data, error } = await supabaseService.adminClient
    .from('segment_audio')
    .select('text_sha256, voice_snapshot_sha256, audio_url, audio_format, duration_seconds')
    .eq('status', 'ready');
  if (error) throw error;
  return data;
}

(async () => {
  const apply = process.argv.includes('--apply');
  const clips = await readyClips();
  const totals = { clips: clips.length, trimmed: 0, unchanged: 0, skippedNotWav: 0, failed: 0, secondsBefore: 0, secondsAfter: 0 };

  for (const clip of clips) {
    if (clip.audio_format !== 'wav') {
      totals.skippedNotWav += 1;
      continue;
    }
    try {
      const res = await fetch(clip.audio_url, { cache: 'no-store' });
      if (!res.ok) throw new Error(`download ${res.status}`);
      const wav = Buffer.from(await res.arrayBuffer());
      const info = wavInfo(wav);
      const pcm = pcmOf(wav);
      if (!info || !pcm) throw new Error('not a readable WAV');

      const out = trimSilence({ pcm, sampleRate: info.sampleRate, channels: info.channels, bitsPerSample: info.bitsPerSample });
      const after = out.pcm.length / (info.sampleRate * info.channels * info.bitsPerSample / 8);
      totals.secondsBefore += info.seconds;
      totals.secondsAfter += after;
      if (out.trimmedSeconds < 0.01) {
        totals.unchanged += 1;
        continue;
      }
      totals.trimmed += 1;
      if (!apply) continue;

      const buffer = pcmToWav(out);
      const path = storagePath(clip.voice_snapshot_sha256, clip.text_sha256, 'wav');
      await supabaseService.uploadFile(config.audio.storageBucket, path, buffer, { contentType: 'audio/wav', upsert: true });
      await supabaseService.updateSegmentAudio(clip.text_sha256, clip.voice_snapshot_sha256, {
        duration_seconds: Number(after.toFixed(2)),
        size_bytes: buffer.length,
      });
    } catch (error) {
      totals.failed += 1;
      console.error(`clip ${clip.text_sha256.slice(0, 8)}/${clip.voice_snapshot_sha256.slice(0, 8)}: ${error.message}`);
    }
  }

  totals.secondsBefore = Math.round(totals.secondsBefore);
  totals.secondsAfter = Math.round(totals.secondsAfter);
  console.log(JSON.stringify({ mode: apply ? 'APPLIED' : 'dry run', ...totals }));
  process.exit(totals.failed ? 1 : 0);
})().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
