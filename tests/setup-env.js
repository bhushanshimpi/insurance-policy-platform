const os = require('os');
const path = require('path');

process.env.NODE_ENV = 'test';
process.env.MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/insurance-test';
process.env.REDIS_URL = process.env.REDIS_URL || 'redis://127.0.0.1:6379';
process.env.LOG_LEVEL = 'silent';
process.env.UPLOAD_DIR = path.join(os.tmpdir(), 'insurance-policy-test-uploads');
process.env.CPU_RESTART_ENABLED = 'false';
process.env.IMPORT_BATCH_SIZE = '2';
