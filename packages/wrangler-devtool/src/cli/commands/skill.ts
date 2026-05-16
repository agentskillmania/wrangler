// packages/wrangler-devtool/src/cli/commands/skill.ts

import { readFile } from 'node:fs/promises';
import { access, mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { defineCommand } from '../framework.js';
import { CliError, ExitCode } from '../options.js';
import { createTemplate } from '../../tools/create-template.js';
import { runSkillDesigner } from '../../agents/skill-designer.js';
import { applyChanges } from '../../utils/file-change.js';

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

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
    write: {
      name: 'write',
      description: 'Generate or modify a skill using Skill Designer',
      args: '[name]',
      options: {
        prompt: {
          type: 'string',
          required: true,
          description: 'User instruction for the skill',
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

        let targetFile: string;
        let existingContent: string | undefined;

        if (name) {
          targetFile = join(cwd, 'skills', `${name}.md`);
          await mkdir(join(cwd, 'skills'), { recursive: true });
        } else {
          // Without a name, we can't know the target file until the agent responds.
          // Pass through and let the agent decide the file path.
          targetFile = '';
        }

        if (targetFile && (await fileExists(targetFile))) {
          existingContent = await readFile(targetFile, 'utf-8');
        }

        const fullPrompt = name
          ? `Skill name: ${name}\nTarget file: skills/${name}.md\n${prompt}`
          : `Infer a skill name from this request. ${prompt}`;
        const output = await runSkillDesigner(fullPrompt, existingContent);

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
