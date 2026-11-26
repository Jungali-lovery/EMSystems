import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const isWindows = process.platform === 'win32';
const children = [];

function start(command, args, options = {}) {
  const child = spawn(command, args, {
    cwd: root,
    env: process.env,
    stdio: 'inherit',
    shell: isWindows && command.toLowerCase().endsWith('.cmd'),
    ...options,
  });
  children.push(child);
  child.on('exit', (code) => {
    if (code && code !== 0) stop(code);
  });
  return child;
}

function stop(code = 0) {
  for (const child of children) {
    if (child.exitCode === null && !child.killed) child.kill('SIGTERM');
  }
  if (code !== null) process.exitCode = code;
}

async function paymentServiceAlreadyRunning() {
  try {
    const response = await fetch('http://127.0.0.1:5175/api/payments/health', { signal: AbortSignal.timeout(900) });
    if (!response.ok) return false;
    const result = await response.json();
    return result.service === 'payment-sandbox' && result.mode === 'sandbox-only';
  } catch {
    return false;
  }
}

async function appApiAlreadyRunning() {
  try {
    const response = await fetch('http://127.0.0.1:5176/api/app/healthz', { signal: AbortSignal.timeout(900) });
    if (!response.ok) return false;
    const result = await response.json();
    return result.service === 'emsystems-app-api' && result.storage === 'sqlite';
  } catch {
    return false;
  }
}

if (!(await paymentServiceAlreadyRunning())) start(process.execPath, [join(root, 'payment-sandbox-server.mjs')]);
if (!(await appApiAlreadyRunning())) start(process.execPath, [join(root, 'server', 'app-api-server.mjs')]);
start(isWindows ? 'npm.cmd' : 'npm', ['run', 'dev:web']);
process.on('SIGINT', () => stop(0));
process.on('SIGTERM', () => stop(0));