const { Worker, UnrecoverableError } = require('bullmq');
const { getEnv } = require('../config/env');
const { SCHEDULE_QUEUE_NAME } = require('../queues/scheduled-message.queue');
const {
  deliverScheduledMessage,
  markScheduledMessageFailed,
} = require('../services/schedule/scheduled-message.service');

/**
 * Use: delivers scheduled messages when their delayed jobs become due.
 * Payload: connection (ioredis client), logger.
 * Job payload: { scheduledMessageId }.
 * Returns: a BullMQ Worker.
 */
function createScheduledMessageWorker(connection, logger) {
  const env = getEnv();
  const worker = new Worker(
    SCHEDULE_QUEUE_NAME,
    async (job) => {
      const result = await deliverScheduledMessage(job.data.scheduledMessageId, {
        takeoverProcessing: job.attemptsMade > 1,
      });
      if (result.duplicate) {
        logger.info(
          { scheduledMessageId: job.data.scheduledMessageId },
          'Skipped duplicate delivery',
        );
      } else {
        logger.info(
          {
            scheduledMessageId: job.data.scheduledMessageId,
            executedAt: result.message.executedAt,
          },
          'Scheduled message inserted',
        );
      }
      return { duplicate: result.duplicate, status: result.message && result.message.status };
    },
    {
      connection,
      concurrency: 5,
    },
  );

  worker.on('failed', async (job, error) => {
    logger.error({ err: error, jobId: job && job.id }, 'Scheduled message attempt failed');
    if (!job) return;
    if (
      error instanceof UnrecoverableError ||
      job.attemptsMade >= (job.opts.attempts || env.SCHEDULE_JOB_ATTEMPTS)
    ) {
      await markScheduledMessageFailed(job.data.scheduledMessageId, error.message);
    }
  });

  return worker;
}

module.exports = { createScheduledMessageWorker };
