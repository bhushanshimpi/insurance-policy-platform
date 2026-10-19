const { loadEnv, resetEnvCache } = require('../../src/config/env');

describe('environment validation', () => {
  afterEach(() => {
    resetEnvCache();
  });

  test('accepts the minimum required configuration and applies defaults', () => {
    const env = loadEnv({
      MONGODB_URI: 'mongodb://localhost/insurance',
      REDIS_URL: 'redis://localhost:6379',
    });
    expect(env.PORT).toBe(3000);
    expect(env.CPU_THRESHOLD_PERCENT).toBe(70);
    expect(env.CPU_CONSECUTIVE_SAMPLES).toBe(3);
    expect(env.IMPORT_QUEUE_CONCURRENCY).toBe(1);
  });

  test('rejects a missing MongoDB URI', () => {
    expect(() => loadEnv({ REDIS_URL: 'redis://localhost:6379' })).toThrow();
  });

  test('rejects a CPU threshold above 100', () => {
    expect(() =>
      loadEnv({
        MONGODB_URI: 'mongodb://localhost/insurance',
        REDIS_URL: 'redis://localhost:6379',
        CPU_THRESHOLD_PERCENT: '140',
      }),
    ).toThrow();
  });

  test('parses boolean flags from strings', () => {
    const env = loadEnv({
      MONGODB_URI: 'mongodb://localhost/insurance',
      REDIS_URL: 'redis://localhost:6379',
      CPU_RESTART_ENABLED: 'false',
    });
    expect(env.CPU_RESTART_ENABLED).toBe(false);
  });
});
