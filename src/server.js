// HTTP process. It does not accept requests until MongoDB and Redis are connected,
// and it does not restart itself when CPU is high. The monitor container does that.
const { getEnv } = require('./config/env');
const { createLogger } = require('./config/logger');
const { connectDb, disconnectDb, connectWithRetry } = require('./config/db');
const { createRedisConnection, waitForRedis } = require('./config/redis');
const { createImportQueue } = require('./queues/import.queue');
const { createScheduledMessageQueue } = require('./queues/scheduled-message.queue');
const { createApp } = require('./app');

/**
 * Use: connects MongoDB and Redis, then starts listening.
 * Payload: none. Reads the environment.
 * Returns: the HTTP server. Listens on HOST and PORT.
 */
async function start() {
  const env = getEnv();
  const logger = createLogger({ service: 'api' });
  await connectWithRetry(() => connectDb(env.MONGODB_URI, logger), logger, 'mongodb');

  const redis = createRedisConnection(env.REDIS_URL);
  const importConnection = createRedisConnection(env.REDIS_URL);
  const scheduleConnection = createRedisConnection(env.REDIS_URL);
  await connectWithRetry(() => waitForRedis(redis), logger, 'redis');

  const importQueue = createImportQueue(importConnection);
  const scheduledQueue = createScheduledMessageQueue(scheduleConnection);
  const app = createApp({ logger, redis, importQueue, scheduledQueue, env });
  const server = await new Promise((resolve, reject) => {
    const instance = app.listen(env.PORT, env.HOST);
    instance.once('listening', () => resolve(instance));
    instance.once('error', reject);
  });
  logger.info({ port: env.PORT, host: env.HOST }, 'API listening');

  let shuttingDown = false;
  /**
   * Use: closes the HTTP server, queues, Redis, and MongoDB.
   * Payload: signal (string, SIGTERM or SIGINT).
   * Returns: nothing. Exits the process after cleanup.
   */
  const shutdown = async (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'Shutting down API');
    const timer = setTimeout(() => process.exit(1), env.SHUTDOWN_TIMEOUT_MS);
    timer.unref();
    await new Promise((resolve) => server.close(resolve));
    await importQueue.close();
    await scheduledQueue.close();
    await Promise.all([redis.quit(), importConnection.quit(), scheduleConnection.quit()]);
    await disconnectDb();
    clearTimeout(timer);
    process.exit(0);
  };

  process.on('SIGTERM', () => {
    shutdown('SIGTERM').catch((error) => {
      logger.error({ err: error }, 'API shutdown failed');
      process.exit(1);
    });
  });
  process.on('SIGINT', () => {
    shutdown('SIGINT').catch((error) => {
      logger.error({ err: error }, 'API shutdown failed');
      process.exit(1);
    });
  });

  return server;
}

if (require.main === module) {
  start().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

module.exports = { start };
