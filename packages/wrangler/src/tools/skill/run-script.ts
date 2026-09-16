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
import { stat } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';

import type { ISkillProvider } from '@agentskillmania/colts';
import type { Tool } from '@agentskillmania/colts';
import { z } from 'zod';
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
  skillProvider: ISkillProvider
): Tool<ZodTypeAny> {
  return {
    name: 'run_skill_script',
    description:
      'Run a script bundled with a skill. `script_path` must be one of the scripts listed ' +
      "when the skill was loaded (load_skill returns the inventory) or named in the skill's " +
      'instructions — do not guess paths. You choose the interpreter/engine via the ' +
      '`command` parameter — it can be a bare command name resolved from PATH (e.g. ' +
      '"python3", "node", "bash") or a full executable path (e.g. ' +
      '"/usr/local/bin/python3.11", "/opt/homebrew/bin/node"). Use this to select a ' +
      'specific version or installation of the interpreter.',
    parameters: z.object({
      skill_name: z.string().describe('The skill name the script belongs to'),
      script_path: z
        .string()
        .describe(
          "Exact script path from the skill's inventory (returned by load_skill). Do not guess"
        ),
      command: z
        .string()
        .describe(
          'Interpreter/engine to run the script: a command name resolved from PATH (e.g. "python3", "node") or a full executable path (e.g. "/usr/local/bin/python3.11")'
        ),
      args: z.array(z.string()).optional().describe('Arguments to pass to the script'),
    }),
    execute: async ({ skill_name, script_path, command, args }): Promise<string> => {
      const manifest = await skillProvider.getManifest(skill_name);
      if (!manifest) {
        const available = (await skillProvider.listSkills()).map((s) => s.name);
        return `Skill '${skill_name}' not found. Available: ${available.join(', ')}`;
      }
      // Only accept relative paths inside the skill directory: absolute paths
      // and `..` components could point outside it — reject both.
      // (R2P-114w, aligned with Rust c78cfcc.)
      if (isAbsolute(script_path) || script_path.split(/[\\/]+/).includes('..')) {
        return (
          `Invalid script path '${script_path}': must be a relative path inside the skill ` +
          "directory (see the skill's script inventory)"
        );
      }
      const scriptAbs = join(manifest.source, script_path);
      let scriptExists = false;
      try {
        scriptExists = (await stat(scriptAbs)).isFile();
      } catch {
        // Missing file — handled by the self-heal branch below.
      }
      if (!scriptExists) {
        // Failure self-heal: attach the skill's ACTUAL script inventory so
        // the model corrects itself in one shot. (R2P-114w, Rust c78cfcc.)
        const scripts = manifest.scripts ?? [];
        if (scripts.length === 0) {
          return `Script not found: ${scriptAbs}`;
        }
        return `Script not found: ${scriptAbs}. Scripts in skill '${skill_name}': ${scripts.join(', ')}`;
      }
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
