const request = require('supertest');
const { createApp } = require('../../src/app');
const ScheduledMessage = require('../../src/models/scheduled-message.model');
const {
  deliverScheduledMessage,
  recoverScheduledMessages,
} = require('../../src/services/schedule/scheduled-message.service');
const { startMongo, stopMongo, clearMongo } = require('../helpers/db');

function createTestApp(scheduledQueue) {
  return createApp({
    redis: { ping: async () => 'PONG' },
    importQueue: { add: async () => ({ id: 'import' }) },
    scheduledQueue,
  });
}

describe('scheduled messages', () => {
  beforeAll(startMongo);
  afterAll(stopMongo);
  afterEach(clearMongo);

  test('stores a future zoned message and reads it back', async () => {
    const jobs = [];
    const app = createTestApp({
      getJob: async () => null,
      add: async (name, data, options) => {
        jobs.push({ name, data, options });
        return { id: options.jobId };
      },
    });

    const created = await request(app).post('/api/scheduled-messages').send({
      message: 'Policy renewal reminder',
      day: '2099-10-20',
      time: '10:30',
      timezone: 'Asia/Kolkata',
    });
    expect(created.status).toBe(201);
    expect(created.body.status).toBe('pending');
    expect(created.body.scheduledAt).toBe('2099-10-20T05:00:00.000Z');
    expect(jobs[0].options.delay).toBeGreaterThan(0);
    expect(jobs[0].options.jobId).toBe(created.body.id);

    const fetched = await request(app).get(`/api/scheduled-messages/${created.body.id}`);
    expect(fetched.status).toBe(200);
    expect(fetched.body.message).toBe('Policy renewal reminder');

    const past = await request(app).post('/api/scheduled-messages').send({
      message: 'Too late',
      day: '2000-01-01',
      time: '00:00',
      timezone: 'UTC',
    });
    expect(past.status).toBe(400);
    expect(past.body.error.code).toBe('SCHEDULE_IN_THE_PAST');
  });

  test('executes once under concurrent delivery and can recover a pending row', async () => {
    const doc = await ScheduledMessage.create({
      message: 'Insert me',
      day: '2099-01-01',
      time: '00:00',
      timezone: 'UTC',
      scheduledAt: new Date('2099-01-01T00:00:00.000Z'),
      status: 'pending',
    });

    const [first, second] = await Promise.all([
      deliverScheduledMessage(doc._id),
      deliverScheduledMessage(doc._id),
    ]);
    const successes = [first, second].filter((result) => !result.duplicate);
    expect(successes).toHaveLength(1);
    expect(successes[0].message.status).toBe('executed');
    const stored = await ScheduledMessage.findById(doc._id);
    expect(stored.executedAt).toBeInstanceOf(Date);
    expect(stored.attempts).toBe(1);

    const again = await deliverScheduledMessage(doc._id, { takeoverProcessing: true });
    expect(again.duplicate).toBe(true);

    const crashed = await ScheduledMessage.create({
      message: 'Retry me',
      day: '2099-01-02',
      time: '00:00',
      timezone: 'UTC',
      scheduledAt: new Date('2099-01-02T00:00:00.000Z'),
      status: 'processing',
      processingStartedAt: new Date(),
      claimToken: 'old',
    });
    const retried = await deliverScheduledMessage(crashed._id, { takeoverProcessing: true });
    expect(retried.duplicate).toBe(false);
    expect(retried.message.status).toBe('executed');

    const pending = await ScheduledMessage.create({
      message: 'Recover me',
      day: '2099-01-03',
      time: '00:00',
      timezone: 'UTC',
      scheduledAt: new Date('2099-01-03T00:00:00.000Z'),
      status: 'pending',
    });
    const exhausted = await ScheduledMessage.create({
      message: 'Do not recover',
      day: '2099-01-04',
      time: '00:00',
      timezone: 'UTC',
      scheduledAt: new Date('2099-01-04T00:00:00.000Z'),
      status: 'failed',
      attempts: 3,
    });
    const added = [];
    await recoverScheduledMessages({
      getJob: async () => null,
      add: async (name, data, options) => {
        added.push({ name, data, options });
        return { id: options.jobId };
      },
    });
    const ids = added.map((job) => job.data.scheduledMessageId);
    expect(ids).toContain(String(pending._id));
    expect(ids).not.toContain(String(exhausted._id));
  });
});
