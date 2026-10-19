/**
 * Use: lets an async route throw or reject and still reach the error handler.
 * Payload: handler (function(req, res, next)).
 * Returns: Express middleware.
 */
function asyncHandler(handler) {
  return function wrapped(req, res, next) {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}

module.exports = { asyncHandler };
