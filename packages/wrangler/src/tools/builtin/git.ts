import type { Tool } from '@agentskillmania/colts';
import { parse } from 'shell-quote';
import { z } from 'zod';
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
      // Parse the command string into argv via shell-quote, then run via
      // execArray (no shell). This prevents command injection: shell
      // metacharacters ($(), ``, ;, &&) in the command become literal git
      // arguments instead of being interpreted by a shell (SEC3).
      const parsed = parse(args.command);
      const gitArgs: string[] = [];
      for (const tok of parsed) {
        if (typeof tok === 'string') {
          gitArgs.push(tok);
        } else if (tok && typeof tok === 'object' && 'op' in tok) {
          // shell-quote parses shell operators (;, &&, ||, |, $, (), etc.)
          // into {op: "..."} objects. A legitimate git subcommand should
          // never contain these — their presence indicates an attempt to
          // chain commands or do command substitution. Reject explicitly
          // rather than silently stringifying.
          return `Error: shell operator "${(tok as { op: string }).op}" is not allowed in git command. Use separate git calls instead.`;
        } else if (tok && typeof tok === 'object' && 'pattern' in tok) {
          // Glob token — stringify its pattern (e.g. for git add *.ts)
          gitArgs.push(String((tok as { pattern: string }).pattern));
        } else {
          // Any other non-string token (e.g. {entry}, {comment}) — stringify defensively
          gitArgs.push(String(tok));
        }
      }

      const result = await deps.execArray('git', gitArgs);

      if (result.exitCode === 0) {
        return result.stdout || '(no output)';
      }
      const parts: string[] = [`Exit code: ${result.exitCode}`];
      if (result.stdout) parts.push(`\nSTDOUT:\n${result.stdout}`);
      if (result.stderr) parts.push(`\nSTDERR:\n${result.stderr}`);
      return parts.join('');
    },
  };
}
