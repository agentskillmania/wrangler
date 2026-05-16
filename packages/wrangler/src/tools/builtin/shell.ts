import { z } from 'zod';
import type { Tool } from '@agentskillmania/colts';
import type { ZodTypeAny } from 'zod';
import type { ToolDeps } from './workspace-deps.js';

const ShellSchema = z.object({
  command: z.string().describe('Shell command to execute'),
});

const MAX_OUTPUT = 50_000;

export function createShellTool(deps: ToolDeps): Tool<ZodTypeAny> {
  const shellHint = deps.shell ? ` Current shell: ${deps.shell.name} (${deps.shell.path}).` : '';

  return {
    name: 'shell',
    description: `Execute shell commands in the workspace.${shellHint}`,
    parameters: ShellSchema,
    async execute(args: z.infer<typeof ShellSchema>) {
      try {
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

        if (output.length > MAX_OUTPUT) {
          output = output.slice(0, MAX_OUTPUT) + '\n...(output truncated)';
        }

        return output;
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        return `Error: ${message}`;
      }
    },
  };
}
