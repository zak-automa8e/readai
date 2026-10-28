const os = require('os');
const crypto = require('crypto');
const config = require('../../config');
const logger = require('../../utils/logger');
const supabaseService = require('../supabaseService');

/**
 * Job loop over book_processing_jobs (spec §5.1). Jobs are claimed through the claim_jobs RPC
 * (FOR UPDATE SKIP LOCKED, 5-minute lease); the lease is renewed while a handler runs, so a
 * killed process's jobs are re-claimed by the next one. Every write on a claimed job is
 * conditional on still holding it.
 *
 * A handler is `{ run(job, ctx) → null | {requeue: {delayMs, payload}}, onFailed?(job, error) }`.
 * `requeue` puts the job back without spending an attempt (batch polling).
 */
class JobRunner {
  constructor({ db = supabaseService, settings = config.jobs, workerId } = {}) {
    this.db = db;
    this.settings = settings;
    this.workerId = workerId || `${os.hostname()}:${process.pid}:${crypto.randomBytes(3).toString('hex')}`;
    this.handlers = new Map();
    this.active = new Map();
    this.inFlight = new Map(); // job id -> { job, promise }
    this.running = false;
    this.ticking = false;
    this.timer = null;
  }

  register(kind, handler, concurrency = 1) {
    this.handlers.set(kind, { handler, concurrency });
    this.active.set(kind, 0);
    return this;
  }

  start() {
    if (this.running) return;
    this.running = true;
    logger.info('Job runner started', { workerId: this.workerId, kinds: [...this.handlers.keys()] });
    this.schedule(0);
  }

  // Claim now instead of at the next poll (e.g. right after enqueueing)
  wake() {
    if (this.running) this.schedule(0);
  }

