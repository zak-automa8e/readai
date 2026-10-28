const windowService = require('../../audio/windowService');
const jobRunner = require('../jobRunner');

/**
 * listen_followup jobs: finish a listening window that stopped at a segment still being extracted.
 * payload: { fromSeq, waitSeq, voiceHash, voiceSnapshot, waitUntil }
 * Re-queued on the poll interval while it waits; extraction wakes it when it closes segments.
 */
module.exports = {
  async run(job) {
    const result = await windowService.runFollowup(job);
    if (!result) jobRunner.wake(); // claim the clips the new plan queued
    return result;
  },
};
