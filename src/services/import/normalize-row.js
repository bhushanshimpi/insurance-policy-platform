// Maps a CSV/XLSX row onto the six business collections.
// First name is not a unique key. Email is the user identity when it is present;
// otherwise the identity is a hash of first name, date of birth, phone, and zip.
const { DateTime } = require('luxon');
const { createHash } = require('crypto');

const COLUMN_ALIASES = {
  agent: 'agent',
  firstname: 'firstName',
  first_name: 'firstName',
  dob: 'dob',
  address: 'address',
  phone: 'phone',
  state: 'state',
  zip: 'zip',
  email: 'email',
  gender: 'gender',
  usertype: 'userType',
  user_type: 'userType',
  account_name: 'accountName',
  accountname: 'accountName',
  category_name: 'categoryName',
  categoryname: 'categoryName',
  company_name: 'companyName',
  companyname: 'companyName',
  policy_number: 'policyNumber',
  policynumber: 'policyNumber',
  policy_start_date: 'policyStartDate',
  policystartdate: 'policyStartDate',
  policy_end_date: 'policyEndDate',
  policyenddate: 'policyEndDate',
  city: 'city',
  producer: 'producer',
  policy_type: 'policyType',
  policytype: 'policyType',
  premium_amount: 'premiumAmount',
  premiumamount: 'premiumAmount',
};

const REQUIRED_COLUMNS = ['firstName', 'categoryName', 'companyName', 'policyNumber'];

/**
 * Use: makes a spreadsheet header comparable.
 * Payload: header (string).
 * Returns: trimmed lowercase text with spaces and hyphens turned into underscores.
 */
function canonicalHeader(header) {
  return String(header || '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
}

/**
 * Use: reads a CSV or Excel cell as text, including dates and rich text.
 * Payload: value (any cell value).
 * Returns: a string. Empty when the cell is blank.
 */
function cellToString(value) {
  if (value == null) return '';
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'number') return String(value);
  if (typeof value === 'object') {
    if (Array.isArray(value.richText)) {
      return value.richText.map((part) => part.text || '').join('');
    }
    if (Object.prototype.hasOwnProperty.call(value, 'result')) return cellToString(value.result);
    if (value.text) return String(value.text);
  }
  return String(value);
}

/**
 * Use: trims a cell and collapses repeated spaces.
 * Payload: value (any cell value).
 * Returns: a single-spaced string.
 */
function collapseSpaces(value) {
  return cellToString(value).trim().replace(/\s+/g, ' ');
}

/**
 * Use: parses an ISO date, a US date, or an Excel serial number.
 * Payload: value (string, number, or Date).
 * Returns: { ok: boolean, value: Date or null }.
 */
function parseDate(value) {
  if (value == null || value === '') return { ok: true, value: null };
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? { ok: false, value: null } : { ok: true, value };
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    const excelEpoch = Date.UTC(1899, 11, 30);
    const parsed = new Date(excelEpoch + Math.round(value * 86400000));
    return Number.isNaN(parsed.getTime())
      ? { ok: false, value: null }
      : { ok: true, value: parsed };
  }
  const text = cellToString(value).trim();
  if (!text) return { ok: true, value: null };
  const formats = ['yyyy-MM-dd', 'M/d/yyyy', 'MM/dd/yyyy', 'd/M/yyyy', 'yyyy/MM/dd'];
  for (const format of formats) {
    const parsed = DateTime.fromFormat(text, format, { zone: 'utc' });
    if (parsed.isValid) return { ok: true, value: parsed.toJSDate() };
  }
  const iso = DateTime.fromISO(text, { zone: 'utc' });
  if (iso.isValid) return { ok: true, value: iso.toJSDate() };
  return { ok: false, value: null };
}

/**
 * Use: parses a premium, allowing dollar signs and commas.
 * Payload: value (string or number).
 * Returns: { ok: boolean, value: number or null }.
 */
function parsePremium(value) {
  if (value == null || value === '') return { ok: true, value: null };
  if (typeof value === 'number') {
    return Number.isFinite(value) ? { ok: true, value } : { ok: false, value: null };
  }
  const text = cellToString(value).trim().replace(/[$,]/g, '');
  if (!text) return { ok: true, value: null };
  const parsed = Number(text);
  return Number.isFinite(parsed) ? { ok: true, value: parsed } : { ok: false, value: null };
}

/**
 * Use: renames known spreadsheet columns to internal field names.
 * Payload: record (object keyed by the file's header row).
 * Returns: an object keyed by fields such as firstName and policyNumber.
 */
function mapRecord(record) {
  const mapped = {};
  for (const [key, value] of Object.entries(record || {})) {
    const field = COLUMN_ALIASES[canonicalHeader(key)];
    if (field && mapped[field] == null) mapped[field] = value;
  }
  return mapped;
}

/**
 * Use: checks that a file contains the columns required to create policies.
 * Payload: headers (string array).
 * Returns: the missing internal field names.
 */
function missingRequiredColumns(headers) {
  const present = new Set(
    headers.map((header) => COLUMN_ALIASES[canonicalHeader(header)]).filter(Boolean),
  );
  return REQUIRED_COLUMNS.filter((field) => !present.has(field));
}

