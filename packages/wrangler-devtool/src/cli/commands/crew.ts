// packages/wrangler-devtool/src/cli/commands/crew.ts

import { defineCommand } from '../framework.js';
import { CliError, ExitCode } from '../options.js';
import { createTemplate } from '../../tools/create-template.js';

export const crewCommand = defineCommand({
  name: 'crew',
  description: 'Crew scaffolding',
  subcommands: {
    create: {
      name: 'create',
      description: 'Create an empty crew scaffold',
      args: '<name>',
      handler: async (args) => {
        const name = args[0];
        if (!name) {
          throw new CliError('Crew name is required', 'MISSING_NAME', ExitCode.ValidationFailure);
        }
        const filePath = await createTemplate('crew', name, process.cwd());
        console.log(JSON.stringify({ success: true, file: filePath }));
        return ExitCode.Success;
      },
    },
  },
});
