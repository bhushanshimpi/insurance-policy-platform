const openApiSpec = {
  openapi: '3.0.3',
  info: {
    title: 'Insurance Policy Platform API',
    version: '1.0.0',
    description:
      'Import insurance policies from CSV/XLSX, search and aggregate them, and schedule reminder messages.',
  },
  servers: [{ url: '/' }],
  tags: [
    { name: 'Health' },
    { name: 'Imports' },
    { name: 'Policies' },
    { name: 'Scheduled messages' },
  ],
  paths: {
    '/health/live': {
      get: {
        tags: ['Health'],
        summary: 'Liveness probe',
        responses: { 200: { description: 'Process is alive' } },
      },
    },
    '/health/ready': {
      get: {
        tags: ['Health'],
        summary: 'Readiness probe',
        responses: {
          200: { description: 'MongoDB and Redis are reachable' },
          503: { description: 'A dependency is unavailable' },
        },
      },
    },
    '/api/imports': {
      post: {
        tags: ['Imports'],
        summary: 'Upload a CSV or XLSX policy file',
        requestBody: {
          required: true,
          content: {
            'multipart/form-data': {
              schema: {
                type: 'object',
                required: ['file'],
                properties: { file: { type: 'string', format: 'binary' } },
              },
            },
          },
        },
        responses: {
          202: { description: 'Import job queued' },
          400: { description: 'Missing or empty file' },
          413: { description: 'File too large' },
          415: { description: 'Unsupported file type' },
          503: { description: 'Queue unavailable' },
        },
      },
    },
    '/api/imports/{jobId}': {
      get: {
        tags: ['Imports'],
        summary: 'Get import job status and counts',
        parameters: [{ name: 'jobId', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          200: { description: 'Import job' },
          404: { description: 'Not found' },
        },
      },
    },
    '/api/policies/search': {
      get: {
        tags: ['Policies'],
        summary: 'Search policies by first name',
        description:
          'The assessment file has firstname, not a unique username. This endpoint matches firstname exactly, case-insensitively, and returns each matching user separately.',
        parameters: [
          { name: 'username', in: 'query', required: true, schema: { type: 'string' } },
          { name: 'page', in: 'query', schema: { type: 'integer', default: 1 } },
          { name: 'limit', in: 'query', schema: { type: 'integer', default: 20 } },
        ],
        responses: {
          200: { description: 'Matching users and their policies' },
          400: { description: 'Invalid query' },
        },
      },
    },
    '/api/policies/aggregate': {
      get: {
        tags: ['Policies'],
        summary: 'Count policies per user',
        parameters: [
          { name: 'page', in: 'query', schema: { type: 'integer', default: 1 } },
          { name: 'limit', in: 'query', schema: { type: 'integer', default: 20 } },
        ],
        responses: { 200: { description: 'Aggregated policy counts' } },
      },
    },
    '/api/scheduled-messages': {
      post: {
        tags: ['Scheduled messages'],
        summary: 'Schedule a message',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/ScheduledMessageInput' },
              example: {
                message: 'Policy renewal reminder',
                day: '2026-10-20',
                time: '10:30',
                timezone: 'Asia/Kolkata',
              },
            },
          },
        },
        responses: {
          201: { description: 'Message stored and delayed job enqueued' },
          400: { description: 'Invalid or past schedule' },
        },
      },
    },
    '/api/scheduled-messages/{id}': {
      get: {
        tags: ['Scheduled messages'],
        summary: 'Get a scheduled message',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          200: { description: 'Scheduled message' },
          404: { description: 'Not found' },
        },
      },
    },
  },
  components: {
    schemas: {
      ScheduledMessageInput: {
        type: 'object',
        required: ['message', 'day', 'time', 'timezone'],
        properties: {
          message: { type: 'string' },
          day: { type: 'string', example: '2026-10-20' },
          time: { type: 'string', example: '10:30' },
          timezone: { type: 'string', example: 'Asia/Kolkata' },
        },
      },
      Error: {
        type: 'object',
        properties: {
          error: {
            type: 'object',
            properties: {
              code: { type: 'string' },
              message: { type: 'string' },
              details: { type: 'array', items: { type: 'object' } },
            },
          },
        },
      },
    },
  },
};

module.exports = { openApiSpec };
