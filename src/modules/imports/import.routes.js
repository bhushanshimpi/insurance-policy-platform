const express = require('express');
const { asyncHandler } = require('../../utils/async-handler');
const { validate } = require('../../middleware/validate');
const { objectIdSchema, createImport, getImport } = require('./import.controller');

/**
 * Use: mounts the import upload and status routes.
 * Payload: upload (Multer instance).
 * Returns: an Express router for /api/imports.
 */
function createImportRouter(upload) {
  const router = express.Router();
  router.post(
    '/',
    (req, res, next) => {
      upload.single('file')(req, res, (error) => {
        if (error) return next(error);
        return next();
      });
    },
    asyncHandler(createImport),
  );
  router.get('/:jobId', validate({ params: objectIdSchema }), asyncHandler(getImport));
  return router;
}

module.exports = { createImportRouter };
