#!/usr/bin/env node
// packages/wrangler-devtool/src/cli/main.ts
// CLI 入口

import { config as loadEnv } from 'dotenv';
import { resolve, dirname } from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Search upward for .env (handles both dev src/ and published dist/)
let dir = dirname(fileURLToPath(import.meta.url));
for (let i = 0; i < 6; i++) {
  const envPath = resolve(dir, '.env');
  if (existsSync(envPath)) {
    loadEnv({ path: envPath });
    break;
  }
  dir = resolve(dir, '..');
}

import { createCommand } from './commands/create.js';
import { evalCommand } from './commands/eval.js';
import { initCommand } from './commands/init.js';
import { runCli } from './framework.js';

const commands = {
  init: initCommand,
  create: createCommand,
  eval: evalCommand,
};

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const exitCode = await runCli(commands, argv);
  process.exit(exitCode);
}

main();
