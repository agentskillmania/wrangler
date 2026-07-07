// packages/wrangler-devtool/src/cli/commands/crew.ts

import { runCrewComposer } from '../../agents/crew-composer.js';
import { createTemplate } from '../../tools/create-template.js';
import { defineCommand } from '../framework.js';
import { CliError, ExitCode } from '../options.js';
import { createWriteSubcommand } from './write-command.js';

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
    write: createWriteSubcommand({
      targetFileName: 'CREW.md',
      description: 'Generate or modify a crew using Crew Composer',
      // Resolve through the live binding so module-level mocks (vi.spyOn)
      // are picked up at call time rather than at module-load time.
      run: (...args) => runCrewComposer(...args),
      buildNamePrefix: (name) => `Crew name: ${name}`,
    }),
  },
});
