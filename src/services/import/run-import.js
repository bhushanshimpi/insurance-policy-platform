// BullMQ calls this after the upload is queued.
// Parsing runs in a worker thread. This process writes each acknowledged batch with bulkWrite
// and marks the job completed only after every batch has been stored.
const path = require('path');
const { Worker } = require('worker_threads');
const ImportJob = require('../../models/import-job.model');
const { writeImportBatch } = require('./import-batch');

const MAX_STORED_ERRORS = 100;

/**
 * Use: runs the parser thread and writes each batch before asking for the next.
 * Payload: filePath (string), batchSize (number), onBatch (async function(rows)).
 * Returns: { total, invalid, errors, errorsTruncated }.
 */
function streamParsedFile(filePath, batchSize, onBatch) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(path.join(__dirname, '../../workers/file-parser.thread.js'), {
      workerData: { filePath, batchSize },
    });
    let settled = false;

    /**
     * Use: stops the parser thread and rejects the import.
     * Payload: error (Error).
     * Returns: nothing. The surrounding promise rejects once.
     */
    const fail = (error) => {
      if (settled) return;
      settled = true;
      worker.terminate().finally(() => reject(error));
    };

    worker.on('message', (message) => {
      if (!message || settled) return;
      if (message.type === 'batch') {
        Promise.resolve()
          .then(() => onBatch(message.rows))
          .then(() => worker.postMessage({ type: 'ack' }))
          .catch(fail);
        return;
      }
      if (message.type === 'error') {
        fail(new Error(message.message));
        return;
      }
      if (message.type === 'done') {
        settled = true;
        worker.terminate().finally(() => resolve(message.summary));
      }
    });

    worker.on('error', fail);
    worker.on('exit', (code) => {
      if (!settled && code !== 0) {
        fail(new Error(`Parser thread exited with code ${code}`));
      }
    });
  });
}

/**
 * Use: processes one import file and updates the job only after the writes succeed.
 * Payload: { importJobId, filePath, batchSize }.
 * Returns: { imported, skipped, invalid, total }.
 */
async function runImport({ importJobId, filePath, batchSize }) {
  const job = await ImportJob.findById(importJobId);
  if (!job) throw new Error('Import job was not found');

  const seenPolicies = new Set();
  const rowErrors = [];
  let errorsTruncated = false;
  let skipped = 0;
  let imported = 0;

  await ImportJob.updateOne(
    { _id: job._id },
    {
      $set: {
        status: 'processing',
        total: 0,
        imported: 0,
        skipped: 0,
        invalid: 0,
        rowErrors: [],
        errorsTruncated: false,
        failureReason: null,
        startedAt: new Date(),
        finishedAt: null,
      },
      $inc: { attempts: 1 },
    },
  );

  const summary = await streamParsedFile(filePath, batchSize, async (rows) => {
    const accepted = [];
    for (const row of rows) {
      if (seenPolicies.has(row.policyNumber)) {
        skipped += 1;
        if (rowErrors.length < MAX_STORED_ERRORS) {
          rowErrors.push({
            row: row.rowNumber,
            field: 'policy_number',
            code: 'DUPLICATE_POLICY_IN_FILE',
          });
        } else {
          errorsTruncated = true;
        }
        continue;
      }
      seenPolicies.add(row.policyNumber);
      accepted.push(row);
    }
    if (accepted.length > 0) {
      await writeImportBatch(accepted);
      imported += accepted.length;
    }
  });

  for (const error of summary.errors) {
    if (rowErrors.length < MAX_STORED_ERRORS) rowErrors.push(error);
    else errorsTruncated = true;
  }

  await ImportJob.updateOne(
    { _id: job._id },
    {
      $set: {
        status: 'completed',
        total: summary.total,
        imported,
        skipped,
        invalid: summary.invalid,
        rowErrors,
        errorsTruncated: errorsTruncated || summary.errorsTruncated,
        finishedAt: new Date(),
      },
    },
  );

  return { imported, skipped, invalid: summary.invalid, total: summary.total };
}

/**
 * Use: marks an import failed after BullMQ has used its last attempt.
 * Payload: importJobId (ObjectId), reason (string).
 * Returns: nothing. A completed job is left unchanged.
 */
async function markImportFailed(importJobId, reason) {
  await ImportJob.updateOne(
    { _id: importJobId, status: { $ne: 'completed' } },
    {
      $set: {
        status: 'failed',
        failureReason: String(reason || 'Import failed').slice(0, 500),
        finishedAt: new Date(),
      },
    },
  );
}

module.exports = {
  streamParsedFile,
  runImport,
  markImportFailed,
};
