-- Audio pipeline story 3 · spec §3.1 — data fixes, no schema change.

-- M3: legacy durations were bytes / (44100 × 2 × 2); the WAVs are 24 kHz mono 16-bit = 48 000 bytes/s
-- after a 44-byte header. Only rows still on the old formula (bytes/second > 100 000) change.
update public.page_audio
   set audio_duration_seconds = round((audio_size_bytes - 44) / 48000.0)
 where audio_duration_seconds > 0
   and audio_size_bytes::numeric / audio_duration_seconds > 100000;

-- M4: every existing book has been listened to; they re-process on first open in Listen mode (O9).
update public.books set mode = 'listen';
