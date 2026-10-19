// CPU-heavy CSV/XLSX parsing. No database connection lives in this thread.
// The parent must acknowledge each batch before the next one is read, so a large file
// is not held in memory all at once.
const fs = require('fs');
const path = require('path');
const { parse } = require('csv-parse');
const ExcelJS = require('exceljs');
const { workerData, parentPort } = require('worker_threads');
const {
  cellToString,
  isEmptyRecord,
  missingRequiredColumns,
  normalizeRow,
} = require('../services/import/normalize-row');

const MAX_STORED_ERRORS = 100;

/**
 * Use: sends a parser event to the parent process.
 * Payload: message { type: 'batch' | 'done' | 'error', ... }.
 * Returns: nothing.
 */
function post(message) {
  parentPort.postMessage(message);
}

/**
 * Use: waits until the parent has stored the current batch.
 * Payload: none. The parent posts { type: 'ack' } or { type: 'stop' }.
 * Returns: nothing, or rejects when the parent stops the parser.
 */
function waitForAck() {
  return new Promise((resolve, reject) => {
    /**
     * Use: finishes the wait when the parent answers.
     * Payload: message { type: 'ack' | 'stop' }.
     * Returns: nothing. Resolves on ack and rejects on stop.
     */
    const onMessage = (message) => {
      if (!message || !message.type) return;
      parentPort.off('message', onMessage);
      if (message.type === 'ack') resolve();
      else reject(new Error('Parser stopped'));
    };
    parentPort.on('message', onMessage);
  });
}

/**
 * Use: sends one batch and waits for acknowledgement.
 * Payload: batch (array of normalized rows). The array is cleared after it is sent.
 * Returns: nothing.
 */
async function emitBatch(batch) {
  if (batch.length === 0) return;
  post({ type: 'batch', rows: batch.splice(0, batch.length) });
  await waitForAck();
}

/**
 * Use: reads the column names from the first CSV record.
 * Payload: record (object).
 * Returns: the header strings.
 */
function headerList(record) {
  return Object.keys(record || {});
}

/**
 * Use: streams a CSV file and emits normalized batches.
 * Payload: filePath (string), batchSize (number).
 * Returns: { total, invalid, errors, errorsTruncated }.
 */
async function parseCsv(filePath, batchSize) {
  const parser = fs.createReadStream(filePath).pipe(
    parse({
      columns: true,
      bom: true,
      skip_empty_lines: true,
      trim: true,
      relax_column_count: true,
    }),
  );

  let headersChecked = false;
  let rowNumber = 1;
  const batch = [];
  const summary = { total: 0, invalid: 0, errors: [], errorsTruncated: false };

  for await (const record of parser) {
    rowNumber += 1;
    if (!headersChecked) {
      const missing = missingRequiredColumns(headerList(record));
      if (missing.length > 0) {
        throw new Error(`Missing required columns: ${missing.join(', ')}`);
      }
      headersChecked = true;
    }
    if (isEmptyRecord(record)) continue;
    summary.total += 1;
    const normalized = normalizeRow(record, rowNumber);
    if (!normalized.valid) {
      summary.invalid += 1;
      for (const error of normalized.errors) {
        if (summary.errors.length < MAX_STORED_ERRORS) summary.errors.push(error);
        else summary.errorsTruncated = true;
      }
      continue;
    }
    batch.push(normalized.row);
    if (batch.length >= batchSize) await emitBatch(batch);
  }

  if (!headersChecked) throw new Error('The file does not contain any data rows');
  await emitBatch(batch);
  return summary;
}

/**
 * Use: streams the first worksheet of an XLSX file and emits normalized batches.
 * Payload: filePath (string), batchSize (number).
 * Returns: { total, invalid, errors, errorsTruncated }.
 */
async function parseXlsx(filePath, batchSize) {
  const reader = new ExcelJS.stream.xlsx.WorkbookReader(filePath, {
    entries: 'emit',
    sharedStrings: 'cache',
    worksheets: 'emit',
    styles: 'ignore',
    hyperlinks: 'ignore',
  });

  let headers;
  const batch = [];
  const summary = { total: 0, invalid: 0, errors: [], errorsTruncated: false };
  let sheetCount = 0;

  for await (const worksheet of reader) {
    sheetCount += 1;
    if (sheetCount > 1) break;
    for await (const excelRow of worksheet) {
      const values = excelRow.values || [];
      const cells = values
        .slice(1)
        .map((value) => (value instanceof Date ? value : cellToString(value).trim()));
      if (!headers) {
        headers = cells;
        const missing = missingRequiredColumns(headers);
        if (missing.length > 0) {
          throw new Error(`Missing required columns: ${missing.join(', ')}`);
        }
        continue;
      }
      const record = {};
      headers.forEach((header, index) => {
        if (header) record[header] = cells[index] == null ? '' : cells[index];
      });
      if (isEmptyRecord(record)) continue;
      summary.total += 1;
      const normalized = normalizeRow(record, excelRow.number);
      if (!normalized.valid) {
        summary.invalid += 1;
        for (const error of normalized.errors) {
          if (summary.errors.length < MAX_STORED_ERRORS) summary.errors.push(error);
          else summary.errorsTruncated = true;
        }
        continue;
      }
      batch.push(normalized.row);
      if (batch.length >= batchSize) await emitBatch(batch);
    }
  }

  if (!headers) throw new Error('The workbook does not contain a worksheet');
  await emitBatch(batch);
  return summary;
}

/**
 * Use: chooses the CSV or XLSX parser from the file extension.
 * Payload: workerData { filePath, batchSize }.
 * Returns: the parser summary, which is then posted as { type: 'done' }.
 */
async function main() {
  const filePath = workerData.filePath;
  const batchSize = workerData.batchSize || 500;
  const extension = path.extname(filePath).toLowerCase();
  if (!fs.existsSync(filePath)) {
    throw new Error('Import file was not found');
  }
  if (extension === '.csv') return parseCsv(filePath, batchSize);
  if (extension === '.xlsx') return parseXlsx(filePath, batchSize);
  throw new Error('Only CSV and XLSX files are allowed');
}

main()
  .then((summary) => {
    post({ type: 'done', summary });
  })
  .catch((error) => {
    post({ type: 'error', message: error.message || 'File parsing failed' });
    setImmediate(() => {
      process.exit(1);
    });
  });
