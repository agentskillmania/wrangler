// packages/wrangler-devtool/src/cli/commands/init.ts

import { defineCommand } from '../framework.js';
import { CliError, ExitCode } from '../options.js';
import { initWorkspace } from '../../tools/init-workspace.js';

export const initCommand = defineCommand({
  name: 'init',
  description: 'Initialize a wrangler workspace',
  args: '[directory]',
  options: {
    mode: {
      type: 'string',
      required: true,
      description: 'Workspace mode: agent, crew, or bare',
    },
    'no-git': {
      type: 'boolean',
      default: false,
      description: 'Skip git repository initialization',
    },
  },
  handler: async (args, options) => {
    const directory = (args[0] as string | undefined) ?? process.cwd();
    const mode = options.mode as string;
    const noGit = options['noGit'] as boolean;

    if (!['agent', 'crew', 'bare'].includes(mode)) {
      throw new CliError(
        `Invalid mode: ${mode}. Must be one of: agent, crew, bare`,
        'INVALID_MODE',
        ExitCode.ValidationFailure
      );
    }

    await initWorkspace(directory, { mode: mode as 'agent' | 'crew' | 'bare', noGit });
    console.log(JSON.stringify({ success: true, directory, mode }));
    return ExitCode.Success;
  },
});
