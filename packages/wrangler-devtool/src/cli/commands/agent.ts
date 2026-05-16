// packages/wrangler-devtool/src/cli/commands/agent.ts

import { defineCommand } from '../framework.js';
import { CliError, ExitCode } from '../options.js';
import { createTemplate } from '../../tools/create-template.js';

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
  },
});
