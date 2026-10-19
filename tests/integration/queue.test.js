const fs = require('fs');
const path = require('path');
const { RedisMemoryServer } = require('redis-memory-server');
const { getEnv } = require('../../src/config/env');
const { createRedisConnection } = require('../../src/config/redis');
const { createImportQueue } = require('../../src/queues/import.queue');
const { createScheduledMessageQueue } = require('../../src/queues/scheduled-message.queue');
const { createImportWorker } = require('../../src/workers/import.worker');
const { createScheduledMessageWorker } = require('../../src/workers/scheduled-message.worker');
const ImportJob = require('../../src/models/import-job.model');
const Policy = require('../../src/models/policy.model');
const ScheduledMessage = require('../../src/models/scheduled-message.model');
const { startMongo, stopMongo, clearMongo } = require('../helpers/db');

const csv = [
  'agent,firstname,dob,address,phone,state,zip,email,gender,userType,account_name,category_name,company_name,policy_number,policy_start_date,policy_end_date',
  'Ava Agent,Jane,1991-02-02,1 Main,555-0101,CA,94105,jane@example.com,F,client,Household,Auto,Acme,POL-Q1,2024-01-01,2025-01-01',
].join('\n');

describe('BullMQ with Redis', () => {
  let redisServer;
  const connections = [];
  const closers = [];

  beforeAll(async () => {
    await startMongo();
    redisServer = new RedisMemoryServer();
    await redisServer.getPort();
  }, 120000);

  afterAll(async () => {
    await Promise.all(closers.map((close) => close().catch(() => {})));
    await Promise.all(connections.map((connection) => connection.quit().catch(() => {})));
    if (redisServer) await redisServer.stop();
    await stopMongo();
  });

  afterEach(clearMongo);

  async function redisUrl() {
    const host = await redisServer.getHost();
    const port = await redisServer.getPort();
    return `redis://${host}:${port}`;
  }

  function connect() {
    return createRedisConnection(process.env.REDIS_URL);
  }

  beforeEach(async () => {
    process.env.REDIS_URL = await redisUrl();
  });

  test('an import worker parses a file from a queued job', async () => {
    const logger = { info() {}, warn() {}, error() {} };
    const queueConnection = connect();
    const workerConnection = connect();
    connections.push(queueConnection, workerConnection);
    const queue = createImportQueue(queueConnection);
    const worker = createImportWorker(workerConnection, logger);
    closers.push(
      () => worker.close(),
      () => queue.close(),
    );
    await worker.waitUntilReady();

    const uploadDir = getEnv().UPLOAD_DIR;
    fs.mkdirSync(uploadDir, { recursive: true });
    const storedFilename = `queue-${Date.now()}.csv`;
    fs.writeFileSync(path.join(uploadDir, storedFilename), csv);
    const job = await ImportJob.create({
      originalFilename: 'policies.csv',
      storedFilename,
      status: 'queued',
    });

    const completed = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Import job timed out')), 20000);
      worker.on('completed', (completedJob) => {
        if (completedJob.id !== String(job._id)) return;
        clearTimeout(timer);
        resolve();
      });
      worker.on('failed', (failedJob, error) => {
        if (!failedJob || failedJob.id !== String(job._id)) return;
        clearTimeout(timer);
        reject(error);
      });
    });

    await queue.add(
      'import',
      { importJobId: String(job._id), storedFilename },
      { jobId: String(job._id) },
    );
    await completed;

    const stored = await ImportJob.findById(job._id);
    expect(stored.status).toBe('completed');
    expect(stored.imported).toBe(1);
    expect(await Policy.countDocuments({ policyNumber: 'POL-Q1' })).toBe(1);
    expect(fs.existsSync(path.join(uploadDir, storedFilename))).toBe(false);
  });

  test('a delayed scheduled message is executed by the worker', async () => {
    const logger = { info() {}, warn() {}, error() {} };
    const queueConnection = connect();
    const workerConnection = connect();
    connections.push(queueConnection, workerConnection);
    const queue = createScheduledMessageQueue(queueConnection);
    const worker = createScheduledMessageWorker(workerConnection, logger);
    closers.push(
      () => worker.close(),
      () => queue.close(),
    );
    await worker.waitUntilReady();

    const doc = await ScheduledMessage.create({
      message: 'Deliver from Redis',
      day: '2099-01-01',
      time: '00:00',
      timezone: 'UTC',
      scheduledAt: new Date(Date.now() + 500),
      status: 'pending',
    });

    const completed = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Scheduled job timed out')), 20000);
      worker.on('completed', async (completedJob) => {
        if (completedJob.id !== String(doc._id)) return;
        clearTimeout(timer);
        resolve();
      });
      worker.on('failed', (failedJob, error) => {
        if (!failedJob || failedJob.id !== String(doc._id)) return;
        clearTimeout(timer);
        reject(error);
      });
    });

    await queue.add(
      'deliver',
      { scheduledMessageId: String(doc._id) },
      { jobId: String(doc._id), delay: 300 },
    );
    await completed;

    const stored = await ScheduledMessage.findById(doc._id);
    expect(stored.status).toBe('executed');
    expect(stored.executedAt).toBeInstanceOf(Date);
  });
});
