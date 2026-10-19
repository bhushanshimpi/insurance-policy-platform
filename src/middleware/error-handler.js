const { ZodError } = require('zod');
const { AppError, zodDetails } = require('../utils/errors');

/**
 * Use: answers unknown routes with the shared JSON error shape.
 * Payload: req (Express request), res (Express response).
 * Returns: 404 { error: { code: 'NOT_FOUND', message } }.
 */
function notFoundHandler(req, res) {
  res.status(404).json({
    error: {
      code: 'NOT_FOUND',
      message: `Route ${req.method} ${req.originalUrl} was not found`,
    },
  });
}

/**
 * Use: maps thrown errors to HTTP status codes without leaking internals.
 * Payload: err (Error, ZodError, or AppError), req, res, next.
 * Returns: JSON { error: { code, message, details } }.
 */
function errorHandler(err, req, res, _next) {
  if (err instanceof ZodError) {
    return res.status(400).json({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Request validation failed',
        details: zodDetails(err),
      },
    });
  }

  if (err instanceof AppError) {
    return res.status(err.status).json({
      error: {
        code: err.code,
        message: err.message,
        details: err.details,
      },
    });
  }

  if (err && err.name === 'CastError') {
    return res.status(400).json({
      error: {
        code: 'INVALID_ID',
        message: 'The supplied identifier is not valid',
      },
    });
  }

  if (err && err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({
      error: {
        code: 'FILE_TOO_LARGE',
        message: 'The uploaded file exceeds the configured size limit',
      },
    });
  }

  if (err && err.code === 'LIMIT_UNEXPECTED_FILE') {
    return res.status(400).json({
      error: {
        code: 'UNEXPECTED_FILE',
        message: 'Upload the file in the "file" field',
      },
    });
  }

  if (err && err.message === 'Only CSV and XLSX files are allowed') {
    return res.status(415).json({
      error: {
        code: 'UNSUPPORTED_MEDIA_TYPE',
        message: err.message,
      },
    });
  }

  const logger = req.app.locals.logger;
  if (logger) {
    logger.error({ err }, 'Unhandled request error');
  }

  return res.status(500).json({
    error: {
      code: 'INTERNAL_ERROR',
      message: 'An unexpected error occurred',
    },
  });
}

module.exports = {
  notFoundHandler,
  errorHandler,
};
