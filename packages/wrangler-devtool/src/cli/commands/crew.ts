// packages/wrangler-devtool/src/cli/commands/crew.ts

import { readFile } from 'node:fs/promises';
import { access } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { defineCommand } from '../framework.js';
import { CliError, ExitCode } from '../options.js';
import { createTemplate } from '../../tools/create-template.js';
import { runCrewComposer } from '../../agents/crew-composer.js';
import { applyChanges } from '../../utils/file-change.js';

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

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
    write: {
      name: 'write',
      description: 'Generate or modify a crew using Crew Composer',
      args: '[name]',
      options: {
        prompt: {
          type: 'string',
          required: true,
          description: 'User instruction for the crew',
        },
        dryRun: {
          type: 'boolean',
          default: true,
          description: 'Preview changes without writing',
        },
        apply: {
          type: 'boolean',
          default: false,
          description: 'Apply changes to disk',
        },
      },
      handler: async (args, options) => {
        const name = args[0];
        const prompt = options.prompt as string;
        const apply = (options.apply as boolean) || false;
        const dryRun = !apply;
        const cwd = process.cwd();

        const targetFile = join(cwd, 'CREW.md');
        let existingContent: string | undefined;

        if (await fileExists(targetFile)) {
          existingContent = await readFile(targetFile, 'utf-8');
        }

        const fullPrompt = name ? `Crew name: ${name}\n${prompt}` : prompt;
        const output = await runCrewComposer(fullPrompt, existingContent);

        const result = await applyChanges(output.changes, { cwd, dryRun });

        console.log(
          JSON.stringify({
            success: result.applied,
            dryRun,
            summary: output.summary,
            changes: output.changes,
            error: result.error,
          })
        );

        if (!result.applied && !dryRun) {
          return ExitCode.ValidationFailure;
        }

        return ExitCode.Success;
      },
    },
  },
});
