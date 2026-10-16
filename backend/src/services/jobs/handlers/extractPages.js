const extractionService = require('../../extraction/extractionService');

/**
 * extract_pages jobs. payload.phase:
 *   'plan'      count pages, create pages rows, enqueue the chunk jobs (one per extraction)
 *   'realtime'  extract payload.pages now
 *   'batch'     submit payload.pages to the batch API, then poll (re-queued every 5 minutes)
 */
module.exports = {
  async run(job, ctx) {
    if (job.payload?.phase === 'plan') {
      await extractionService.runPlan(job);
      return null;
    }
    return extractionService.runChunk(job, ctx);
  },

  // Called once the job has failed for good
  async onFailed(job, error) {
    if (job.payload?.phase === 'plan') {
      await extractionService.failPlan(job, error);
      return;
    }
    // Recount: the extraction settles as 'partial' with these pages listed as failed
    await extractionService.finalizePrefix(job.extraction_id);
  },
};
