// packages/wrangler-devtool/src/cli/commands/skill.ts

import { defineCommand } from '../framework.js';
import { CliError, ExitCode } from '../options.js';
import { createTemplate } from '../../tools/create-template.js';

export const skillCommand = defineCommand({
  name: 'skill',
  description: 'Skill scaffolding',
  subcommands: {
    create: {
      name: 'create',
      description: 'Create an empty skill scaffold',
      args: '<name>',
      handler: async (args) => {
        const name = args[0];
        if (!name) {
          throw new CliError('Skill name is required', 'MISSING_NAME', ExitCode.ValidationFailure);
        }
        const filePath = await createTemplate('skill', name, process.cwd());
        console.log(JSON.stringify({ success: true, file: filePath }));
        return ExitCode.Success;
      },
    },
  },
});
