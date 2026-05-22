#!/usr/bin/env node
/**
 * wrangler-daemon CLI — start / stop / status
 *
 * `start` spawns a detached background process (like pm2).
 * The child process uses `daemon.ts` auto-start logic which
 * writes PID and handles signals.
 */
import { Daemon } from '../daemon.js';
import { PID_PATH, APP_DIR } from '../constants.js';
import { readFile, writeFile, unlink, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import process from 'node:process';

const command = process.argv[2];
const args = parseArgs(process.argv.slice(3));

function parseArgs(argv: string[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--') && argv[i + 1]) {
      result[argv[i].slice(2)] = argv[i + 1];
      i++;
    }
  }
  return result;
}

/**
 * Run daemon in foreground (used by the spawned background process).
 * Writes PID file and handles SIGINT/SIGTERM for graceful shutdown.
 */
async function runForeground(): Promise<void> {
  const port = args.port ? parseInt(args.port, 10) : 3100;
  const host = args.host ?? 'localhost';

  await mkdir(APP_DIR, { recursive: true });

  const daemon = new Daemon({ port, host });

  const shutdown = async () => {
    await daemon.shutdown();
    await unlink(PID_PATH).catch(() => {});
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  await daemon.startup();

  await writeFile(PID_PATH, String(process.pid), 'utf-8');
}

/**
 * Spawn daemon as a detached background process.
 * Inherits stdio so startup errors are visible, then unrefs
 * so the parent can exit immediately.
 */
async function start(): Promise<void> {
  if (existsSync(PID_PATH)) {
    const pid = parseInt(await readFile(PID_PATH, 'utf-8'), 10);
    try {
      process.kill(pid, 0);
      console.error(`[wrangler-daemon] already running (PID ${pid})`);
      process.exit(1);
    } catch {
      await unlink(PID_PATH);
    }
  }

  const port = args.port ? parseInt(args.port, 10) : 3100;
  const host = args.host ?? 'localhost';

  const bin = fileURLToPath(import.meta.url);
  const child = spawn(process.execPath, [bin, '--run', '--port', String(port), '--host', host], {
    detached: true,
    stdio: 'ignore',
  });
  child.unref();

  console.log(`[wrangler-daemon] started (PID ${child.pid})`);
}

async function stop(): Promise<void> {
  if (!existsSync(PID_PATH)) {
    console.error('[wrangler-daemon] not running (no PID file)');
    process.exit(1);
  }
  const pid = parseInt(await readFile(PID_PATH, 'utf-8'), 10);
  try {
    process.kill(pid, 'SIGTERM');
    console.log(`[wrangler-daemon] stopped (PID ${pid})`);
    await unlink(PID_PATH);
  } catch {
    console.error(`[wrangler-daemon] process ${pid} not found, cleaning PID file`);
    await unlink(PID_PATH);
  }
}

async function status(): Promise<void> {
  if (!existsSync(PID_PATH)) {
    console.log('[wrangler-daemon] not running');
    return;
  }
  const pid = parseInt(await readFile(PID_PATH, 'utf-8'), 10);
  try {
    process.kill(pid, 0); // check if alive
    console.log(`[wrangler-daemon] running (PID ${pid})`);
  } catch {
    console.log('[wrangler-daemon] not running (stale PID file)');
  }
}

switch (command) {
  case '--run':
    // Internal: foreground mode used by the detached child process
    await runForeground();
    break;
  case 'start':
    await start();
    break;
  case 'stop':
    await stop();
    break;
  case 'status':
    await status();
    break;
  default:
    console.log('Usage: wrangler-daemon <start|stop|status> [--port PORT] [--host HOST]');
    process.exit(1);
}
