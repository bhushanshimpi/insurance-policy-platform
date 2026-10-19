// System-wide CPU percent, not the CPU of this Node process.
// On Linux the aggregate /proc/stat line is used. Idle includes idle plus iowait.
// Elsewhere the same delta is taken from os.cpus() across every core.
const fs = require('fs');

/**
 * Use: reads the aggregate CPU counters from Linux /proc/stat.
 * Payload: fsImpl (optional fs-like object with readFileSync). Used by tests.
 * Returns: { idle, total, source: 'proc-stat' }.
 */
function readProcStat(fsImpl = fs) {
  const text = fsImpl.readFileSync('/proc/stat', 'utf8');
  const line = text.split('\n').find((entry) => entry.startsWith('cpu '));
  if (!line) {
    throw new Error('/proc/stat did not contain an aggregate cpu line');
  }
  const parts = line.trim().split(/\s+/).slice(1).map(Number);
  if (parts.some((value) => !Number.isFinite(value))) {
    throw new Error('/proc/stat cpu counters were not numeric');
  }
  const idle = parts[3] + (parts[4] || 0);
  const total = parts.reduce((sum, value) => sum + value, 0);
  return { idle, total, source: 'proc-stat' };
}

/**
 * Use: sums CPU times across every logical core.
 * Payload: cpus (array from os.cpus()).
 * Returns: { idle, total, source: 'os-cpus' }.
 */
function snapshotFromOsCpus(cpus) {
  let idle = 0;
  let total = 0;
  for (const cpu of cpus) {
    const times = cpu.times;
    idle += times.idle;
    total += times.user + times.nice + times.sys + times.idle + times.irq;
  }
  return { idle, total, source: 'os-cpus' };
}

/**
 * Use: turns two cumulative snapshots into a system-wide CPU percentage.
 * Payload: previous { idle, total }, next { idle, total }.
 * Returns: a number from 0 to 100.
 */
function cpuPercent(previous, next) {
  const totalDelta = next.total - previous.total;
  const idleDelta = next.idle - previous.idle;
  if (totalDelta <= 0) return 0;
  const busy = totalDelta - idleDelta;
  return Math.max(0, Math.min(100, (busy / totalDelta) * 100));
}

/**
 * Use: chooses /proc/stat on Linux and os.cpus() everywhere else.
 * Payload: options { readSnapshot?, preferProcStat?, fsImpl?, osImpl? }.
 * Returns: { idle, total, source }.
 */
function resolveSnapshot(options = {}) {
  if (options.readSnapshot) return options.readSnapshot();
  if (options.preferProcStat !== false && fs.existsSync('/proc/stat')) {
    try {
      return readProcStat(options.fsImpl);
    } catch (error) {
      if (!options.osImpl) throw error;
    }
  }
  const osImpl = options.osImpl || require('os');
  return snapshotFromOsCpus(osImpl.cpus());
}

module.exports = {
  readProcStat,
  snapshotFromOsCpus,
  cpuPercent,
  resolveSnapshot,
};
