// packages/wrangler-devtool/src/cli/commands/init.ts

import { defineCommand } from '../framework.js';
import { CliError, ExitCode } from '../options.js';
import { initProject } from '../../tools/init-workspace.js';

export const initCommand = defineCommand({
  name: 'init',
  description: 'Initialize a wrangler project',
  args: '[directory]',
  options: {
    type: {
      type: 'string',
      required: true,
      description: 'Project type: agent or crew',
    },
    'no-git': {
      type: 'boolean',
      default: false,
      description: 'Skip git repository initialization',
    },
  },
  handler: async (args, options) => {
    const directory = (args[0] as string | undefined) ?? process.cwd();
    const type = options.type as string;
    const noGit = options['no-git'] as boolean;

    if (!['agent', 'crew'].includes(type)) {
      throw new CliError(
        `Invalid type: ${type}. Must be one of: agent, crew`,
        'INVALID_TYPE',
        ExitCode.ValidationFailure
      );
    }

    await initProject(directory, { type: type as 'agent' | 'crew', noGit });
    console.log(JSON.stringify({ success: true, directory, type }));
    return ExitCode.Success;
  },
});
