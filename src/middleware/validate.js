const { ZodError } = require('zod');

/**
 * Use: validates and replaces req.body, req.query, and req.params before the route runs.
 * Payload: schemas { body?: ZodSchema, query?: ZodSchema, params?: ZodSchema }.
 * Returns: Express middleware. On failure it forwards a ZodError.
 */
function validate(schemas) {
  return function validateRequest(req, _res, next) {
    try {
      if (schemas.body) req.body = schemas.body.parse(req.body);
      if (schemas.query) req.query = schemas.query.parse(req.query);
      if (schemas.params) req.params = schemas.params.parse(req.params);
      return next();
    } catch (error) {
      return next(error instanceof ZodError ? error : error);
    }
  };
}

module.exports = { validate };
