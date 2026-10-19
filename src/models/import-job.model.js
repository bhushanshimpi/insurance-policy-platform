const mongoose = require('mongoose');

const importErrorSchema = new mongoose.Schema(
  {
    row: { type: Number, required: true },
    field: { type: String, required: true },
    code: { type: String, required: true },
  },
  { _id: false },
);

const importJobSchema = new mongoose.Schema(
  {
    originalFilename: { type: String, required: true, maxlength: 255 },
    storedFilename: { type: String, required: true, maxlength: 255 },
    status: {
      type: String,
      enum: ['queued', 'processing', 'completed', 'failed'],
      default: 'queued',
      required: true,
    },
    total: { type: Number, default: 0, min: 0 },
    imported: { type: Number, default: 0, min: 0 },
    skipped: { type: Number, default: 0, min: 0 },
    invalid: { type: Number, default: 0, min: 0 },
    rowErrors: { type: [importErrorSchema], default: [] },
    errorsTruncated: { type: Boolean, default: false },
    failureReason: { type: String, maxlength: 500 },
    attempts: { type: Number, default: 0, min: 0 },
    startedAt: { type: Date },
    finishedAt: { type: Date },
  },
  { timestamps: true, collection: 'import_jobs' },
);

importJobSchema.index({ status: 1, createdAt: -1 });

module.exports = mongoose.model('ImportJob', importJobSchema);
