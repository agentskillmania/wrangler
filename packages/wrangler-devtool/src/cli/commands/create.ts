// packages/wrangler-devtool/src/cli/commands/create.ts
// Merged `create` command — replaces agent/crew/skill `create` subcommands.

import { createTemplate } from '../../tools/create-template.js';
import { defineCommand } from '../framework.js';
import { CliError, ExitCode } from '../options.js';

type ScaffoldType = 'agent' | 'crew' | 'skill';

const ALLOWED_TYPES: readonly ScaffoldType[] = ['agent', 'crew', 'skill'];

export const createCommand = defineCommand({
  name: 'create',
  description: 'Create an empty agent/crew/skill scaffold',
  args: '<type> <name>',
  handler: async (args) => {
    const type = args[0] as string | undefined;
    const name = args[1] as string | undefined;

    if (!type) {
      throw new CliError(
        `Scaffold type is required (one of: ${ALLOWED_TYPES.join(', ')})`,
        'MISSING_TYPE',
        ExitCode.ValidationFailure
      );
    }

    if (!ALLOWED_TYPES.includes(type as ScaffoldType)) {
      throw new CliError(
        `Invalid type: ${type}. Must be one of: ${ALLOWED_TYPES.join(', ')}`,
        'INVALID_TYPE',
        ExitCode.ValidationFailure
      );
    }

    if (!name) {
      throw new CliError('Name is required', 'MISSING_NAME', ExitCode.ValidationFailure);
    }

    const filePath = await createTemplate(type as ScaffoldType, name, process.cwd());
    console.log(JSON.stringify({ success: true, type, name, file: filePath }));
    return ExitCode.Success;
  },
});
