// packages/wrangler-devtool/src/cli/commands/agent.ts

import { readFile } from 'node:fs/promises';
import { access } from 'node:fs/promises';
import { join } from 'node:path';
import { defineCommand } from '../framework.js';
import { CliError, ExitCode } from '../options.js';
import { createTemplate } from '../../tools/create-template.js';
import { runAgentArchitect } from '../../agents/architect.js';
import { applyChanges } from '../../utils/file-change.js';

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

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
    write: {
      name: 'write',
      description: 'Generate or modify an agent using Agent Architect',
      args: '[name]',
      options: {
        prompt: {
          type: 'string',
          required: true,
          description: 'User instruction for the agent',
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

        const targetFile = join(cwd, 'AGENT.md');
        let existingContent: string | undefined;

        if (await fileExists(targetFile)) {
          existingContent = await readFile(targetFile, 'utf-8');
        }

        const fullPrompt = name ? `Agent name: ${name}\n${prompt}` : prompt;
        const output = await runAgentArchitect(fullPrompt, existingContent);

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
