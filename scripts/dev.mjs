// npm run dev: starts the local API (restarts when its files change) and the Vite dev server
// together. Ctrl+C stops both. Extra arguments go to Vite, for example: npm run dev -- --open
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const viteBin = path.join(root, 'node_modules', 'vite', 'bin', 'vite.js');

const children = [
  spawn(process.execPath, ['--watch', '--watch-preserve-output', 'dev-api.mjs'], { cwd: root, stdio: 'inherit' }),
  spawn(process.execPath, [viteBin, ...process.argv.slice(2)], { cwd: root, stdio: 'inherit' }),
];

let stopping = false;

function stopAll(code) {
  if (stopping) return;
  stopping = true;
  for (const child of children) {
    if (child.exitCode !== null || child.signalCode !== null) continue;
    // On Windows, kill the whole tree so the API process started by --watch does not linger.
    if (process.platform === 'win32') spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    else child.kill('SIGTERM');
  }
  process.exitCode = code;
}

for (const child of children) child.on('exit', (code) => stopAll(code ?? 0));
process.on('SIGINT', () => stopAll(0));
process.on('SIGTERM', () => stopAll(0));
