const rateLimit = require('express-rate-limit');
const config = require('../config');

/**
 * Listening calls (story 7a) are rate limited per signed-in user, not per IP: a household or an
 * office behind one IP must not share one budget, and listening must not eat the budget of chat
 * and notes. The general /api limiter skips these paths; a high per-IP limit still guards them
 * against floods before sign-in is checked.
 */

// Paths below /api
const PLAYBACK_PATHS = [
  /^\/books\/[^/]+\/(processing|segments|listen|listen\/wait)\/?$/,
  /^\/segments\/[^/]+\/audio\/?$/,
  /^\/plan\/?$/,
];

function isPlaybackPath(path) {
  return PLAYBACK_PATHS.some((pattern) => pattern.test(path));
}

const message = (who) => ({ error: 'RATE_LIMITED', message: `Too many listening requests from this ${who}, please try again later.` });

// Before sign-in: per IP, playback paths only
const playbackIpLimiter = rateLimit({
  windowMs: config.rateLimitWindowMs,
  max: config.playbackIpRateLimitMax,
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => !isPlaybackPath(req.path),
  message: message('IP'),
});

// After authenticateUser: per user, one budget shared by every playback route
const playbackUserLimiter = rateLimit({
  windowMs: config.rateLimitWindowMs,
  max: config.playbackRateLimitMax,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => `user:${req.user.id}`,
  message: message('account'),
});

module.exports = { isPlaybackPath, playbackIpLimiter, playbackUserLimiter };
