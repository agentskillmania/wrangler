/**
 * @fileoverview run_skill_script tool
 *
 * Executes a script from a skill directory. The agent decides which command
 * (interpreter/engine) to use — the tool only resolves the script path within
 * the skill directory and runs it with the given command + args.
 *
 * The script executes in-place on disk, so relative imports (Python `from .`,
 * Node `require('./...')`) resolve naturally against the skill directory.
 */
import { join } from 'node:path';

import { z } from 'zod';

import type { ISkillProvider } from '@agentskillmania/colts';
import type { Tool } from '@agentskillmania/colts';
import type { ZodTypeAny } from 'zod';

import type { ToolDeps } from '../builtin/workspace-deps.js';

/**
 * Create the run_skill_script tool.
 *
 * @param deps - Tool deps (for execArray — no shell interpolation)
 * @param skillProvider - Skill provider instance
 * @returns Tool definition
 */
export function createRunScriptTool(
  deps: ToolDeps,
  skillProvider: ISkillProvider,
): Tool<ZodTypeAny> {
  return {
    name: 'run_skill_script',
    description:
      'Run a script bundled with a skill. The script path is relative to the skill directory; relative imports resolve against the skill directory. You choose the interpreter/engine via the `command` parameter — it can be a bare command name resolved from PATH (e.g. "python3", "node", "bash") or a full executable path (e.g. "/usr/local/bin/python3.11", "/opt/homebrew/bin/node"). Use this to select a specific version or installation of the interpreter.',
    parameters: z.object({
      skill_name: z.string().describe('The skill name the script belongs to'),
      script_path: z.string().describe('Path to the script, relative to the skill directory'),
      command: z
        .string()
        .describe(
          'Interpreter/engine to run the script: a command name resolved from PATH (e.g. "python3", "node") or a full executable path (e.g. "/usr/local/bin/python3.11")',
        ),
      args: z.array(z.string()).optional().describe('Arguments to pass to the script'),
    }),
    execute: async ({ skill_name, script_path, command, args }): Promise<string> => {
      const manifest = await skillProvider.getManifest(skill_name);
      if (!manifest) {
        const available = (await skillProvider.listSkills()).map((s) => s.name);
        return `Skill '${skill_name}' not found. Available: ${available.join(', ')}`;
      }
      const scriptAbs = join(manifest.source, script_path);
      const result = await deps.execArray(command, [scriptAbs, ...(args ?? [])]);
      if (result.exitCode === 0) {
        return result.stdout || '(no output)';
      }
      const parts = [`Exit code: ${result.exitCode}`];
      if (result.stdout) parts.push(`\nSTDOUT:\n${result.stdout}`);
      if (result.stderr) parts.push(`\nSTDERR:\n${result.stderr}`);
      return parts.join('');
    },
  };
}
