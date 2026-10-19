// Restart only after several consecutive samples at or above the threshold (default 70%),
// then honor a cooldown and a maximum number of restarts in the configured window.
/**
 * Use: creates the counters the CPU monitor keeps between samples.
 * Payload: none.
 * Returns: { consecutiveHigh, lastRestartAt, restartTimestamps, baseline }.
 */
function createMonitorState() {
  return {
    consecutiveHigh: 0,
    lastRestartAt: null,
    restartTimestamps: [],
    baseline: null,
  };
}

/**
 * Use: decides whether this CPU sample should restart the API.
 * Payload: { cpuPercent, state, config: { thresholdPercent, consecutiveSamples, cooldownMs, maxRestartsPerWindow, restartWindowMs }, now }.
 * Returns: { action: 'none' | 'restart', reason, consecutiveHigh, restartsInWindow, cpuPercent }.
 */
function evaluateCpuSample({ cpuPercent: percent, state, config, now }) {
  const high = percent >= config.thresholdPercent;
  const consecutiveHigh = high ? state.consecutiveHigh + 1 : 0;
  const windowStart = now - config.restartWindowMs;
  const restartsInWindow = state.restartTimestamps.filter((timestamp) => timestamp > windowStart);

  let action = 'none';
  let reason = high ? 'waiting-for-consecutive-samples' : 'below-threshold';

  if (consecutiveHigh >= config.consecutiveSamples) {
    const cooledDown =
      state.lastRestartAt == null || now - state.lastRestartAt >= config.cooldownMs;
    if (!cooledDown) {
      reason = 'cooldown';
    } else if (restartsInWindow.length >= config.maxRestartsPerWindow) {
      reason = 'rate-limited';
    } else {
      action = 'restart';
      reason = 'threshold-exceeded';
    }
  }

  return {
    action,
    reason,
    consecutiveHigh,
    restartsInWindow,
    cpuPercent: percent,
  };
}

/**
 * Use: applies one CPU sample and returns the next monitor state.
 * Payload: state, percent (number), config, now (epoch milliseconds).
 * Returns: { state, decision }.
 */
function reduceCpuSample(state, percent, config, now) {
  const decision = evaluateCpuSample({
    cpuPercent: percent,
    state,
    config,
    now,
  });

  const next = {
    ...state,
    consecutiveHigh: decision.action === 'restart' ? 0 : decision.consecutiveHigh,
    restartTimestamps: decision.restartsInWindow,
  };

  if (decision.action === 'restart') {
    next.lastRestartAt = now;
    next.restartTimestamps = [...decision.restartsInWindow, now];
  }

  return { state: next, decision };
}

module.exports = {
  createMonitorState,
  evaluateCpuSample,
  reduceCpuSample,
};
