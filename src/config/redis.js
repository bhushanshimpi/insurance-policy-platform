const IORedis = require('ioredis');

/**
 * Use: opens a Redis connection that BullMQ can use for blocking commands.
 * Payload: url (string), for example redis://redis:6379.
 * Returns: an ioredis client.
 */
function createRedisConnection(url) {
  return new IORedis(url, {
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
  });
}

/**
 * Use: confirms Redis answers before the API or worker starts.
 * Payload: connection (ioredis client).
 * Returns: the same connection after a PONG.
 */
async function waitForRedis(connection) {
  const result = await connection.ping();
  if (result !== 'PONG') {
    throw new Error('Redis ping failed');
  }
  return connection;
}

module.exports = {
  createRedisConnection,
  waitForRedis,
};
