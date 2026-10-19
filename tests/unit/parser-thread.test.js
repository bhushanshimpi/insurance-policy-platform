const fs = require('fs');
const os = require('os');
const path = require('path');
const ExcelJS = require('exceljs');
const { streamParsedFile } = require('../../src/services/import/run-import');

const headers = [
  'agent',
  'firstname',
  'dob',
  'address',
  'phone',
  'state',
  'zip',
  'email',
  'gender',
  'userType',
  'account_name',
  'category_name',
  'company_name',
  'policy_number',
  'policy_start_date',
  'policy_end_date',
  'premium_amount',
];

function row(policyNumber, email) {
  return [
    'Ava Agent',
    'John',
    '1990-01-02',
    '1 Main',
    '555-0100',
    'CA',
    '94105',
    email,
    'M',
    'client',
    'Primary',
    'Auto',
    'Acme',
    policyNumber,
    '2024-01-01',
    '2025-01-01',
    '10',
  ];
}

describe('worker thread parser', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'parser-'));

  test('streams CSV rows in batches and rejects a missing file', async () => {
    const filePath = path.join(directory, 'policies.csv');
    const lines = [
      headers.join(','),
      row('POL-1', 'a@example.com').join(','),
      row('POL-2', 'b@example.com').join(','),
      row('POL-3', 'c@example.com').join(','),
    ];
    fs.writeFileSync(filePath, lines.join('\n'));

    const batches = [];
    const summary = await streamParsedFile(filePath, 2, async (rows) => {
      batches.push(rows.length);
    });
    expect(batches).toEqual([2, 1]);
    expect(summary.total).toBe(3);
    expect(summary.invalid).toBe(0);

    await expect(
      streamParsedFile(path.join(directory, 'missing.csv'), 2, async () => {}),
    ).rejects.toThrow(/not found/);
  });

  test('parses an XLSX worksheet and fails closed on a parser error', async () => {
    const filePath = path.join(directory, 'policies.xlsx');
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Policies');
    sheet.addRow(headers);
    sheet.addRow(row('POL-9', 'x@example.com'));
    sheet.addRow(row('', 'y@example.com'));
    await workbook.xlsx.writeFile(filePath);

    const rows = [];
    const summary = await streamParsedFile(filePath, 10, async (batch) => {
      rows.push(...batch);
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].policyNumber).toBe('POL-9');
    expect(summary.invalid).toBe(1);

    const broken = path.join(directory, 'broken.csv');
    fs.writeFileSync(broken, 'firstname,email\nJane,jane@example.com\n');
    await expect(streamParsedFile(broken, 10, async () => {})).rejects.toThrow(
      /Missing required columns/,
    );
  });
});
