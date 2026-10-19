// Converts a calendar day and clock time in an IANA timezone to a UTC instant.
// A local time that does not exist, such as a daylight-saving gap, is rejected.
const { DateTime } = require('luxon');
const { AppError } = require('../../utils/errors');

/**
 * Use: converts a zoned calendar time to UTC and rejects past or impossible times.
 * Payload: { day: 'YYYY-MM-DD', time: 'HH:mm', timezone: IANA name, now?: Luxon DateTime }.
 * Returns: a JavaScript Date in UTC.
 */
function toScheduledInstant({ day, time, timezone, now = DateTime.utc() }) {
  const zoneProbe = DateTime.now().setZone(timezone);
  if (!zoneProbe.isValid) {
    throw new AppError(400, 'INVALID_TIMEZONE', 'timezone must be a valid IANA timezone');
  }

  const scheduled = DateTime.fromISO(`${day}T${time}`, { zone: timezone });
  if (!scheduled.isValid) {
    throw new AppError(
      400,
      'INVALID_SCHEDULE',
      'day and time do not form a valid local date in the supplied timezone',
    );
  }

  const roundTrip = scheduled.toFormat('yyyy-MM-dd HH:mm');
  if (roundTrip !== `${day} ${time}`) {
    throw new AppError(
      400,
      'INVALID_SCHEDULE',
      'The local time does not exist in the supplied timezone',
    );
  }

  if (scheduled.toUTC() <= now.toUTC()) {
    throw new AppError(400, 'SCHEDULE_IN_THE_PAST', 'The scheduled time must be in the future');
  }

  return scheduled.toUTC().toJSDate();
}

module.exports = {
  toScheduledInstant,
};
