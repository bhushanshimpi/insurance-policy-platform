// Restarts only the named API container through the Docker socket.
// The monitor process stays up, and the rest of the Compose stack is not restarted.
const http = require('http');

/**
 * Use: calls the Docker Engine API over its Unix socket.
 * Payload: { socketPath, method, path, timeoutMs }.
 * Returns: { statusCode, body }.
 */
function dockerRequest({ socketPath, method, path, timeoutMs = 10000 }) {
  return new Promise((resolve, reject) => {
    const request = http.request(
      {
        socketPath,
        path,
        method,
        timeout: timeoutMs,
      },
      (response) => {
        const chunks = [];
        response.on('data', (chunk) => chunks.push(chunk));
        response.on('end', () => {
          resolve({
            statusCode: response.statusCode,
            body: Buffer.concat(chunks).toString('utf8'),
          });
        });
      },
    );
    request.on('timeout', () => {
      request.destroy(new Error('Docker API request timed out'));
    });
    request.on('error', reject);
    request.end();
  });
}

/**
 * Use: restarts one container and no others.
 * Payload: { socketPath, containerName, request? }.
 * Returns: the Docker response. Throws when Docker does not return success.
 */
async function restartApiContainer({ socketPath, containerName, request = dockerRequest } = {}) {
  const encoded = encodeURIComponent(containerName);
  const response = await request({
    socketPath,
    method: 'POST',
    path: `/v1.41/containers/${encoded}/restart`,
  });
  if (response.statusCode < 200 || response.statusCode >= 300) {
    const error = new Error(
      `Docker restart failed with status ${response.statusCode}: ${response.body}`,
    );
    error.statusCode = response.statusCode;
    throw error;
  }
  return response;
}

module.exports = {
  dockerRequest,
  restartApiContainer,
};
