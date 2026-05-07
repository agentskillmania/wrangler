import { z } from 'zod';
import type { Sandbox } from '@agentskillmania/sandbox';
import type { WranglerToolDef } from '../types.js';

const ShellSchema = z.object({
  command: z.string().describe('Shell command to execute in the sandbox'),
});

const MAX_OUTPUT = 50_000;

/**
 * Shell tool — executes commands via WASM sandbox.
 *
 * Requires a Sandbox instance. The tool layer hides sandbox details from callers.
 */
export function createShellTool(sandbox: Sandbox): WranglerToolDef<typeof ShellSchema> {
  return {
    name: 'shell',
    description: 'Execute shell commands in a sandboxed environment.',
    parameters: ShellSchema,
    async execute(args) {
      try {
        const result = await sandbox.run(args.command);

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

        return {
          output,
          metadata: {
            command: args.command,
            exitCode: result.exitCode,
          },
        };
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        return { output: `Error: ${message}` };
      }
    },
  };
}
