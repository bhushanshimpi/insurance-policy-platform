const { z } = require('zod');
const ScheduledMessage = require('../../models/scheduled-message.model');
const { toScheduledInstant } = require('../../services/schedule/schedule-time');
const { enqueueScheduledMessage } = require('../../queues/scheduled-message.queue');
const { AppError } = require('../../utils/errors');

const createSchema = z.object({
  message: z.string().trim().min(1).max(2000),
  day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  time: z.string().regex(/^\d{2}:\d{2}$/),
  timezone: z.string().trim().min(1).max(100),
});

const idSchema = z.object({
  id: z.string().regex(/^[a-f\d]{24}$/i),
});

/**
 * Use: shapes a scheduled message for the API without the internal claim token.
 * Payload: doc (ScheduledMessage document).
 * Returns: { id, message, day, time, timezone, scheduledAt, status, executedAt, attempts, failureReason }.
 */
function presentScheduledMessage(doc) {
  return {
    id: String(doc._id),
    message: doc.message,
    day: doc.day,
    time: doc.time,
    timezone: doc.timezone,
    scheduledAt: doc.scheduledAt,
    status: doc.status,
    executedAt: doc.executedAt || null,
    attempts: doc.attempts,
    failureReason: doc.failureReason || null,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

/**
 * Use: stores a reminder and enqueues it for the requested local time.
 * Payload: JSON { message, day: 'YYYY-MM-DD', time: 'HH:mm', timezone }. POST /api/scheduled-messages.
 * Returns: 201 with the pending message.
 */
async function createScheduledMessage(req, res) {
  const scheduledAt = toScheduledInstant(req.body);
  const doc = await ScheduledMessage.create({
    message: req.body.message,
    day: req.body.day,
    time: req.body.time,
    timezone: req.body.timezone,
    scheduledAt,
    status: 'pending',
  });

  try {
    await enqueueScheduledMessage(req.app.locals.scheduledQueue, doc);
  } catch (error) {
    req.app.locals.logger.error(
      { err: error, scheduledMessageId: String(doc._id) },
      'Scheduled message enqueue failed; recovery will retry',
    );
  }

  res.status(201).json(presentScheduledMessage(doc));
}

/**
 * Use: reads one scheduled message.
 * Payload: path id (24-character ObjectId). GET /api/scheduled-messages/:id.
 * Returns: 200 with the message, or 404.
 */
async function getScheduledMessage(req, res) {
  const doc = await ScheduledMessage.findById(req.params.id);
  if (!doc) throw new AppError(404, 'NOT_FOUND', 'Scheduled message was not found');
  res.status(200).json(presentScheduledMessage(doc));
}

module.exports = {
  createSchema,
  idSchema,
  presentScheduledMessage,
  createScheduledMessage,
  getScheduledMessage,
};
