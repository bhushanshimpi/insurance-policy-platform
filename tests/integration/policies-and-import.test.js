const fs = require('fs');
const os = require('os');
const path = require('path');
const request = require('supertest');
const mongoose = require('mongoose');
const { createApp } = require('../../src/app');
const { getEnv } = require('../../src/config/env');
const ImportJob = require('../../src/models/import-job.model');
const User = require('../../src/models/user.model');
const Policy = require('../../src/models/policy.model');
const Agent = require('../../src/models/agent.model');
const Account = require('../../src/models/account.model');
const Lob = require('../../src/models/lob.model');
const Carrier = require('../../src/models/carrier.model');
const { runImport } = require('../../src/services/import/run-import');
const { startMongo, stopMongo, clearMongo } = require('../helpers/db');

const headers = [
  'agent',
  'firstname',
  'dob',
  'address',
  'phone',
  'state',
  'zip',
  'email',
  'gender',
  'userType',
  'account_name',
  'category_name',
  'company_name',
  'policy_number',
  'policy_start_date',
  'policy_end_date',
  'city',
  'producer',
  'policy_type',
  'premium_amount',
];

function csvRow(values) {
  return values.map((value) => `"${String(value).replace(/"/g, '""')}"`).join(',');
}

function buildCsv() {
  const rows = [
    headers,
    [
      'Ava Agent',
      'John',
      '1990-01-02',
      '1 Main',
      '555-0100',
      'CA',
      '94105',
      'john.one@example.com',
      'M',
      'client',
      'Household',
      'Auto',
      'Acme',
      'POL-1',
      '2024-01-01',
      '2025-01-01',
      'Austin',
      'Pat',
      'personal',
      '100',
    ],
    [
      'Ava Agent',
      'John',
      '1980-05-05',
      '2 Main',
      '555-0199',
      'TX',
      '73301',
      'john.two@example.com',
      'M',
      'client',
      'Business',
      'Home',
      'Globex',
      'POL-2',
      '2024-02-01',
      '2025-02-01',
      'Dallas',
      'Sam',
      'commercial',
      '250',
    ],
    [
      'Ava Agent',
      'John',
      '1990-01-02',
      '1 Main',
      '555-0100',
      'CA',
      '94105',
      'john.one@example.com',
      'M',
      'client',
      'Household',
      'Auto',
      'Acme',
      'POL-1',
      '2024-01-01',
      '2025-01-01',
      'Austin',
      'Pat',
      'personal',
      '100',
    ],
    [
      'Ava Agent',
      'John',
      '1990-01-02',
      '1 Main',
      '555-0100',
      'CA',
      '94105',
      'not-an-email',
      'M',
      'client',
      'Household',
      'Auto',
      'Acme',
      'POL-3',
      '2024-01-01',
      '2025-01-01',
      'Austin',
      'Pat',
      'personal',
      '100',
    ],
  ];
  return rows.map(csvRow).join('\n');
}

describe('import pipeline', () => {
  beforeAll(startMongo);
  afterAll(stopMongo);
  afterEach(clearMongo);

  test('upserts related records, skips in-file duplicates, and is idempotent', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'import-'));
    const filePath = path.join(directory, 'policies.csv');
    fs.writeFileSync(filePath, buildCsv());
    const job = await ImportJob.create({
      originalFilename: 'policies.csv',
      storedFilename: 'policies.csv',
      status: 'queued',
    });

    const first = await runImport({ importJobId: job._id, filePath, batchSize: 2 });
    expect(first).toMatchObject({ total: 4, imported: 2, skipped: 1, invalid: 1 });
    expect(await User.countDocuments()).toBe(2);
    expect(await Policy.countDocuments()).toBe(2);
    expect(await Agent.countDocuments()).toBe(1);
    expect(await Account.countDocuments()).toBe(2);
    expect(await Lob.countDocuments()).toBe(2);
    expect(await Carrier.countDocuments()).toBe(2);

    const policy = await Policy.findOne({ policyNumber: 'POL-1' })
      .populate('user')
      .populate('lob')
      .populate('carrier');
    expect(policy.user.email).toBe('john.one@example.com');
    expect(policy.lob.categoryName).toBe('Auto');
    expect(policy.carrier.companyName).toBe('Acme');
    expect(policy.premiumAmount).toBe(100);

    const stored = await ImportJob.findById(job._id);
    expect(stored.status).toBe('completed');
    expect(JSON.stringify(stored.rowErrors)).not.toContain('not-an-email');
    expect(stored.rowErrors.map((error) => error.code)).toEqual(
      expect.arrayContaining(['DUPLICATE_POLICY_IN_FILE', 'INVALID_EMAIL']),
    );

    const secondJob = await ImportJob.create({
      originalFilename: 'policies.csv',
      storedFilename: 'policies.csv',
      status: 'queued',
    });
    await runImport({ importJobId: secondJob._id, filePath, batchSize: 2 });
    expect(await Policy.countDocuments()).toBe(2);
    expect(await User.countDocuments()).toBe(2);
  });

  test('queues an upload and exposes job state transitions through the API', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'upload-'));
    const env = getEnv();
    const previousUpload = env.UPLOAD_DIR;
    env.UPLOAD_DIR = directory;
    const added = [];
    const app = createApp({
      env,
      upload: undefined,
      redis: { ping: async () => 'PONG' },
      importQueue: {
        add: async (_name, data) => {
          added.push(data);
          return { id: data.importJobId };
        },
      },
      scheduledQueue: { add: async () => ({ id: '1' }), getJob: async () => null },
    });

    const response = await request(app)
      .post('/api/imports')
      .attach('file', Buffer.from(buildCsv()), 'policies.csv');
    expect(response.status).toBe(202);
    expect(response.body.status).toBe('queued');
    expect(added).toHaveLength(1);

    const filePath = path.join(directory, added[0].storedFilename);
    await runImport({ importJobId: added[0].importJobId, filePath, batchSize: 2 });
    const status = await request(app).get(`/api/imports/${response.body.id}`);
    expect(status.status).toBe(200);
    expect(status.body).toMatchObject({ status: 'completed', imported: 2, skipped: 1, invalid: 1 });

    const text = await request(app)
      .post('/api/imports')
      .attach('file', Buffer.from('hello'), 'notes.txt');
    expect(text.status).toBe(415);
    expect(text.body.error.code).toBe('UNSUPPORTED_MEDIA_TYPE');

    env.UPLOAD_DIR = previousUpload;
  });
});

