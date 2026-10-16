jest.mock('../../src/utils/logger', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }));
jest.mock('../../src/services/supabaseService', () => ({}));

const { JobRunner } = require('../../src/services/jobs/jobRunner');

const settings = { pollMs: 10, leaseRenewMs: 5, retryBaseMs: 15000, stopTimeoutMs: 50, concurrency: {} };
const flush = () => new Promise((resolve) => setImmediate(resolve));
const waitFor = async (check, tries = 200) => {
  for (let i = 0; i < tries; i++) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error('condition not reached');
};

function fakeDb(jobs) {
  const queue = [...jobs];
  return {
    claimJobs: jest.fn(async (worker, kinds, n) => queue.splice(0, n).map((j) => ({ status: 'running', locked_by: worker, ...j }))),
    updateClaimedJob: jest.fn(async () => true),
  };
}

const job = (overrides = {}) => ({ id: 'job-1', kind: 'extract_pages', attempts: 1, max_attempts: 5, payload: { phase: 'realtime', pages: [1] }, ...overrides });
const lastUpdate = (db) => db.updateClaimedJob.mock.calls[db.updateClaimedJob.mock.calls.length - 1][2];

describe('JobRunner', () => {
  let runner;
  afterEach(async () => {
    if (runner) await runner.stop(10);
  });

  it('claims through claim_jobs with its worker id and marks a finished job done', async () => {
    const db = fakeDb([job()]);
    const handler = { run: jest.fn().mockResolvedValue(null) };
    runner = new JobRunner({ db, settings, workerId: 'w1' }).register('extract_pages', handler, 1);

    runner.start();
    await waitFor(() => db.updateClaimedJob.mock.calls.length > 0);

    expect(db.claimJobs).toHaveBeenCalledWith('w1', ['extract_pages'], 1);
    expect(handler.run).toHaveBeenCalledWith(expect.objectContaining({ id: 'job-1' }), expect.objectContaining({ updatePayload: expect.any(Function) }));
    expect(db.updateClaimedJob).toHaveBeenCalledWith('job-1', 'w1', expect.objectContaining({ status: 'done', locked_by: null, locked_at: null }));
  });

  it('puts a failed job back with exponential backoff', async () => {
    const db = fakeDb([job({ attempts: 2 })]);
    runner = new JobRunner({ db, settings, workerId: 'w1' }).register('extract_pages', { run: jest.fn().mockRejectedValue(new Error('boom')) }, 1);

    const before = Date.now();
    runner.start();
    await waitFor(() => db.updateClaimedJob.mock.calls.length > 0);

    const update = lastUpdate(db);
    expect(update).toMatchObject({ status: 'queued', last_error: 'boom', locked_by: null });
    const delay = Date.parse(update.run_after) - before;
    expect(delay).toBeGreaterThanOrEqual(15000 * 4 - 50);
    expect(delay).toBeLessThan(15000 * 4 + 1000);
  });

  it('fails the job on its last attempt and calls onFailed', async () => {
    const db = fakeDb([job({ attempts: 5 })]);
    const handler = { run: jest.fn().mockRejectedValue(new Error('still broken')), onFailed: jest.fn() };
    runner = new JobRunner({ db, settings, workerId: 'w1' }).register('extract_pages', handler, 1);

    runner.start();
    await waitFor(() => handler.onFailed.mock.calls.length > 0);

    expect(lastUpdate(db)).toMatchObject({ status: 'failed', last_error: 'still broken' });
  });

  it('fails a non-retriable error at once', async () => {
    const db = fakeDb([job({ attempts: 1 })]);
    const error = Object.assign(new Error('key limit'), { nonRetriable: true });
    const handler = { run: jest.fn().mockRejectedValue(error), onFailed: jest.fn() };
    runner = new JobRunner({ db, settings, workerId: 'w1' }).register('extract_pages', handler, 1);

    runner.start();
    await waitFor(() => handler.onFailed.mock.calls.length > 0);

    expect(lastUpdate(db).status).toBe('failed');
  });

  it('gives up on a re-claimed job past its attempts without running it', async () => {
    const db = fakeDb([job({ attempts: 6 })]);
    const handler = { run: jest.fn(), onFailed: jest.fn() };
    runner = new JobRunner({ db, settings, workerId: 'w1' }).register('extract_pages', handler, 1);

    runner.start();
    await waitFor(() => handler.onFailed.mock.calls.length > 0);

    expect(handler.run).not.toHaveBeenCalled();
    expect(lastUpdate(db).status).toBe('failed');
  });

  it('re-queues a polling job without spending an attempt', async () => {
    const db = fakeDb([job({ attempts: 3, payload: { phase: 'batch' } })]);
    const payload = { phase: 'batch', batch: { id: 'b1' } };
    runner = new JobRunner({ db, settings, workerId: 'w1' }).register('extract_pages', {
      run: jest.fn().mockResolvedValue({ requeue: { delayMs: 300000, payload } }),
    }, 1);

    runner.start();
    await waitFor(() => db.updateClaimedJob.mock.calls.length > 0);

    expect(lastUpdate(db)).toMatchObject({ status: 'queued', attempts: 2, payload });
  });

  it('renews the lease while a handler runs', async () => {
    const db = fakeDb([job()]);
    let release;
    const handler = { run: jest.fn(() => new Promise((resolve) => { release = resolve; })) };
    runner = new JobRunner({ db, settings, workerId: 'w1' }).register('extract_pages', handler, 1);

    runner.start();
    await waitFor(() => db.updateClaimedJob.mock.calls.some(([, , u]) => u.locked_at && !('status' in u)));
    release(null);
    await waitFor(() => db.updateClaimedJob.mock.calls.some(([, , u]) => u.status === 'done'));
  });

  it('does not claim more than the concurrency of a kind', async () => {
    const db = fakeDb([job({ id: 'a' }), job({ id: 'b' })]);
    const handler = { run: jest.fn(() => new Promise(() => {})) };
    runner = new JobRunner({ db, settings, workerId: 'w1' }).register('extract_pages', handler, 1);

    runner.start();
    await waitFor(() => handler.run.mock.calls.length === 1);
    await new Promise((resolve) => setTimeout(resolve, 40));

    expect(handler.run).toHaveBeenCalledTimes(1);
    db.claimJobs.mock.calls.forEach(([, , n]) => expect(n).toBeLessThanOrEqual(1));
  });

  it('hands running jobs back on stop when they outlast the timeout', async () => {
    const db = fakeDb([job({ attempts: 2 })]);
    const handler = { run: jest.fn(() => new Promise(() => {})) };
    runner = new JobRunner({ db, settings, workerId: 'w1' }).register('extract_pages', handler, 1);

    runner.start();
    await waitFor(() => handler.run.mock.calls.length === 1);
    await runner.stop(20);

    expect(lastUpdate(db)).toMatchObject({ status: 'queued', attempts: 1, locked_by: null });
    const claims = db.claimJobs.mock.calls.length;
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(db.claimJobs.mock.calls.length).toBe(claims);
  });

  it('waits for a job that finishes within the stop timeout', async () => {
    const db = fakeDb([job()]);
    const handler = { run: jest.fn(() => new Promise((resolve) => setTimeout(() => resolve(null), 20))) };
    runner = new JobRunner({ db, settings, workerId: 'w1' }).register('extract_pages', handler, 1);

    runner.start();
    await waitFor(() => handler.run.mock.calls.length === 1);
    await runner.stop(500);
    await flush();

    expect(lastUpdate(db).status).toBe('done');
  });

  it('survives a claim error and keeps polling', async () => {
    const db = fakeDb([]);
    db.claimJobs.mockRejectedValueOnce(new Error('network'));
    runner = new JobRunner({ db, settings, workerId: 'w1' }).register('extract_pages', { run: jest.fn() }, 1);

    runner.start();
    await waitFor(() => db.claimJobs.mock.calls.length >= 3);
  });
});
