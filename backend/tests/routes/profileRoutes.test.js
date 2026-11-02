jest.mock('../../src/utils/logger', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }));
jest.mock('../../src/services/supabaseService', () => require('../helpers/fakeSupabase')());
jest.mock('../../src/middleware/authMiddleware', () => ({
  authenticateUser: (req, res, next) => {
    req.user = { id: 'user-1', email: 'reader@example.com' };
    next();
  },
  optionalAuth: (req, res, next) => next(),
}));

const express = require('express');
const request = require('supertest');
const db = require('../../src/services/supabaseService');

const app = express();
app.use(express.json());
app.use('/api/auth', require('../../src/routes/authRoutes'));

beforeEach(() => {
  jest.clearAllMocks();
  db.reset();
  // The profile row as the database returns it: listen_pages_ahead defaults to 2
  db.getUserProfile = jest.fn(async (userId) => ({ id: userId, display_name: 'Reader', listen_pages_ahead: db.state.pagesAhead.get(userId) ?? 2 }));
});

describe('GET/PUT /api/auth/profile listenPagesAhead', () => {
  it('reads the default, saves a new value and reads it back', async () => {
    expect((await request(app).get('/api/auth/profile')).body.user.listenPagesAhead).toBe(2);

    const put = await request(app).put('/api/auth/profile').send({ listenPagesAhead: 4 });
    expect(put.status).toBe(200);
    expect(put.body).toEqual({ success: true, listenPagesAhead: 4 });

    expect((await request(app).get('/api/auth/profile')).body.user.listenPagesAhead).toBe(4);
  });

  it.each([0, 6, 2.5, '3', null, undefined])('refuses %p with 400 and saves nothing', async (value) => {
    const res = await request(app).put('/api/auth/profile').send({ listenPagesAhead: value });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('INVALID_PAGES_AHEAD');
    expect(db.setListenPagesAhead).not.toHaveBeenCalled();
  });
});
