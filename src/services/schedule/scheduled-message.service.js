// The message is stored as pending when it is scheduled.
// At the requested time this function inserts the delivery by moving that row to executed.
// The text is never evaluated as code. The claim update is atomic, so a retry cannot deliver twice.
const ScheduledMessage = require('../../models/scheduled-message.model');
const { enqueueScheduledMessage } = require('../../queues/scheduled-message.queue');
const { getEnv } = require('../../config/env');

/**
 * Use: marks one scheduled message executed at delivery time.
 * Payload: id (ObjectId), options { takeoverProcessing?: boolean }.
 * Returns: { duplicate, message }.
 */
async function deliverScheduledMessage(id, options = {}) {
  const existing = await ScheduledMessage.findById(id);
  if (!existing) {
    const error = new Error('Scheduled message was not found');
    error.code = 'NOT_FOUND';
    throw error;
  }
  if (existing.status === 'executed') return { duplicate: true, message: existing };

  const token = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const claimed = await ScheduledMessage.findOneAndUpdate(
    { _id: id, status: { $in: ['pending', 'failed'] } },
    {
      $set: {
        status: 'processing',
        claimToken: token,
        processingStartedAt: new Date(),
        failureReason: null,
      },
    },
    { new: true },
  );

  let owner = claimed;
  if (!owner && options.takeoverProcessing) {
    owner = await ScheduledMessage.findOneAndUpdate(
      { _id: id, status: 'processing' },
      { $set: { claimToken: token, processingStartedAt: new Date() } },
      { new: true },
    );
  } else if (!owner) {
    const env = getEnv();
    const staleBefore = new Date(Date.now() - env.SCHEDULE_STALE_PROCESSING_MS);
    owner = await ScheduledMessage.findOneAndUpdate(
      { _id: id, status: 'processing', processingStartedAt: { $lte: staleBefore } },
      { $set: { claimToken: token, processingStartedAt: new Date() } },
      { new: true },
    );
  }

  if (!owner || owner.claimToken !== token) {
    const current = await ScheduledMessage.findById(id);
    return { duplicate: true, message: current };
  }

  const executed = await ScheduledMessage.findOneAndUpdate(
    { _id: id, status: 'processing', claimToken: token },
    {
      $set: { status: 'executed', executedAt: new Date() },
      $inc: { attempts: 1 },
    },
    { new: true },
  );

  if (!executed) {
    const current = await ScheduledMessage.findById(id);
    return { duplicate: true, message: current };
  }

  return { duplicate: false, message: executed };
}

/**
 * Use: records a terminal delivery failure so recovery does not retry forever.
 * Payload: id (ObjectId), reason (string).
 * Returns: nothing.
 */
async function markScheduledMessageFailed(id, reason) {
  await ScheduledMessage.updateOne(
    { _id: id, status: { $in: ['pending', 'processing'] } },
    {
      $set: {
        status: 'failed',
        failureReason: String(reason || 'Delivery failed').slice(0, 500),
        attempts: getEnv().SCHEDULE_JOB_ATTEMPTS,
      },
    },
  );
}

/**
 * Use: puts pending or stuck messages back on the Redis queue after a restart.
 * Payload: queue (BullMQ Queue), logger (optional).
 * Returns: { requeued }.
 */
async function recoverScheduledMessages(queue, logger) {
  const messages = await ScheduledMessage.find({
    status: { $in: ['pending', 'processing', 'failed'] },
    scheduledAt: { $exists: true },
  });

  let requeued = 0;
  for (const message of messages) {
    if (message.status === 'failed' && message.attempts >= getEnv().SCHEDULE_JOB_ATTEMPTS) {
      continue;
    }
    await enqueueScheduledMessage(queue, message);
    requeued += 1;
  }
  if (logger) logger.info({ requeued }, 'Scheduled message recovery finished');
  return { requeued };
}

module.exports = {
  deliverScheduledMessage,
  markScheduledMessageFailed,
  recoverScheduledMessages,
};
