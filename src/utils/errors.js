/**
 * Use: carries an HTTP status and a stable error code to the central error handler.
 * Payload: status (number), code (string), message (string), details (array or object, optional).
 * Returns: an Error instance with status, code, and details.
 */
class AppError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

/**
 * Use: turns a Zod validation failure into a client-safe field list.
 * Payload: error (ZodError).
 * Returns: [{ path, message }].
 */
function zodDetails(error) {
  return error.issues.map((issue) => ({
    path: issue.path.join('.') || 'value',
    message: issue.message,
  }));
}

module.exports = {
  AppError,
  zodDetails,
};
