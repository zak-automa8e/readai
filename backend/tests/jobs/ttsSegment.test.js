jest.mock('../../src/utils/logger', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }));
jest.mock('../../src/services/supabaseService', () => require('../helpers/fakeSupabase')());
jest.mock('../../src/services/llm', () => ({ ttsModel: () => 'test/tts', synthesize: jest.fn() }));

const crypto = require('crypto');
const db = require('../../src/services/supabaseService');
const llm = require('../../src/services/llm');
const { JobRunner } = require('../../src/services/jobs/jobRunner');
const handler = require('../../src/services/jobs/handlers/ttsSegment');
const segmentAudio = require('../../src/services/audio/segmentAudioService');

const sha = (text) => crypto.createHash('sha256').update(text, 'utf8').digest('hex');
const SNAPSHOT = segmentAudio.voiceSnapshot({ model: 'test/tts', baseVoice: 'Zephyr', instructions: null });
const HASH = segmentAudio.snapshotHash(SNAPSHOT);
const settings = { pollMs: 10, leaseRenewMs: 1000, retryBaseMs: 15000, stopTimeoutMs: 50, concurrency: {} };

const waitFor = async (check, tries = 200) => {
  for (let i = 0; i < tries; i++) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error('condition not reached');
};

function runnerFor(jobs) {
  const queue = [...jobs];
  const runnerDb = {
    claimJobs: jest.fn(async (worker, kinds, n) => queue.filter((j) => kinds.includes(j.kind)).splice(0, n)
      .map((j) => { queue.splice(queue.indexOf(j), 1); return { status: 'running', locked_by: worker, ...j }; })),
    updateClaimedJob: jest.fn(async () => true),
  };
  return { runnerDb, runner: new JobRunner({ db: runnerDb, settings, workerId: 'w1' }).register('tts_segment', handler, 2) };
}

let segment;
let job;

beforeEach(() => {
  jest.clearAllMocks();
  db.reset();
  const text = 'one paragraph';
  segment = db.addSegment({ extraction_id: 'ext-1', seq: 1, start_page: 1, end_page: 1, parts: [{ page: 1, chars: text.length }], text, text_sha256: sha(text), char_count: text.length });
  job = { id: 'job-1', kind: 'tts_segment', attempts: 1, max_attempts: 5, payload: { segmentId: segment.id, textSha256: segment.text_sha256, voiceHash: HASH, voiceSnapshot: SNAPSHOT } };
});

describe('tts_segment handler', () => {
  let runner;
  afterEach(async () => {
    if (runner) await runner.stop(10);
  });

  it('generates the clip and the job is done', async () => {
    llm.synthesize.mockResolvedValue({ pcm: Buffer.alloc(48000 * 3), sampleRate: 24000, channels: 1, bitsPerSample: 16, usage: { costUsd: 3 * 0.000225 } });
    const built = runnerFor([job]);
    runner = built.runner;

    runner.start();
    await waitFor(() => built.runnerDb.updateClaimedJob.mock.calls.some((c) => c[2].status === 'done'));

    expect(db.audioRow(segment.text_sha256, HASH)).toMatchObject({ status: 'ready', duration_seconds: 3, cost_micros: 675 });
  });

  it('a final failure marks the clip failed with the error', async () => {
    llm.synthesize.mockRejectedValue(Object.assign(new Error('OpenRouter /audio/speech failed with 400: bad voice'), { nonRetriable: true }));
    const built = runnerFor([job]);
    runner = built.runner;

    runner.start();
    await waitFor(() => db.audioRow(segment.text_sha256, HASH)?.status === 'failed');

    expect(built.runnerDb.updateClaimedJob).toHaveBeenCalledWith('job-1', 'w1', expect.objectContaining({ status: 'failed' }));
    expect(db.audioRow(segment.text_sha256, HASH).error).toMatch(/bad voice/);
  });

  it('a transient failure re-queues the job and leaves the clip pending', async () => {
    llm.synthesize.mockRejectedValue(new Error('503 upstream'));
    const built = runnerFor([job]);
    runner = built.runner;

    runner.start();
    await waitFor(() => built.runnerDb.updateClaimedJob.mock.calls.length > 0);

    expect(built.runnerDb.updateClaimedJob).toHaveBeenCalledWith('job-1', 'w1', expect.objectContaining({ status: 'queued' }));
    expect(db.audioRow(segment.text_sha256, HASH).status).toBe('pending');
  });
});
