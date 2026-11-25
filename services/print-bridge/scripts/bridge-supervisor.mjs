import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptsDir = path.dirname(fileURLToPath(import.meta.url));
const bridgeRoot = path.resolve(scriptsDir, '..');
const logsDir = path.join(bridgeRoot, 'logs');
const logFile = path.join(logsDir, 'bridge.log');
const pidFile = path.join(logsDir, 'bridge.pid');
const MAX_LOG_BYTES = 2 * 1024 * 1024;

fs.mkdirSync(logsDir, { recursive: true });

function isPidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

if (fs.existsSync(pidFile)) {
  const existingPid = Number.parseInt(fs.readFileSync(pidFile, 'utf8').trim(), 10);
  if (existingPid !== process.pid && isPidAlive(existingPid)) {
    process.exit(0);
  }
}

fs.writeFileSync(pidFile, String(process.pid), 'utf8');

function appendLog(chunk) {
  try {
    if (fs.existsSync(logFile) && fs.statSync(logFile).size > MAX_LOG_BYTES) {
      const rotated = path.join(logsDir, 'bridge.prev.log');
      fs.renameSync(logFile, rotated);
    }
    fs.appendFileSync(logFile, chunk);
  } catch {
    // Ignore log rotation write errors
  }
}

let child = null;
let shuttingDown = false;

function launchWorker() {
  if (shuttingDown) return;
  appendLog(`[supervisor ${new Date().toISOString()}] Memulai Ekalliptus Print Bridge...\n`);
  child = spawn(process.execPath, [path.join(bridgeRoot, 'src', 'index.mjs')], {
    cwd: bridgeRoot,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  child.stdout.on('data', (d) => appendLog(d));
  child.stderr.on('data', (d) => appendLog(d));

  child.on('exit', (code, signal) => {
    appendLog(
      `[supervisor ${new Date().toISOString()}] Bridge berhenti (code=${code}, signal=${signal}).\n`,
    );
    child = null;
    if (!shuttingDown) {
      setTimeout(launchWorker, 5_000);
    }
  });
}

function cleanupAndExit() {
  shuttingDown = true;
  try {
    fs.rmSync(pidFile, { force: true });
  } catch {
    // Ignore
  }
  if (child) {
    try {
      child.kill('SIGTERM');
    } catch {
      // Ignore
    }
  }
  setTimeout(() => process.exit(0), 500);
}

process.on('SIGINT', cleanupAndExit);
process.on('SIGTERM', cleanupAndExit);

launchWorker();