/**
 * Use: builds the unique person key for an upsert.
 * Payload: row { email, firstName, dob, phone, zip }.
 * Returns: 'email:...' , 'hash:...', or null when the person cannot be identified.
 */
function identityKeyFor(row) {
  if (row.email) return `email:${row.email}`;
  if (!row.dob && !row.phone && !row.zip) return null;
  const dob = row.dob ? row.dob.toISOString().slice(0, 10) : '';
  const material = [row.firstName, dob, row.phone || '', row.zip || ''].join('|').toLowerCase();
  return `hash:${createHash('sha256').update(material).digest('hex')}`;
}

/**
 * Use: validates one spreadsheet row and prepares it for upsert.
 * Payload: record (object of raw cells), rowNumber (number).
 * Returns: { row, errors: [{ row, field, code }], valid }. Errors do not include cell values.
 */
function normalizeRow(record, rowNumber) {
  const mapped = mapRecord(record);
  const errors = [];
  const firstName = collapseSpaces(mapped.firstName);
  const email = collapseSpaces(mapped.email).toLowerCase();
  const phone = collapseSpaces(mapped.phone);
  const zip = collapseSpaces(mapped.zip);
  const dob = parseDate(mapped.dob);
  const policyStart = parseDate(mapped.policyStartDate);
  const policyEnd = parseDate(mapped.policyEndDate);
  const premium = parsePremium(mapped.premiumAmount);

  if (!firstName) errors.push({ row: rowNumber, field: 'firstname', code: 'MISSING_FIRSTNAME' });
  if (firstName.length > 200)
    errors.push({ row: rowNumber, field: 'firstname', code: 'VALUE_TOO_LONG' });
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    errors.push({ row: rowNumber, field: 'email', code: 'INVALID_EMAIL' });
  }
  if (mapped.dob != null && collapseSpaces(mapped.dob) && !dob.ok) {
    errors.push({ row: rowNumber, field: 'dob', code: 'INVALID_DOB' });
  }
  if (!policyStart.ok || !policyStart.value) {
    errors.push({ row: rowNumber, field: 'policy_start_date', code: 'INVALID_POLICY_START' });
  }
  if (!policyEnd.ok || !policyEnd.value) {
    errors.push({ row: rowNumber, field: 'policy_end_date', code: 'INVALID_POLICY_END' });
  }
  if (policyStart.value && policyEnd.value && policyEnd.value < policyStart.value) {
    errors.push({ row: rowNumber, field: 'policy_end_date', code: 'POLICY_END_BEFORE_START' });
  }
  if (!premium.ok)
    errors.push({ row: rowNumber, field: 'premium_amount', code: 'INVALID_PREMIUM' });

  const policyNumber = collapseSpaces(mapped.policyNumber);
  const categoryName = collapseSpaces(mapped.categoryName);
  const companyName = collapseSpaces(mapped.companyName);
  const accountName = collapseSpaces(mapped.accountName);
  const agent = collapseSpaces(mapped.agent);

  if (!policyNumber)
    errors.push({ row: rowNumber, field: 'policy_number', code: 'MISSING_POLICY_NUMBER' });
  if (!categoryName)
    errors.push({ row: rowNumber, field: 'category_name', code: 'MISSING_CATEGORY' });
  if (!companyName) errors.push({ row: rowNumber, field: 'company_name', code: 'MISSING_COMPANY' });

  const row = {
    rowNumber,
    agent,
    firstName,
    normalizedFirstName: firstName.toLowerCase(),
    dob: dob.ok ? dob.value : null,
    address: collapseSpaces(mapped.address).slice(0, 500),
    phone,
    state: collapseSpaces(mapped.state),
    zip,
    email,
    gender: collapseSpaces(mapped.gender),
    userType: collapseSpaces(mapped.userType),
    accountName,
    categoryName,
    companyName,
    policyNumber,
    policyStartDate: policyStart.value,
    policyEndDate: policyEnd.value,
    city: collapseSpaces(mapped.city),
    producer: collapseSpaces(mapped.producer),
    policyType: collapseSpaces(mapped.policyType),
    premiumAmount: premium.ok ? premium.value : null,
  };
  row.identityKey = identityKeyFor(row);
  if (!row.identityKey) {
    errors.push({ row: rowNumber, field: 'email', code: 'MISSING_IDENTITY' });
  }

  return {
    row,
    errors,
    valid: errors.length === 0,
  };
}

/**
 * Use: detects a spreadsheet row that has no values.
 * Payload: record (object of raw cells).
 * Returns: true when every cell is blank.
 */
function isEmptyRecord(record) {
  return Object.values(record || {}).every((value) => collapseSpaces(value) === '');
}

module.exports = {
  COLUMN_ALIASES,
  REQUIRED_COLUMNS,
  canonicalHeader,
  cellToString,
  mapRecord,
  missingRequiredColumns,
  identityKeyFor,
  normalizeRow,
  isEmptyRecord,
  parseDate,
};
