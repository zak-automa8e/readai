const express = require('express');
const request = require('supertest');

describe('playback rate limits', () => {
  let limits;

  beforeAll(() => {
    jest.resetModules();
    process.env.PLAYBACK_RATE_LIMIT_MAX = '2';
    limits = require('../../src/middleware/playbackRateLimit');
  });

  afterAll(() => {
    delete process.env.PLAYBACK_RATE_LIMIT_MAX;
  });

  it('recognises the listening paths only', () => {
    const playback = [
      '/books/b1/processing', '/books/b1/segments', '/books/b1/listen', '/books/b1/listen/wait',
      '/segments/s1/audio', '/plan', '/plan/',
    ];
    const other = ['/books/b1/process', '/books', '/books/b1', '/chat/send', '/books/b1/listen/extra', '/segments/s1'];
    expect(playback.filter((p) => !limits.isPlaybackPath(p))).toEqual([]);
    expect(other.filter((p) => limits.isPlaybackPath(p))).toEqual([]);
  });

  it('gives every signed-in user their own budget, shared across the listening routes', async () => {
    const app = express();
    app.use((req, res, next) => { req.user = { id: req.headers['x-test-user'] }; next(); });
    app.get('/a', limits.playbackUserLimiter, (req, res) => res.json({ ok: true }));
    app.get('/b', limits.playbackUserLimiter, (req, res) => res.json({ ok: true }));

    expect((await request(app).get('/a').set('x-test-user', 'u1')).status).toBe(200);
    expect((await request(app).get('/b').set('x-test-user', 'u1')).status).toBe(200);
    const limited = await request(app).get('/a').set('x-test-user', 'u1');
    expect(limited.status).toBe(429);
    expect(limited.body.error).toBe('RATE_LIMITED');

    // Same IP, another account: untouched
    expect((await request(app).get('/a').set('x-test-user', 'u2')).status).toBe(200);
  });
});
