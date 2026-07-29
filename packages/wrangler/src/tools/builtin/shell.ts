import type { Tool } from '@agentskillmania/colts';
import { z } from 'zod';
import type { ZodTypeAny } from 'zod';

import type { ToolDeps } from './workspace-deps.js';

const ShellSchema = z.object({
  command: z.string().describe('Shell command to execute'),
});

/**
 * Create the shell execution tool.
 *
 * @param deps - Tool dependencies (host or sandbox)
 * @param maxOutput - Maximum output length in characters before truncation.
 *   Defaults to 100000 (matches limits.maxToolOutput default).
 */
export function createShellTool(deps: ToolDeps, maxOutput = 100_000): Tool<ZodTypeAny> {
  const shellHint = deps.shell ? ` Current shell: ${deps.shell.name} (${deps.shell.path}).` : '';

  return {
    name: 'shell',
    description: `Execute shell commands in the workspace.${shellHint}`,
    parameters: ShellSchema,
    async execute(args: z.infer<typeof ShellSchema>) {
      const result = await deps.exec(args.command);

      let output: string;
      if (result.exitCode === 0) {
        output = result.stdout || '(no output)';
      } else {
        const parts: string[] = [`Exit code: ${result.exitCode}`];
        if (result.stdout) parts.push(`\nSTDOUT:\n${result.stdout}`);
        if (result.stderr) parts.push(`\nSTDERR:\n${result.stderr}`);
        output = parts.join('');
      }

      if (output.length > maxOutput) {
        output = output.slice(0, maxOutput) + '\n...(output truncated)';
      }

      return output;
    },
  };
}
