const mongoose = require('mongoose');

const scheduledMessageSchema = new mongoose.Schema(
  {
    message: { type: String, required: true, trim: true, maxlength: 2000 },
    day: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
    time: { type: String, required: true, match: /^\d{2}:\d{2}$/ },
    timezone: { type: String, required: true, maxlength: 100 },
    scheduledAt: { type: Date, required: true },
    status: {
      type: String,
      enum: ['pending', 'processing', 'executed', 'failed'],
      default: 'pending',
      required: true,
    },
    executedAt: { type: Date },
    attempts: { type: Number, default: 0, min: 0 },
    failureReason: { type: String, maxlength: 500 },
    claimToken: { type: String },
    processingStartedAt: { type: Date },
  },
  { timestamps: true, collection: 'scheduled_messages' },
);

scheduledMessageSchema.index({ status: 1, scheduledAt: 1 });

module.exports = mongoose.model('ScheduledMessage', scheduledMessageSchema);
