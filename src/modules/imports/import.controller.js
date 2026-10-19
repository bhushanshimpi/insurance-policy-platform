const fs = require('fs');
const path = require('path');
const { z } = require('zod');
const ImportJob = require('../../models/import-job.model');
const { AppError } = require('../../utils/errors');
const { getEnv } = require('../../config/env');

const objectIdSchema = z.object({
  jobId: z.string().regex(/^[a-f\d]{24}$/i),
});

/**
 * Use: shapes an import job for the API without the stored file path.
 * Payload: job (ImportJob document).
 * Returns: { id, originalFilename, status, total, imported, skipped, invalid, errors, ... }.
 */
function presentImportJob(job) {
  return {
    id: String(job._id),
    originalFilename: job.originalFilename,
    status: job.status,
    total: job.total,
    imported: job.imported,
    skipped: job.skipped,
    invalid: job.invalid,
    errors: job.rowErrors,
    errorsTruncated: job.errorsTruncated,
    failureReason: job.failureReason || null,
    attempts: job.attempts,
    startedAt: job.startedAt || null,
    finishedAt: job.finishedAt || null,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
  };
}

/**
 * Use: rejects an empty upload and a file that claims to be XLSX but is not a ZIP workbook.
 * Payload: filePath (string), extension ('.csv' or '.xlsx').
 * Returns: nothing. Throws AppError when the content is invalid.
 */
function assertUploadContent(filePath, extension) {
  const handle = fs.openSync(filePath, 'r');
  try {
    const buffer = Buffer.alloc(4);
    const bytes = fs.readSync(handle, buffer, 0, 4, 0);
    if (bytes === 0) {
      throw new AppError(400, 'EMPTY_FILE', 'The uploaded file is empty');
    }
    if (extension === '.xlsx' && (buffer[0] !== 0x50 || buffer[1] !== 0x4b)) {
      throw new AppError(400, 'INVALID_FILE', 'The XLSX file is not a valid workbook');
    }
  } finally {
    fs.closeSync(handle);
  }
}

/**
 * Use: accepts a CSV or XLSX upload, stores an import job, and enqueues it.
 * Payload: multipart form field file (CSV or XLSX). POST /api/imports.
 * Returns: 202 with the queued import job.
 */
async function createImport(req, res) {
  if (!req.file) {
    throw new AppError(400, 'FILE_REQUIRED', 'Attach a CSV or XLSX file in the file field');
  }
  const extension = path.extname(req.file.originalname).toLowerCase();
  try {
    assertUploadContent(req.file.path, extension);
  } catch (error) {
    await fs.promises.unlink(req.file.path).catch(() => {});
    throw error;
  }

  const job = await ImportJob.create({
    originalFilename: path.basename(req.file.originalname).slice(0, 255),
    storedFilename: req.file.filename,
    status: 'queued',
  });

  try {
    await req.app.locals.importQueue.add(
      'import',
      { importJobId: String(job._id), storedFilename: job.storedFilename },
      { jobId: String(job._id) },
    );
  } catch (error) {
    await ImportJob.updateOne(
      { _id: job._id },
      { $set: { status: 'failed', failureReason: 'Failed to enqueue import' } },
    );
    await fs.promises.unlink(req.file.path).catch(() => {});
    req.app.locals.logger.error(
      { err: error, importJobId: String(job._id) },
      'Import enqueue failed',
    );
    throw new AppError(503, 'QUEUE_UNAVAILABLE', 'The import could not be queued');
  }

  res.status(202).json(presentImportJob(job));
}

/**
 * Use: reads one import job and its counts.
 * Payload: path jobId (24-character ObjectId). GET /api/imports/:jobId.
 * Returns: 200 with the job, or 404.
 */
async function getImport(req, res) {
  const job = await ImportJob.findById(req.params.jobId);
  if (!job) throw new AppError(404, 'NOT_FOUND', 'Import job was not found');
  res.status(200).json(presentImportJob(job));
}

/**
 * Use: exposes the configured maximum upload size.
 * Payload: none.
 * Returns: max bytes from the environment.
 */
function uploadLimit() {
  return getEnv().MAX_UPLOAD_BYTES;
}

module.exports = {
  objectIdSchema,
  presentImportJob,
  createImport,
  getImport,
  uploadLimit,
  assertUploadContent,
};
