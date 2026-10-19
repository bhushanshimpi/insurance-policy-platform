// Separate process from the API. It keeps sampling while the API container restarts.
const { getEnv } = require('../config/env');
const { createLogger } = require('../config/logger');
const { cpuPercent, resolveSnapshot } = require('../services/cpu/cpu-percent');
const { createMonitorState, reduceCpuSample } = require('../services/cpu/cpu-policy');
const { restartApiContainer } = require('../services/cpu/docker-restart');

/**
 * Use: waits between CPU samples.
 * Payload: ms (number).
 * Returns: a promise that resolves after the delay.
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Use: samples CPU until stopped and restarts the API when the policy says to.
 * Payload: { config, logger, sample?, restart?, wait?, now?, shouldStop? }.
 * config includes thresholdPercent, consecutiveSamples, cooldownMs, sampleIntervalMs, restartEnabled, containerName, socketPath.
 * Returns: the final monitor state.
 */
async function runMonitorLoop({
  config,
  logger,
  sample = defaultSample,
  restart = defaultRestart,
  wait = sleep,
  now = () => Date.now(),
  shouldStop = () => false,
}) {
  let state = createMonitorState();
  while (!shouldStop()) {
    const reading = await sample(state.baseline);
    if (reading.percent == null) {
      state = { ...state, baseline: reading.current };
      logger.info({ source: reading.current.source }, 'Collected CPU baseline');
    } else {
      const reduced = reduceCpuSample(state, reading.percent, config, now());
      state = { ...reduced.state, baseline: reading.current };
      logger.info(
        {
          cpuPercent: Number(reading.percent.toFixed(2)),
          source: reading.current.source,
          action: reduced.decision.action,
          reason: reduced.decision.reason,
          consecutiveHigh: reduced.decision.consecutiveHigh,
        },
        'CPU sample',
      );
      if (reduced.decision.action === 'restart') {
        if (!config.restartEnabled) {
          logger.warn(
            { container: config.containerName },
            'CPU threshold reached and restart is disabled',
          );
        } else {
          try {
            await restart({
              socketPath: config.socketPath,
              containerName: config.containerName,
            });
            logger.warn({ container: config.containerName }, 'Restarted API container');
          } catch (error) {
            logger.error({ err: error, container: config.containerName }, 'API restart failed');
          }
        }
      }
    }
    await wait(config.sampleIntervalMs);
  }
  return state;
}

/**
 * Use: takes one real system CPU reading.
 * Payload: previous snapshot, or null for the baseline.
 * Returns: { percent: number or null, current }.
 */
async function defaultSample(previous) {
  const current = resolveSnapshot();
  if (!previous) return { percent: null, current };
  return { percent: cpuPercent(previous, current), current };
}

/**
 * Use: asks Docker to restart the API container.
 * Payload: { socketPath, containerName }.
 * Returns: the Docker response.
 */
function defaultRestart(options) {
  return restartApiContainer(options);
}

/**
 * Use: copies CPU settings out of the environment.
 * Payload: env (optional parsed environment).
 * Returns: the monitor config object.
 */
function configFromEnv(env = getEnv()) {
  return {
    thresholdPercent: env.CPU_THRESHOLD_PERCENT,
    consecutiveSamples: env.CPU_CONSECUTIVE_SAMPLES,
    cooldownMs: env.CPU_RESTART_COOLDOWN_MS,
    maxRestartsPerWindow: env.CPU_MAX_RESTARTS_PER_WINDOW,
    restartWindowMs: env.CPU_RESTART_WINDOW_MS,
    sampleIntervalMs: env.CPU_SAMPLE_INTERVAL_MS,
    restartEnabled: env.CPU_RESTART_ENABLED,
    containerName: env.API_CONTAINER_NAME,
    socketPath: env.DOCKER_SOCKET_PATH,
  };
}

/**
 * Use: starts the CPU monitor loop in its own process.
 * Payload: none. Reads CPU_* and API_CONTAINER_NAME from the environment.
 * Returns: nothing until the process is stopped.
 */
async function main() {
  const logger = createLogger({ service: 'monitor' });
  const config = configFromEnv();
  let stop = false;
  /**
   * Use: asks the CPU loop to stop after the current sample.
   * Payload: signal (string, SIGTERM or SIGINT).
   * Returns: nothing.
   */
  const shutdown = (signal) => {
    logger.info({ signal }, 'CPU monitor shutting down');
    stop = true;
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
  logger.info(
    {
      thresholdPercent: config.thresholdPercent,
      sampleIntervalMs: config.sampleIntervalMs,
      consecutiveSamples: config.consecutiveSamples,
      containerName: config.containerName,
    },
    'CPU monitor started',
  );
  await runMonitorLoop({
    config,
    logger,
    shouldStop: () => stop,
  });
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

module.exports = {
  runMonitorLoop,
  configFromEnv,
  defaultSample,
};
