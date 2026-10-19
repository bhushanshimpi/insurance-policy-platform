const pino = require('pino');
const { getEnv } = require('./env');

/**
 * Use: creates a JSON logger that redacts personal fields.
 * Payload: bindings (object, optional), such as { service: 'api' }.
 * Returns: a Pino logger.
 */
function createLogger(bindings = {}) {
  const env = getEnv();
  return pino({
    level: env.LOG_LEVEL,
    base: bindings,
    redact: {
      paths: [
        'req.headers.authorization',
        'req.headers.cookie',
        'email',
        'phone',
        'address',
        'dob',
        'password',
        '*.email',
        '*.phone',
        '*.address',
        '*.dob',
        '*.password',
      ],
      censor: '[Redacted]',
    },
  });
}

module.exports = { createLogger };