  schedule(delayMs) {
    if (!this.running) return;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => { this.tick(); }, delayMs);
  }

  async tick() {
    if (!this.running) return;
    if (this.ticking) {
      this.wakeAgain = true;
      return;
    }
    this.ticking = true;
    try {
      for (const [kind, { concurrency }] of this.handlers) {
        const free = concurrency - this.active.get(kind);
        if (free <= 0) continue;
        const jobs = await this.db.claimJobs(this.workerId, [kind], free);
        for (const job of jobs) this.execute(kind, job);
      }
    } catch (error) {
      logger.error('Job claim failed', { error: error.message });
    } finally {
      this.ticking = false;
      const again = this.wakeAgain;
      this.wakeAgain = false;
      this.schedule(again ? 0 : this.settings.pollMs);
    }
  }

  execute(kind, job) {
    this.active.set(kind, this.active.get(kind) + 1);
    // Never reject: server.js exits on an unhandled rejection
    const promise = this.runJob(kind, job).catch((error) => {
      logger.error('Job bookkeeping failed; the lease will expire and the job be re-claimed', { jobId: job.id, error: error.message });
    }).finally(() => {
      this.active.set(kind, this.active.get(kind) - 1);
      this.inFlight.delete(job.id);
      this.wake();
    });
    this.inFlight.set(job.id, { job, promise });
    return promise;
  }

  async finish(job, updates) {
    const held = await this.db.updateClaimedJob(job.id, this.workerId, {
      locked_by: null,
      locked_at: null,
      ...updates,
    });
    if (!held) logger.warn('Job lease was lost before it finished; result not recorded', { jobId: job.id, kind: job.kind });
    return held;
  }

  async runJob(kind, job) {
    const { handler } = this.handlers.get(kind);
    const label = { jobId: job.id, kind, key: job.idempotency_key, attempt: job.attempts };

    // claim_jobs re-claims abandoned jobs without looking at attempts: stop a job that keeps crashing the process
    if (job.attempts > job.max_attempts) {
      const error = new Error(`gave up after ${job.max_attempts} attempts (the job did not finish)`);
      if (await this.finish(job, { status: 'failed', last_error: error.message, finished_at: new Date().toISOString() })) {
        await this.notifyFailed(handler, job, error);
      }
      return;
    }

    const lease = setInterval(() => {
      this.db.updateClaimedJob(job.id, this.workerId, { locked_at: new Date().toISOString() })
        .catch((error) => logger.warn('Lease renewal failed', { jobId: job.id, error: error.message }));
    }, this.settings.leaseRenewMs);
    if (lease.unref) lease.unref();

    const ctx = {
      workerId: this.workerId,
      updatePayload: (payload) => this.db.updateClaimedJob(job.id, this.workerId, { payload }),
    };

    try {
      logger.info('Job started', label);
      const result = await handler.run(job, ctx);
      clearInterval(lease);
      if (result && result.requeue) {
        await this.finish(job, {
          status: 'queued',
          run_after: new Date(Date.now() + result.requeue.delayMs).toISOString(),
          payload: result.requeue.payload ?? job.payload,
          attempts: Math.max(job.attempts - 1, 0),
        });
        logger.info('Job re-queued', { ...label, delayMs: result.requeue.delayMs });
        return;
      }
      await this.finish(job, { status: 'done', finished_at: new Date().toISOString(), last_error: null });
      logger.info('Job done', label);
    } catch (error) {
      clearInterval(lease);
      const message = String(error.message || error).slice(0, 1000);
      if (error.nonRetriable || job.attempts >= job.max_attempts) {
        logger.error('Job failed', { ...label, error: message });
        if (await this.finish(job, { status: 'failed', last_error: message, finished_at: new Date().toISOString() })) {
          await this.notifyFailed(handler, job, error);
        }
        return;
      }
      const delayMs = Math.max(this.settings.retryBaseMs * 2 ** job.attempts, error.retryAfterMs || 0);
      logger.warn('Job will retry', { ...label, delayMs, error: message });
      await this.finish(job, { status: 'queued', run_after: new Date(Date.now() + delayMs).toISOString(), last_error: message });
    }
  }

  async notifyFailed(handler, job, error) {
    if (!handler.onFailed) return;
    try {
      await handler.onFailed(job, error);
    } catch (hookError) {
      logger.error('Job failure hook failed', { jobId: job.id, error: hookError.message });
    }
  }

  /**
   * Stop claiming, wait for running jobs up to timeoutMs, then hand the rest back to the queue
   * (status queued, attempt not counted) so the next process picks them up at once.
   */
  async stop(timeoutMs = this.settings.stopTimeoutMs) {
    if (!this.running) return;
    this.running = false;
    clearTimeout(this.timer);
    const pending = [...this.inFlight.values()];
    if (!pending.length) return;

    let timer;
    const timeout = new Promise((resolve) => { timer = setTimeout(resolve, timeoutMs); });
    await Promise.race([Promise.allSettled(pending.map((p) => p.promise)), timeout]);
    clearTimeout(timer);

    for (const { job } of this.inFlight.values()) {
      try {
        await this.finish(job, { status: 'queued', run_after: new Date().toISOString(), attempts: Math.max(job.attempts - 1, 0) });
        logger.warn('Job handed back on shutdown', { jobId: job.id, kind: job.kind });
      } catch (error) {
        logger.error('Could not hand back job on shutdown; its lease expires in 5 minutes', { jobId: job.id, error: error.message });
      }
    }
  }
}

let runner = null;

// The process-wide runner with every handler registered
function getRunner() {
  if (!runner) {
    runner = new JobRunner();
    runner.register('extract_pages', require('./handlers/extractPages'), config.jobs.concurrency.extract_pages);
    runner.register('tts_segment', require('./handlers/ttsSegment'), config.jobs.concurrency.tts_segment);
    runner.register('listen_followup', require('./handlers/listenFollowup'), config.jobs.concurrency.listen_followup);
  }
  return runner;
}

function wake() {
  if (runner) runner.wake();
}

module.exports = { JobRunner, getRunner, wake };
