const fs = require('fs/promises');
const path = require('path');
const { Worker } = require('bullmq');
const { getEnv } = require('../config/env');
const { IMPORT_QUEUE_NAME } = require('../queues/import.queue');
const { runImport, markImportFailed } = require('../services/import/run-import');

/**
 * Use: consumes policy-import jobs, runs the import, and deletes the temp file when finished.
 * Payload: connection (ioredis client), logger.
 * Job payload: { importJobId, storedFilename }.
 * Returns: a BullMQ Worker.
 */
function createImportWorker(connection, logger) {
  const env = getEnv();
  const worker = new Worker(
    IMPORT_QUEUE_NAME,
    async (job) => {
      const filePath = path.join(env.UPLOAD_DIR, job.data.storedFilename);
      await runImport({
        importJobId: job.data.importJobId,
        filePath,
        batchSize: env.IMPORT_BATCH_SIZE,
      });
      await fs.unlink(filePath).catch((error) => {
        logger.warn(
          { err: error, importJobId: job.data.importJobId },
          'Import file cleanup failed',
        );
      });
    },
    {
      connection,
      concurrency: env.IMPORT_QUEUE_CONCURRENCY,
      lockDuration: 120000,
    },
  );

  worker.on('failed', async (job, error) => {
    logger.error({ err: error, jobId: job && job.id }, 'Import job attempt failed');
    if (!job) return;
    const maxAttempts = job.opts.attempts || env.IMPORT_JOB_ATTEMPTS;
    if (job.attemptsMade < maxAttempts) return;
    await markImportFailed(job.data.importJobId, error.message);
    const filePath = path.join(env.UPLOAD_DIR, job.data.storedFilename);
    await fs.unlink(filePath).catch(() => {});
  });

  return worker;
}

module.exports = { createImportWorker };
