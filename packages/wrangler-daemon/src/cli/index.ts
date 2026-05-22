#!/usr/bin/env node
/**
 * wrangler-daemon CLI — start / stop / status
 */
import { Daemon } from '../daemon.js';
import { PID_PATH, APP_DIR } from '../constants.js';
import { readFile, writeFile, unlink, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
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

async function start(): Promise<void> {
  const port = args.port ? parseInt(args.port, 10) : 3100;
  const host = args.host ?? 'localhost';

  console.log(`[wrangler-daemon] starting on ${host}:${port}...`);

  await mkdir(APP_DIR, { recursive: true });

  const daemon = new Daemon({ port, host });

  // Graceful shutdown on SIGINT/SIGTERM
  const shutdown = async () => {
    console.log('[wrangler-daemon] shutting down...');
    await daemon.shutdown();
    await unlink(PID_PATH).catch(() => {});
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  await daemon.startup();

  // Write PID file
  await writeFile(PID_PATH, String(process.pid), 'utf-8');

  console.log(`[wrangler-daemon] listening at http://${daemon.address}`);
}

async function stop(): Promise<void> {
  if (!existsSync(PID_PATH)) {
    console.error('[wrangler-daemon] not running (no PID file)');
    process.exit(1);
  }
  const pid = parseInt(await readFile(PID_PATH, 'utf-8'), 10);
  try {
    process.kill(pid, 'SIGTERM');
    console.log(`[wrangler-daemon] sent SIGTERM to process ${pid}`);
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
