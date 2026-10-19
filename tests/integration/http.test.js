const request = require('supertest');
const { createApp } = require('../../src/app');

function appWithRedis(redis) {
  return createApp({
    redis,
    importQueue: { add: async () => ({ id: '1' }) },
    scheduledQueue: { add: async () => ({ id: '1' }) },
  });
}

describe('health and error responses', () => {
  test('live succeeds and ready reflects dependency checks', async () => {
    const down = appWithRedis({
      ping: async () => {
        throw new Error('redis down');
      },
    });
    const live = await request(down).get('/health/live');
    expect(live.status).toBe(200);
    expect(live.body.status).toBe('ok');

    const notReady = await request(down).get('/health/ready');
    expect(notReady.status).toBe(503);
    expect(notReady.body.error).toBeUndefined();
    expect(notReady.body.checks.redis).toBe(false);

    const { startMongo, stopMongo } = require('../helpers/db');
    await startMongo();
    try {
      const readyApp = appWithRedis({ ping: async () => 'PONG' });
      const ready = await request(readyApp).get('/health/ready');
      expect(ready.status).toBe(200);
      expect(ready.body.checks).toEqual({ mongodb: true, redis: true });
    } finally {
      await stopMongo();
    }
  });

  test('returns a consistent JSON error for unknown routes and bad ids', async () => {
    const app = appWithRedis({ ping: async () => 'PONG' });
    const missing = await request(app).get('/api/does-not-exist');
    expect(missing.status).toBe(404);
    expect(missing.body.error.code).toBe('NOT_FOUND');

    const badId = await request(app).get('/api/imports/not-an-object-id');
    expect(badId.status).toBe(400);
    expect(badId.body.error.code).toBe('VALIDATION_ERROR');

    const absent = await request(app).post('/api/imports');
    expect(absent.status).toBe(400);
    expect(absent.body.error.code).toBe('FILE_REQUIRED');
  });

  test('serves the OpenAPI UI', async () => {
    const app = appWithRedis({ ping: async () => 'PONG' });
    const docs = await request(app).get('/api/docs/');
    expect(docs.status).toBe(200);
    expect(docs.text).toContain('swagger-ui');
    const spec = await request(app).get('/api/docs/openapi.json');
    expect(spec.status).toBe(200);
    expect(spec.body.info.title).toBe('Insurance Policy Platform API');
  });
});
