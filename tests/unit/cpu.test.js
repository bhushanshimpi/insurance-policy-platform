const {
  cpuPercent,
  readProcStat,
  snapshotFromOsCpus,
} = require('../../src/services/cpu/cpu-percent');
const { createMonitorState, reduceCpuSample } = require('../../src/services/cpu/cpu-policy');

const config = {
  thresholdPercent: 70,
  consecutiveSamples: 3,
  cooldownMs: 60000,
  maxRestartsPerWindow: 2,
  restartWindowMs: 600000,
};

describe('CPU percentage', () => {
  test('calculates busy time from two system snapshots', () => {
    const percent = cpuPercent({ idle: 100, total: 200 }, { idle: 150, total: 300 });
    expect(percent).toBe(50);
  });

  test('parses the aggregate /proc/stat line and treats iowait as idle', () => {
    const fsImpl = {
      readFileSync: () => 'cpu  10 20 30 40 5 6 7 8\ncpu0 1 1 1 1 1 1 1 1\n',
    };
    expect(readProcStat(fsImpl)).toEqual({ idle: 45, total: 126, source: 'proc-stat' });
  });

  test('sums os.cpus() times across every core', () => {
    const snapshot = snapshotFromOsCpus([
      { times: { user: 10, nice: 1, sys: 5, idle: 80, irq: 4 } },
      { times: { user: 8, nice: 1, sys: 5, idle: 70, irq: 2 } },
    ]);
    expect(snapshot).toEqual({ idle: 150, total: 186, source: 'os-cpus' });
  });
});

describe('CPU restart policy', () => {
  test('restarts only after consecutive samples at or above the threshold', () => {
    let state = createMonitorState();
    const samples = [69, 80, 81];
    const actions = [];
    samples.forEach((percent, index) => {
      const reduced = reduceCpuSample(state, percent, config, 1000 + index);
      state = reduced.state;
      actions.push(reduced.decision.action);
    });
    expect(actions).toEqual(['none', 'none', 'none']);

    const third = reduceCpuSample(state, 90, config, 2000);
    expect(third.decision).toMatchObject({ action: 'restart', reason: 'threshold-exceeded' });
  });

  test('resets the consecutive counter when a sample falls below the threshold', () => {
    let state = createMonitorState();
    state = reduceCpuSample(state, 90, config, 1).state;
    state = reduceCpuSample(state, 91, config, 2).state;
    const dropped = reduceCpuSample(state, 10, config, 3);
    expect(dropped.state.consecutiveHigh).toBe(0);
    expect(dropped.decision.action).toBe('none');
  });

  test('suppresses restarts during the cooldown window', () => {
    let state = createMonitorState();
    let decision;
    for (const now of [0, 1, 2]) {
      const reduced = reduceCpuSample(state, 90, config, now);
      state = reduced.state;
      decision = reduced.decision;
    }
    expect(decision.action).toBe('restart');

    let blocked;
    for (const now of [1000, 2000, 3000]) {
      const reduced = reduceCpuSample(state, 99, config, now);
      state = reduced.state;
      blocked = reduced.decision;
    }
    expect(blocked).toMatchObject({ action: 'none', reason: 'cooldown' });
  });

  test('rate-limits restarts inside the protection window', () => {
    let state = createMonitorState();
    const unlimited = { ...config, cooldownMs: 0, maxRestartsPerWindow: 2 };
    let now = 0;
    function pushHigh() {
      let decision;
      for (let index = 0; index < 3; index += 1) {
        const reduced = reduceCpuSample(state, 90, unlimited, now);
        state = reduced.state;
        decision = reduced.decision;
        now += 1;
        if (decision.action === 'restart') return decision;
      }
      return decision;
    }

    expect(pushHigh().action).toBe('restart');
    expect(pushHigh().action).toBe('restart');
    expect(pushHigh()).toMatchObject({ action: 'none', reason: 'rate-limited' });
  });
});
