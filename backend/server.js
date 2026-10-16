const app = require('./src/app');
const config = require('./src/config');
const logger = require('./src/utils/logger');
const supabaseService = require('./src/services/supabaseService');
const jobRunner = require('./src/services/jobs/jobRunner');

// Set up the server port
const PORT = config.port;
const JOBS_MODE = config.jobs.mode; // inline (HTTP + jobs) | worker (jobs only) | off (HTTP only)

// Start the server (a worker process serves no HTTP)
const server = JOBS_MODE === 'worker' ? null : app.listen(PORT, () => {
  logger.info(`Server is running on http://localhost:${PORT}`);
  logger.info(`Environment: ${config.nodeEnv}`);
});

let runner = null;
if (JOBS_MODE !== 'off') {
  if (supabaseService.initialized) {
    runner = jobRunner.getRunner();
    runner.start();
  } else {
    logger.warn(`JOBS_MODE=${JOBS_MODE} but Supabase is not configured; the job runner is not started`);
  }
}
logger.info(`Jobs mode: ${JOBS_MODE}`);

// Handle graceful shutdown: stop claiming, let running jobs finish (or hand them back), then close HTTP
let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info(`${signal} received, shutting down gracefully`);

  // Force close after 10s
  setTimeout(() => {
    logger.error('Forced shutdown after timeout');
    process.exit(1);
  }, 10000).unref();

  try {
    if (runner) await runner.stop();
  } catch (error) {
    logger.error('Job runner stop failed', { error: error.message });
  }

  if (!server) process.exit(0);
  server.close(() => {
    logger.info('Server closed');
    process.exit(0);
  });
}

process.on('SIGTERM', () => { shutdown('SIGTERM'); });
process.on('SIGINT', () => { shutdown('SIGINT'); });

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  logger.error('Uncaught Exception:', error);
  process.exit(1);
});

process.on('unhandledRejection', (error) => {
  logger.error('Unhandled Rejection:', error);
  process.exit(1);
});
