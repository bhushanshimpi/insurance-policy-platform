const { Queue } = require('bullmq');
const { getEnv } = require('../config/env');

const IMPORT_QUEUE_NAME = 'policy-import';

/**
 * Use: creates the policy-import queue with retry and cleanup settings.
 * Payload: connection (ioredis client).
 * Returns: a BullMQ Queue.
 */
function createImportQueue(connection) {
  const env = getEnv();
  return new Queue(IMPORT_QUEUE_NAME, {
    connection,
    defaultJobOptions: {
      attempts: env.IMPORT_JOB_ATTEMPTS,
      backoff: { type: 'exponential', delay: env.IMPORT_BACKOFF_MS },
      removeOnComplete: { count: 1000, age: 24 * 3600 },
      removeOnFail: { count: 1000, age: 7 * 24 * 3600 },
    },
  });
}

module.exports = {
  IMPORT_QUEUE_NAME,
  createImportQueue,
};
