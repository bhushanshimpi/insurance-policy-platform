const { Queue } = require('bullmq');
const { getEnv } = require('../config/env');

const SCHEDULE_QUEUE_NAME = 'scheduled-messages';

/**
 * Use: creates the scheduled-messages queue.
 * Payload: connection (ioredis client).
 * Returns: a BullMQ Queue.
 */
function createScheduledMessageQueue(connection) {
  const env = getEnv();
  return new Queue(SCHEDULE_QUEUE_NAME, {
    connection,
    defaultJobOptions: {
      attempts: env.SCHEDULE_JOB_ATTEMPTS,
      backoff: { type: 'exponential', delay: env.SCHEDULE_BACKOFF_MS },
      removeOnComplete: { count: 1000, age: 24 * 3600 },
      removeOnFail: { count: 1000, age: 7 * 24 * 3600 },
    },
  });
}

/**
 * Use: calculates how long BullMQ should wait before delivering a message.
 * Payload: date (Date or ISO string).
 * Returns: delay in milliseconds, never negative.
 */
function delayUntil(date) {
  return Math.max(0, new Date(date).getTime() - Date.now());
}

/**
 * Use: adds or replaces the delayed job for one scheduled message.
 * Payload: queue (BullMQ Queue), message { _id, scheduledAt }.
 * Returns: the BullMQ job. Job data is { scheduledMessageId }.
 */
async function enqueueScheduledMessage(queue, message) {
  const jobId = String(message._id);
  const existing = await queue.getJob(jobId);
  if (existing) {
    const state = await existing.getState();
    if (['waiting', 'delayed', 'active', 'paused', 'waiting-children'].includes(state)) {
      return existing;
    }
    await existing.remove();
  }
  return queue.add(
    'deliver',
    { scheduledMessageId: jobId },
    {
      jobId,
      delay: delayUntil(message.scheduledAt),
    },
  );
}

module.exports = {
  SCHEDULE_QUEUE_NAME,
  createScheduledMessageQueue,
  enqueueScheduledMessage,
  delayUntil,
};
