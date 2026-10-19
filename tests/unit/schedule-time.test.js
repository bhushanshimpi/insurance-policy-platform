const { DateTime } = require('luxon');
const { toScheduledInstant } = require('../../src/services/schedule/schedule-time');

describe('scheduled date and time validation', () => {
  const now = DateTime.fromISO('2026-10-19T00:00:00.000Z');

  test('converts a zoned civil time to UTC', () => {
    const instant = toScheduledInstant({
      day: '2026-10-20',
      time: '10:30',
      timezone: 'Asia/Kolkata',
      now,
    });
    expect(instant.toISOString()).toBe('2026-10-20T05:00:00.000Z');
  });

  test('rejects past times, invalid zones, and nonexistent local times', () => {
    expect(() =>
      toScheduledInstant({ day: '2020-01-01', time: '00:00', timezone: 'UTC', now }),
    ).toThrow(/future/);
    expect(() =>
      toScheduledInstant({ day: '2026-10-20', time: '10:30', timezone: 'Not/AZone', now }),
    ).toThrow(/timezone/);
    expect(() =>
      toScheduledInstant({
        day: '2026-03-08',
        time: '02:30',
        timezone: 'America/New_York',
        now: DateTime.fromISO('2026-01-01T00:00:00.000Z'),
      }),
    ).toThrow(/does not exist/);
  });
});
