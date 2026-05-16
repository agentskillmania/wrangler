#!/usr/bin/env node
// packages/wrangler-devtool/src/cli/main.ts
// CLI 入口

import { runCli } from './framework.js';
import { initCommand } from './commands/init.js';
import { agentCommand } from './commands/agent.js';
import { skillCommand } from './commands/skill.js';
import { crewCommand } from './commands/crew.js';
import { sessionCommand } from './commands/session.js';
import { testCommand } from './commands/test.js';

const commands = {
  init: initCommand,
  agent: agentCommand,
  skill: skillCommand,
  crew: crewCommand,
  session: sessionCommand,
  test: testCommand,
};

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const exitCode = await runCli(commands, argv);
  process.exit(exitCode);
}

main();
