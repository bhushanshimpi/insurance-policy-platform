module.exports = {
  testEnvironment: 'node',
  testTimeout: 120000,
  clearMocks: true,
  testMatch: ['**/tests/**/*.test.js'],
  setupFiles: ['<rootDir>/tests/setup-env.js'],
};
