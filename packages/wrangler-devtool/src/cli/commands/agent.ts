// packages/wrangler-devtool/src/cli/commands/agent.ts

import { runAgentArchitect } from '../../agents/architect.js';
import { createTemplate } from '../../tools/create-template.js';
import { defineCommand } from '../framework.js';
import { CliError, ExitCode } from '../options.js';
import { createWriteSubcommand } from './write-command.js';

export const agentCommand = defineCommand({
  name: 'agent',
  description: 'Agent scaffolding',
  subcommands: {
    create: {
      name: 'create',
      description: 'Create an empty agent scaffold',
      args: '<name>',
      handler: async (args) => {
        const name = args[0];
        if (!name) {
          throw new CliError('Agent name is required', 'MISSING_NAME', ExitCode.ValidationFailure);
        }
        const filePath = await createTemplate('agent', name, process.cwd());
        console.log(JSON.stringify({ success: true, file: filePath }));
        return ExitCode.Success;
      },
    },
    write: createWriteSubcommand({
      targetFileName: 'AGENT.md',
      description: 'Generate or modify an agent using Agent Architect',
      // Resolve through the live binding so module-level mocks (vi.spyOn)
      // are picked up at call time rather than at module-load time.
      run: (...args) => runAgentArchitect(...args),
      buildNamePrefix: (name) => `Agent name: ${name}`,
    }),
  },
});
