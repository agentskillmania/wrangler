import type { Tool } from '@agentskillmania/colts';
import { z } from 'zod';
import type { ZodTypeAny } from 'zod';

import type { ToolDeps } from './workspace-deps.js';

const PythonSchema = z.object({
  code: z.string().optional().describe('Python code to execute'),
  file: z.string().optional().describe('Python script file path to execute'),
});

export function createPythonTool(deps: ToolDeps): Tool<ZodTypeAny> {
  // 工况-aware description (R2P-242, aligned with Rust e531684): the sandbox
  // python is MicroPython (busybox-wasm component) — a CPython-assuming model
  // would write numpy/pip code and then be confused by the errors. Host or
  // unknown environments keep the neutral text.
  const description =
    deps.env === 'sandbox'
      ? 'Execute Python code in the workspace sandbox via MicroPython — NOT CPython: a Python 3 language subset with a pure-Python standard library subset (json, os, sys, re, math and similar); NO pip, venv, or C-extension packages (numpy/pandas etc. are unavailable). Multi-line inline code works. Provide either `code` (inline) or `file` (script path).'
      : 'Execute Python code. Provide either `code` (inline) or `file` (script path).';

  return {
    name: 'python',
    description,
    parameters: PythonSchema,
    async execute(args: z.infer<typeof PythonSchema>) {
      if (!args.code && !args.file) {
        return 'Error: Provide either `code` or `file` parameter.';
      }

      // Run via execArray (no shell) so file paths and code are passed as
      // literal argv elements. This prevents command injection from filenames
      // containing shell metacharacters (spaces, ;, $()) and removes the need
      // for manual shell escaping of code (SEC4).
      let result;
      if (args.file) {
        const filePath = deps.resolvePath(args.file);
        result = await deps.execArray('python3', [filePath]);
      } else {
        result = await deps.execArray('python3', ['-c', args.code!]);
      }

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
