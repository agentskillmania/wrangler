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
 * The description is 工况-aware (R2P-242, aligned with Rust e0517a8/be7a1b0):
 * the sandbox and host environments have materially different semantics
 * (wsh dialect quirks vs a real machine), and a neutral one-size text lets
 * the model hold wrong beliefs about both. Unknown environment (mock /
 * browser deps without `env`) keeps the neutral text.
 *
 * @param deps - Tool dependencies (host or sandbox)
 * @param maxOutput - Maximum output length in characters before truncation.
 *   Defaults to 100000 (matches limits.maxToolOutput default).
 */
export function createShellTool(deps: ToolDeps, maxOutput = 100_000): Tool<ZodTypeAny> {
  const shellHint = deps.shell ? ` Current shell: ${deps.shell.name} (${deps.shell.path}).` : '';

  // 工况 facts, all verified against SandboxToolDeps/HostToolDeps execution:
  // sandbox = wasmtime + busybox-wasm + wsh, workspace mounted at /, fresh
  // process + private /tmp per call, timeout kill; host = real machine, fresh
  // shell per call with cwd reset to the workspace root. The sandbox text
  // deliberately omits Rust's "network is disabled" clause — the TS Sandbox
  // instance's allowNetwork is not readable here, and a wrong claim is worse
  // than none (fail-closed default, but the daemon may enable it).
  const description =
    deps.env === 'sandbox'
      ? 'Execute a command in the workspace sandbox: a WASM busybox environment with ~100 commands (file ops, text processing: grep/sed/awk/sort/cut/tr/diff, hashes, gzip/tar/unzip, find without -exec) plus git (libgit2-based) and python (MicroPython, not CPython). NOT available: node, curl, compilers, make, xargs, which. The shell is wsh, not bash: supports variables, pipelines, if/for/while/case and &&/;, but no functions, break/continue, positional params or 2>&1. Always quote arguments with single quotes — double quotes and $(...) substitution have known argv bugs. Each call runs a fresh shell: cwd resets to / and env vars do not persist — chain steps with && or ; in one call. The workspace is mounted at / (private /tmp per call); long commands are killed by a timeout. Prefer dedicated tools (file_read, file_edit, grep, glob) for file work.'
      : deps.env === 'host' || deps.shell
        ? `Execute shell commands on the user's host machine from the workspace root.${shellHint} This is the REAL machine — no sandbox, container or isolation: commands have real, persistent effects on the host filesystem (including paths outside the workspace) and reach the real network; do not assume a throwaway environment. Each call runs a fresh shell: the working directory resets to the workspace root and environment variables do not persist — chain dependent steps in one command with && or ;. Long-running commands are killed by a timeout.`
        : 'Execute shell commands in the workspace.';

  return {
    name: 'shell',
    description,
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
