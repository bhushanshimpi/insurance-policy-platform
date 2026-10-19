// Background process for import jobs and scheduled messages.
// MongoDB remains the source of truth. Redis only carries the queue.
const { getEnv } = require('../config/env');
const { createLogger } = require('../config/logger');
const { connectDb, disconnectDb, connectWithRetry } = require('../config/db');
const { createRedisConnection, waitForRedis } = require('../config/redis');
const { createScheduledMessageQueue } = require('../queues/scheduled-message.queue');
const { createImportWorker } = require('./import.worker');
const { createScheduledMessageWorker } = require('./scheduled-message.worker');
const { recoverScheduledMessages } = require('../services/schedule/scheduled-message.service');

/**
 * Use: starts the import worker and the scheduled-message worker.
 * Payload: none. Reads MONGODB_URI and REDIS_URL.
 * Returns: nothing. The process stays up until SIGTERM or SIGINT.
 */
async function main() {
  const env = getEnv();
  const logger = createLogger({ service: 'worker' });
  await connectWithRetry(() => connectDb(env.MONGODB_URI, logger), logger, 'mongodb');

  const importConnection = createRedisConnection(env.REDIS_URL);
  const scheduleConnection = createRedisConnection(env.REDIS_URL);
  const queueConnection = createRedisConnection(env.REDIS_URL);
  await connectWithRetry(() => waitForRedis(queueConnection), logger, 'redis');

  const importWorker = createImportWorker(importConnection, logger);
  const scheduledWorker = createScheduledMessageWorker(scheduleConnection, logger);
  const scheduledQueue = createScheduledMessageQueue(queueConnection);

  await recoverScheduledMessages(scheduledQueue, logger);
  const recoveryTimer = setInterval(() => {
    recoverScheduledMessages(scheduledQueue, logger).catch((error) => {
      logger.error({ err: error }, 'Scheduled message recovery failed');
    });
  }, env.SCHEDULE_RECOVERY_INTERVAL_MS);
  recoveryTimer.unref();

  logger.info('Queue workers started');

  let shuttingDown = false;
  /**
   * Use: stops both queue workers and disconnects Redis and MongoDB.
   * Payload: signal (string, SIGTERM or SIGINT).
   * Returns: nothing. Exits the process after cleanup.
   */
  const shutdown = async (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'Shutting down workers');
    const timer = setTimeout(() => process.exit(1), env.SHUTDOWN_TIMEOUT_MS);
    timer.unref();
    clearInterval(recoveryTimer);
    await Promise.all([importWorker.close(), scheduledWorker.close()]);
    await scheduledQueue.close();
    await Promise.all([importConnection.quit(), scheduleConnection.quit(), queueConnection.quit()]);
    await disconnectDb();
    clearTimeout(timer);
    process.exit(0);
  };

  process.on('SIGTERM', () => {
    shutdown('SIGTERM').catch((error) => {
      logger.error({ err: error }, 'Worker shutdown failed');
      process.exit(1);
    });
  });
  process.on('SIGINT', () => {
    shutdown('SIGINT').catch((error) => {
      logger.error({ err: error }, 'Worker shutdown failed');
      process.exit(1);
    });
  });
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

module.exports = { main };
