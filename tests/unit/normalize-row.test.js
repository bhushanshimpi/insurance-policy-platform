const {
  normalizeRow,
  missingRequiredColumns,
  identityKeyFor,
} = require('../../src/services/import/normalize-row');

const validRecord = {
  agent: 'Ava Agent',
  firstname: 'John',
  dob: '1990-01-02',
  address: '1 Main',
  phone: '555-0100',
  state: 'CA',
  zip: '94105',
  email: 'JOHN@example.com',
  gender: 'M',
  userType: 'client',
  account_name: 'Primary',
  category_name: 'Auto',
  company_name: 'Acme',
  policy_number: 'POL-1',
  policy_start_date: '2024-01-01',
  policy_end_date: '2025-01-01',
  city: 'Austin',
  producer: 'Pat',
  policy_type: 'personal',
  premium_amount: '$1,200.50',
};

describe('CSV and XLSX row mapping', () => {
  test('normalizes headers, email, premium, and dates', () => {
    const result = normalizeRow(validRecord, 2);
    expect(result.valid).toBe(true);
    expect(result.row.email).toBe('john@example.com');
    expect(result.row.identityKey).toBe('email:john@example.com');
    expect(result.row.premiumAmount).toBe(1200.5);
    expect(result.row.policyStartDate.toISOString()).toBe('2024-01-01T00:00:00.000Z');
    expect(result.row.city).toBe('Austin');
    expect(result.row.producer).toBe('Pat');
  });

  test('does not treat the same first name as the same person', () => {
    const first = normalizeRow({ ...validRecord, email: 'a@example.com' }, 2);
    const second = normalizeRow(
      { ...validRecord, email: '', phone: '555-2222', policy_number: 'POL-2' },
      3,
    );
    expect(first.row.identityKey).not.toBe(second.row.identityKey);
    expect(first.row.normalizedFirstName).toBe(second.row.normalizedFirstName);
  });

  test('builds a stable hash identity when email is absent', () => {
    const row = normalizeRow({ ...validRecord, email: '' }, 2).row;
    expect(identityKeyFor(row)).toMatch(/^hash:/);
    expect(identityKeyFor(row)).toBe(identityKeyFor({ ...row }));
  });

  test('rejects rows that cannot be identified or have bad policy dates', () => {
    const missingIdentity = normalizeRow(
      { ...validRecord, email: '', dob: '', phone: '', zip: '' },
      4,
    );
    expect(missingIdentity.valid).toBe(false);
    expect(missingIdentity.errors.map((error) => error.code)).toContain('MISSING_IDENTITY');

    const badDates = normalizeRow(
      { ...validRecord, policy_start_date: '2025-02-01', policy_end_date: '2024-01-01' },
      5,
    );
    expect(badDates.errors.map((error) => error.code)).toContain('POLICY_END_BEFORE_START');
  });

  test('reports missing required columns without using row values', () => {
    expect(missingRequiredColumns(['firstname', 'agent'])).toEqual([
      'categoryName',
      'companyName',
      'policyNumber',
    ]);
  });

  test('does not put raw customer values on validation errors', () => {
    const result = normalizeRow({ ...validRecord, policy_number: '' }, 8);
    expect(JSON.stringify(result.errors)).not.toContain('JOHN@example.com');
    expect(result.errors[0]).toEqual({
      row: 8,
      field: 'policy_number',
      code: 'MISSING_POLICY_NUMBER',
    });
  });
});
