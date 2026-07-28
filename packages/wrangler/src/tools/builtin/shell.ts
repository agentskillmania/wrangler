import type { Tool } from '@agentskillmania/colts';
import { z } from 'zod';
import type { ZodTypeAny } from 'zod';

import type { ToolDeps } from './workspace-deps.js';

const ShellSchema = z.object({
  command: z.string().describe('Shell command to execute'),
});

const MAX_OUTPUT = 50_000;

export function createShellTool(deps: ToolDeps): Tool<ZodTypeAny> {
  const shellHint = deps.shell ? ` Current shell: ${deps.shell.name} (${deps.shell.path}).` : '';

  const sandboxHint = deps.isSandboxed
    ? ` Commands run inside a sandboxed environment. The workspace is mounted at ${deps.workspaceRoot}. You cannot access files outside ${deps.workspaceRoot} — paths like ../ or /etc/ will not work. Only use relative paths or paths within ${deps.workspaceRoot}.`
    : ` Commands run in ${deps.workspaceRoot}.`;

  return {
    name: 'shell',
    description: `Execute shell commands in the workspace.${shellHint}${sandboxHint}`,
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

      if (output.length > MAX_OUTPUT) {
        output = output.slice(0, MAX_OUTPUT) + '\n...(output truncated)';
      }

      return output;
    },
  };
}
