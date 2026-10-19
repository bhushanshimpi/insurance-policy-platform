const User = require('../../src/models/user.model');
const Policy = require('../../src/models/policy.model');
const ScheduledMessage = require('../../src/models/scheduled-message.model');
const ImportJob = require('../../src/models/import-job.model');

describe('model validation', () => {
  test('requires a user identity and first name', async () => {
    const user = new User({});
    await expect(user.validate()).rejects.toThrow(/firstName|identityKey/);
  });

  test('requires policy number, dates, and references', async () => {
    const policy = new Policy({ policyNumber: 'P-1' });
    await expect(policy.validate()).rejects.toThrow();
  });

  test('rejects an unknown import status', async () => {
    const job = new ImportJob({
      originalFilename: 'a.csv',
      storedFilename: 'a.csv',
      status: 'bogus',
    });
    await expect(job.validate()).rejects.toThrow(/status/);
  });

  test('rejects a scheduled message without a calendar day', async () => {
    const message = new ScheduledMessage({
      message: 'Reminder',
      day: '20-10-2026',
      time: '10:30',
      timezone: 'UTC',
      scheduledAt: new Date(),
    });
    await expect(message.validate()).rejects.toThrow(/day/);
  });
});
