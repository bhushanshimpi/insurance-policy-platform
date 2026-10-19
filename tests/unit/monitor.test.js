const { runMonitorLoop } = require('../../src/monitor/main');
const { restartApiContainer } = require('../../src/services/cpu/docker-restart');

describe('CPU monitor loop', () => {
  test('restarts from injected samples without reading the host CPU', async () => {
    const readings = [
      { percent: null, current: { source: 'test' } },
      { percent: 80, current: { source: 'test' } },
      { percent: 81, current: { source: 'test' } },
      { percent: 82, current: { source: 'test' } },
      { percent: 10, current: { source: 'test' } },
    ];
    const restarts = [];
    const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
    await runMonitorLoop({
      config: {
        thresholdPercent: 70,
        consecutiveSamples: 3,
        cooldownMs: 60000,
        maxRestartsPerWindow: 3,
        restartWindowMs: 600000,
        sampleIntervalMs: 1,
        restartEnabled: true,
        containerName: 'insurance-api',
        socketPath: '/var/run/docker.sock',
      },
      logger,
      sample: async () => readings.shift(),
      restart: async (options) => {
        restarts.push(options.containerName);
      },
      wait: async () => {},
      now: (() => {
        let value = 0;
        return () => {
          value += 1000;
          return value;
        };
      })(),
      shouldStop: () => readings.length === 0,
    });
    expect(restarts).toEqual(['insurance-api']);
  });

  test('does not call Docker when restart is disabled', async () => {
    const readings = [
      { percent: null, current: { source: 'test' } },
      { percent: 90, current: { source: 'test' } },
      { percent: 90, current: { source: 'test' } },
      { percent: 90, current: { source: 'test' } },
    ];
    const restart = jest.fn();
    await runMonitorLoop({
      config: {
        thresholdPercent: 70,
        consecutiveSamples: 3,
        cooldownMs: 0,
        maxRestartsPerWindow: 3,
        restartWindowMs: 600000,
        sampleIntervalMs: 1,
        restartEnabled: false,
        containerName: 'insurance-api',
        socketPath: '/var/run/docker.sock',
      },
      logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
      sample: async () => readings.shift(),
      restart,
      wait: async () => {},
      now: () => Date.now(),
      shouldStop: () => readings.length === 0,
    });
    expect(restart).not.toHaveBeenCalled();
  });
});

describe('Docker restart client', () => {
  test('restarts only the named API container', async () => {
    const request = jest.fn().mockResolvedValue({ statusCode: 204, body: '' });
    await restartApiContainer({
      socketPath: '/var/run/docker.sock',
      containerName: 'insurance-api',
      request,
    });
    expect(request).toHaveBeenCalledWith({
      socketPath: '/var/run/docker.sock',
      method: 'POST',
      path: '/v1.41/containers/insurance-api/restart',
    });
  });

  test('surfaces a failed Docker response', async () => {
    await expect(
      restartApiContainer({
        socketPath: '/var/run/docker.sock',
        containerName: 'missing',
        request: async () => ({ statusCode: 404, body: 'no such container' }),
      }),
    ).rejects.toThrow(/404/);
  });
});
