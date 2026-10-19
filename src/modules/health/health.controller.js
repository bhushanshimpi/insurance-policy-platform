const mongoose = require('mongoose');

/**
 * Use: liveness probe. It does not check the database.
 * Payload: none. GET /health/live.
 * Returns: 200 { status: 'ok' }.
 */
function live(_req, res) {
  res.status(200).json({ status: 'ok' });
}

/**
 * Use: readiness probe for MongoDB and Redis.
 * Payload: none. GET /health/ready. Uses the Redis client on app.locals.
 * Returns: 200 { status: 'ready', checks } or 503 { status: 'not_ready', checks }.
 */
async function ready(req, res) {
  const checks = {
    mongodb: mongoose.connection.readyState === 1,
    redis: false,
  };
  try {
    checks.redis = (await req.app.locals.redis.ping()) === 'PONG';
  } catch (_error) {
    checks.redis = false;
  }
  const ok = checks.mongodb && checks.redis;
  res.status(ok ? 200 : 503).json({
    status: ok ? 'ready' : 'not_ready',
    checks,
  });
}

module.exports = { live, ready };