describe('policy search and aggregation', () => {
  beforeAll(startMongo);
  afterAll(stopMongo);
  afterEach(clearMongo);

  async function seed() {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'policies-'));
    const filePath = path.join(directory, 'policies.csv');
    fs.writeFileSync(filePath, buildCsv());
    const job = await ImportJob.create({
      originalFilename: 'policies.csv',
      storedFilename: 'policies.csv',
      status: 'queued',
    });
    await runImport({ importJobId: job._id, filePath, batchSize: 10 });
    const lob = await Lob.findOne({ categoryName: 'Auto' });
    const carrier = await Carrier.findOne({ companyName: 'Acme' });
    await Policy.create({
      policyNumber: 'ORPHAN-1',
      policyStartDate: new Date('2024-01-01'),
      policyEndDate: new Date('2025-01-01'),
      user: new mongoose.Types.ObjectId(),
      lob: lob._id,
      carrier: carrier._id,
    });
  }

  test('returns each same-named user separately and ignores regex metacharacters', async () => {
    await seed();
    const app = createApp({
      redis: { ping: async () => 'PONG' },
      importQueue: { add: async () => ({}) },
      scheduledQueue: { add: async () => ({}) },
    });

    const response = await request(app).get('/api/policies/search').query({ username: 'JOHN' });
    expect(response.status).toBe(200);
    expect(response.body.total).toBe(2);
    expect(response.body.results).toHaveLength(2);
    const policyNumbers = response.body.results.flatMap((result) =>
      result.policies.map((policy) => policy.policyNumber),
    );
    expect(policyNumbers.sort()).toEqual(['POL-1', 'POL-2']);
    expect(JSON.stringify(response.body)).not.toMatch(/555-0100|1 Main|1990-01-02/);
    expect(response.body.results[0].policies[0].category.categoryName).toBeTruthy();
    expect(response.body.results[0].policies[0].carrier.companyName).toBeTruthy();

    const literal = await request(app).get('/api/policies/search').query({ username: 'John.*' });
    expect(literal.status).toBe(200);
    expect(literal.body.total).toBe(0);

    const missing = await request(app).get('/api/policies/search');
    expect(missing.status).toBe(400);
    expect(missing.body.error.code).toBe('VALIDATION_ERROR');
  });

  test('counts policies per user and labels missing users', async () => {
    await seed();
    const app = createApp({
      redis: { ping: async () => 'PONG' },
      importQueue: { add: async () => ({}) },
      scheduledQueue: { add: async () => ({}) },
    });
    const response = await request(app).get('/api/policies/aggregate').query({ limit: 10 });
    expect(response.status).toBe(200);
    expect(response.body.total).toBe(3);
    const names = response.body.results.map((row) => row.displayName).sort();
    expect(names).toEqual(['John', 'John', 'Unknown']);
    const counts = response.body.results.map((row) => row.policyCount).sort();
    expect(counts).toEqual([1, 1, 1]);
  });
});
