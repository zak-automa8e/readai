const supabaseService = require('../supabaseService');
const { recipe } = require('./extractionContext');
const planner = require('./extractionPlanner');
const { runChunk } = require('./pageJobs');
const { extractPage, validateWithRetry } = require('./pageExtraction');
const { finalizePrefix, resegment, failedPagesOf } = require('./segmentFinalizer');

/**
 * Extraction pipeline (spec §5.2, O15): one extraction per PDF content × recipe (prompt version, model).
 * extractionPlanner starts it and queues text only for the pages a listener is about to reach;
 * pageJobs runs those jobs (pageExtraction per page); segmentFinalizer turns done pages into segments.
 * This module is the entry point the controllers, job handlers and scripts use.
 */

// ---------------------------------------------------------------- status (GET /processing)

async function getStatus(extraction) {
  let failedPages = [];
  if (extraction.pages_failed > 0) {
    failedPages = await failedPagesOf(extraction.id, await supabaseService.getExtractionJobs(extraction.id));
  }
  return {
    extractionId: extraction.id,
    status: extraction.status,
    pagesTotal: extraction.pages_total,
    pagesDone: extraction.pages_done,
    pagesFailed: extraction.pages_failed,
    failedPages,
    finalizedThroughPage: extraction.finalized_through_page,
    // [[first, last], ...] pages whose paragraphs are built; the text view tells blank pages from unprepared ones
    builtRuns: extraction.built_runs || [],
    // Bumped whenever segments change anywhere in the book (the player reloads its text on it)
    segmentVersion: extraction.segment_version || 0,
    mode: extraction.finalized_through_page >= 1 || extraction.built_runs?.length > 0 ? 'segments' : 'legacy',
  };
}

module.exports = {
  recipe,
  textWindow: planner.textWindow,
  ensureText: planner.ensureText,
  ensureContentHash: planner.ensureContentHash,
  findLiveExtraction: planner.findLiveExtraction,
  startOrResume: planner.startOrResume,
  runPlan: planner.runPlan,
  failPlan: planner.failPlan,
  runChunk,
  extractPage,
  validateWithRetry,
  finalizePrefix,
  resegment,
  getStatus,
};
