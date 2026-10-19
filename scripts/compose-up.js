/**
 * Use: starts the full stack with one command.
 * Payload: none. Creates .env from .env.example only when .env is missing, then runs docker compose up --build.
 * Returns: the Docker Compose exit code.
 */
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const root = path.join(__dirname, '..');
const envPath = path.join(root, '.env');
const examplePath = path.join(root, '.env.example');

if (!fs.existsSync(envPath)) {
  fs.copyFileSync(examplePath, envPath);
  console.log('Created .env from .env.example');
} else {
  console.log('Using existing .env');
}

const child = spawn('docker', ['compose', 'up', '--build'], {
  cwd: root,
  stdio: 'inherit',
});

child.on('error', (error) => {
  if (error.code === 'ENOENT') {
    console.error(
      [
        'Docker was not found on PATH.',
        'Install Docker Desktop, start it, then open a new terminal and run this command again:',
        'https://docs.docker.com/desktop/setup/install/windows-install/',
      ].join('\n'),
    );
  } else {
    console.error(error.message);
  }
  process.exit(1);
});

child.on('exit', (code) => {
  process.exit(code == null ? 1 : code);
});
