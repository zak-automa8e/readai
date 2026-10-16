const segmentAudioService = require('../../audio/segmentAudioService');

/**
 * tts_segment jobs: generate one clip (text hash × voice snapshot hash). payload:
 *   { segmentId, textSha256, voiceHash, voiceSnapshot: {model, base_voice, instructions} }
 * A clip that is ready already ends the job without a provider call.
 */
module.exports = {
  async run(job) {
    await segmentAudioService.generate(job.payload || {});
    return null;
  },

  // Called once the job has failed for good: the row shows 'failed' and a later listen retries it
  async onFailed(job, error) {
    await segmentAudioService.markFailed(job.payload || {}, error);
  },
};
