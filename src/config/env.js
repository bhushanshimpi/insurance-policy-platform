const { z } = require('zod');

const booleanFromString = z.preprocess((value) => {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value === 'boolean') return value;
  if (value === 'true') return true;
  if (value === 'false') return false;
  return value;
}, z.boolean());

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  HOST: z.string().min(1).default('0.0.0.0'),
  MONGODB_URI: z.string().min(1),
  REDIS_URL: z.string().min(1),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  UPLOAD_DIR: z.string().min(1).default('./tmp/uploads'),
  MAX_UPLOAD_BYTES: z.coerce.number().int().positive().default(26_214_400),
  IMPORT_BATCH_SIZE: z.coerce.number().int().min(1).max(5000).default(500),
  IMPORT_QUEUE_CONCURRENCY: z.coerce.number().int().min(1).max(4).default(1),
  IMPORT_JOB_ATTEMPTS: z.coerce.number().int().min(1).max(10).default(3),
  IMPORT_BACKOFF_MS: z.coerce.number().int().min(100).default(5000),
  SCHEDULE_JOB_ATTEMPTS: z.coerce.number().int().min(1).max(10).default(3),
  SCHEDULE_BACKOFF_MS: z.coerce.number().int().min(100).default(5000),
  SCHEDULE_RECOVERY_INTERVAL_MS: z.coerce.number().int().min(1000).default(60_000),
  SCHEDULE_STALE_PROCESSING_MS: z.coerce.number().int().min(1000).default(120_000),
  CPU_THRESHOLD_PERCENT: z.coerce.number().min(1).max(100).default(70),
  CPU_SAMPLE_INTERVAL_MS: z.coerce.number().int().min(200).default(5000),
  CPU_CONSECUTIVE_SAMPLES: z.coerce.number().int().min(1).max(100).default(3),
  CPU_RESTART_COOLDOWN_MS: z.coerce.number().int().min(0).default(60_000),
  CPU_MAX_RESTARTS_PER_WINDOW: z.coerce.number().int().min(1).default(3),
  CPU_RESTART_WINDOW_MS: z.coerce.number().int().min(1000).default(600_000),
  CPU_RESTART_ENABLED: booleanFromString.default(true),
  API_CONTAINER_NAME: z.string().min(1).default('insurance-api'),
  DOCKER_SOCKET_PATH: z.string().min(1).default('/var/run/docker.sock'),
  SEARCH_DEFAULT_LIMIT: z.coerce.number().int().min(1).default(20),
  SEARCH_MAX_LIMIT: z.coerce.number().int().min(1).default(100),
  AGGREGATE_DEFAULT_LIMIT: z.coerce.number().int().min(1).default(20),
  AGGREGATE_MAX_LIMIT: z.coerce.number().int().min(1).default(100),
  POLICIES_PER_USER_LIMIT: z.coerce.number().int().min(1).default(50),
  SHUTDOWN_TIMEOUT_MS: z.coerce.number().int().min(1000).default(15_000),
  BODY_LIMIT: z.string().min(1).default('1mb'),
});

let cached;

/**
 * Use: validates environment variables and applies defaults.
 * Payload: source (object, optional). Defaults to process.env.
 * Returns: the parsed configuration object.
 */
function loadEnv(source = process.env) {
  return envSchema.parse(source);
}

/**
 * Use: returns the process configuration, parsing it once.
 * Payload: none.
 * Returns: the cached environment object.
 */
function getEnv() {
  if (!cached) cached = loadEnv();
  return cached;
}

/**
 * Use: clears the cached configuration so tests can load a new environment.
 * Payload: none.
 * Returns: nothing.
 */
function resetEnvCache() {
  cached = undefined;
}

module.exports = {
  envSchema,
  loadEnv,
  getEnv,
  resetEnvCache,
};
