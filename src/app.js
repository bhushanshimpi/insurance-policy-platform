const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const helmet = require('helmet');
const multer = require('multer');
const pinoHttp = require('pino-http');
const swaggerUi = require('swagger-ui-express');
const { getEnv } = require('./config/env');
const { createLogger } = require('./config/logger');
const { errorHandler, notFoundHandler } = require('./middleware/error-handler');
const healthRoutes = require('./modules/health/health.routes');
const { createImportRouter } = require('./modules/imports/import.routes');
const policyRoutes = require('./modules/policies/policy.routes');
const scheduledMessageRoutes = require('./modules/scheduled-messages/scheduled-message.routes');
const { openApiSpec } = require('./docs/openapi');

/**
 * Use: builds the Multer uploader for CSV and XLSX files.
 * Payload: env { UPLOAD_DIR, MAX_UPLOAD_BYTES }.
 * Returns: a Multer instance that stores one file on disk.
 */
function createUpload(env) {
  fs.mkdirSync(env.UPLOAD_DIR, { recursive: true });
  return multer({
    storage: multer.diskStorage({
      destination: (_req, _file, callback) => callback(null, env.UPLOAD_DIR),
      filename: (_req, file, callback) => {
        const extension = path.extname(file.originalname).toLowerCase();
        const name = `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${extension}`;
        callback(null, name);
      },
    }),
    limits: { fileSize: env.MAX_UPLOAD_BYTES, files: 1 },
    fileFilter: (_req, file, callback) => {
      const extension = path.extname(file.originalname).toLowerCase();
      if (!['.csv', '.xlsx'].includes(extension)) {
        callback(new Error('Only CSV and XLSX files are allowed'));
        return;
      }
      callback(null, true);
    },
  });
}

/**
 * Use: builds the Express application without listening.
 * Payload: deps { env?, logger?, redis?, importQueue?, scheduledQueue?, upload? }.
 * Returns: the Express app. Routes are /health, /api/imports, /api/policies, /api/scheduled-messages, and /api/docs.
 */
function createApp(deps = {}) {
  const env = deps.env || getEnv();
  const logger = deps.logger || createLogger({ service: 'api' });
  const app = express();
  app.disable('x-powered-by');
  app.locals.logger = logger;
  app.locals.redis = deps.redis;
  app.locals.importQueue = deps.importQueue;
  app.locals.scheduledQueue = deps.scheduledQueue;

  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          scriptSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", 'data:'],
        },
      },
    }),
  );
  app.use(express.json({ limit: env.BODY_LIMIT }));
  app.use(
    pinoHttp({
      logger,
      autoLogging: env.NODE_ENV !== 'test',
    }),
  );

  app.get('/', (_req, res) => {
    res.status(200).json({
      name: 'insurance-policy-platform',
      docs: '/api/docs',
      health: '/health/live',
    });
  });
  app.use('/health', healthRoutes);
  app.use('/api/imports', createImportRouter(deps.upload || createUpload(env)));
  app.use('/api/policies', policyRoutes);
  app.use('/api/scheduled-messages', scheduledMessageRoutes);
  app.get('/api/docs/openapi.json', (_req, res) => {
    res.status(200).json(openApiSpec);
  });
  app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(openApiSpec));

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}

module.exports = { createApp, createUpload };
