const fs = require('fs');
const path = require('path');
const { getEnv } = require('../src/config/env');
const { createLogger } = require('../src/config/logger');
const { connectDb, disconnectDb } = require('../src/config/db');
const ImportJob = require('../src/models/import-job.model');
const { runImport, markImportFailed } = require('../src/services/import/run-import');

/**
 * Use: reads one command-line flag.
 * Payload: name (string), for example '--file'.
 * Returns: the following argument, or null.
 */
function readArg(name) {
  const index = process.argv.indexOf(name);
  if (index === -1 || !process.argv[index + 1]) return null;
  return process.argv[index + 1];
}

/**
 * Use: imports a local CSV or XLSX through the same parser and upserts, without BullMQ.
 * Payload: process argv --file <path>. Requires MONGODB_URI.
 * Returns: prints { id, imported, skipped, invalid, total }.
 */
async function main() {
  const fileArg = readArg('--file');
  if (!fileArg) {
    console.error('Usage: npm run import -- --file <path-to-csv-or-xlsx>');
    process.exit(1);
  }
  const filePath = path.resolve(fileArg);
  const extension = path.extname(filePath).toLowerCase();
  if (!['.csv', '.xlsx'].includes(extension)) {
    throw new Error('Only CSV and XLSX files are allowed');
  }
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    throw new Error('Import file was not found');
  }

  const env = getEnv();
  const logger = createLogger({ service: 'import-cli' });
  await connectDb(env.MONGODB_URI, logger);
  const storedFilename = path.basename(filePath);
  const job = await ImportJob.create({
    originalFilename: storedFilename,
    storedFilename,
    status: 'queued',
  });

  try {
    const result = await runImport({
      importJobId: job._id,
      filePath,
      batchSize: env.IMPORT_BATCH_SIZE,
    });
    console.log(JSON.stringify({ id: String(job._id), ...result }));
  } catch (error) {
    await markImportFailed(job._id, error.message);
    throw error;
  } finally {
    await disconnectDb();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
