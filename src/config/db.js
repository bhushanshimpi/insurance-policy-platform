const mongoose = require('mongoose');

/**
 * Use: connects Mongoose and logs the target without a password.
 * Payload: uri (string), logger (Pino logger).
 * Returns: the Mongoose connection.
 */
async function connectDb(uri, logger) {
  mongoose.set('strictQuery', true);
  await mongoose.connect(uri);
  logger.info({ uri: sanitizeMongoUri(uri) }, 'MongoDB connected');
  return mongoose.connection;
}

/**
 * Use: closes MongoDB during shutdown.
 * Payload: none.
 * Returns: nothing.
 */
async function disconnectDb() {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }
}

/**
 * Use: hides credentials before a MongoDB URI is written to a log.
 * Payload: uri (string).
 * Returns: the URI with the user and password replaced.
 */
function sanitizeMongoUri(uri) {
  return String(uri).replace(/\/\/([^:@/]+):([^@/]+)@/, '//[Redacted]:[Redacted]@');
}

/**
 * Use: retries a dependency connection so the process does not listen too early.
 * Payload: connect (async function), logger, label (string), attempts (number), delayMs (number).
 * Returns: the value from connect().
 */
async function connectWithRetry(connect, logger, label, attempts = 30, delayMs = 1000) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await connect();
    } catch (error) {
      lastError = error;
      logger.warn({ err: error, attempt, label }, 'Dependency connection failed');
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  throw lastError;
}

module.exports = {
  connectDb,
  disconnectDb,
  connectWithRetry,
  sanitizeMongoUri,
};
