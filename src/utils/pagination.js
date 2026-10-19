/**
 * Use: keeps a page size inside a safe upper bound.
 * Payload: value (number or string), fallback (number), max (number).
 * Returns: an integer from 1 through max.
 */
function clampLimit(value, fallback, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(Math.trunc(parsed), 1), max);
}

/**
 * Use: normalizes a page query into a positive integer.
 * Payload: value (number or string).
 * Returns: an integer of at least 1.
 */
function pageNumber(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 1) return 1;
  return Math.trunc(parsed);
}

module.exports = {
  clampLimit,
  pageNumber,
};
