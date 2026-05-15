import { z } from 'zod';
import type { Tool } from '@agentskillmania/colts';
import type { ZodTypeAny } from 'zod';
import type { ToolDeps } from './workspace-deps.js';

const GitSchema = z.object({
  command: z
    .string()
    .describe('Git subcommand and arguments (e.g. "status", "add src/foo.ts", "log --oneline")'),
});

export function createGitTool(deps: ToolDeps): Tool<ZodTypeAny> {
  return {
    name: 'git',
    description: 'Execute git commands in the workspace.',
    parameters: GitSchema,
    async execute(args: z.infer<typeof GitSchema>) {
      try {
        const result = await deps.exec(`git ${args.command}`);

        if (result.exitCode === 0) {
          return result.stdout || '(no output)';
        }
        const parts: string[] = [`Exit code: ${result.exitCode}`];
        if (result.stdout) parts.push(`\nSTDOUT:\n${result.stdout}`);
        if (result.stderr) parts.push(`\nSTDERR:\n${result.stderr}`);
        return parts.join('');
      } catch (e) {
        return `Error: ${(e as Error).message}`;
      }
    },
  };
}
