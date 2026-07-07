#!/usr/bin/env node
// packages/wrangler-devtool/src/cli/main.ts
// CLI 入口

import { createCommand } from './commands/create.js';
import { initCommand } from './commands/init.js';
import { testCommand } from './commands/test.js';
import { runCli } from './framework.js';

const commands = {
  init: initCommand,
  create: createCommand,
  test: testCommand,
};

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const exitCode = await runCli(commands, argv);
  process.exit(exitCode);
}

main();
