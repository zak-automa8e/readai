const config = require('../../config');
const supabaseService = require('../supabaseService');
const logger = require('../../utils/logger');

const PAGES_AHEAD_MIN = 1;
const PAGES_AHEAD_MAX = 5;

const isPagesAhead = (value) => Number.isInteger(value) && value >= PAGES_AHEAD_MIN && value <= PAGES_AHEAD_MAX;

/**
 * How many read pages ahead of the listener audio is prepared (text runs one page more): the
 * listener's own choice in Settings, else config.audio.pagesAhead. A failed read falls back to the
 * default rather than stopping playback.
 * @param {string} userId
 * @returns {Promise<number>}
 */
async function pagesAheadFor(userId) {
  try {
    const value = await supabaseService.getListenPagesAhead(userId);
    if (isPagesAhead(value)) return value;
  } catch (error) {
    logger.warn('Could not read the listener\'s pages-ahead setting; using the default', { userId, error: error.message });
  }
  return config.audio.pagesAhead;
}

module.exports = { PAGES_AHEAD_MIN, PAGES_AHEAD_MAX, isPagesAhead, pagesAheadFor };
