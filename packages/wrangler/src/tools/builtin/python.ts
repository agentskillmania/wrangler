import type { Tool } from '@agentskillmania/colts';
import { z } from 'zod';
import type { ZodTypeAny } from 'zod';

import type { ToolDeps } from './workspace-deps.js';

/**
 * Python interpreter probe（P3 Task 9，对齐 Rust e531684 HostProbe::detect）：
 * 候选顺序 python3 → python → py（py 是 Windows launcher 惯例——裸机执行
 * 硬编码 python3 在 Windows 宿主必坏）。各 spawn 一次 `--version`，一次性
 * 毫秒级开销，进程内缓存。探不到不注册硬命令而是返回可诊断错误。
 */
let cachedInterpreter: { command: string; version: string | null } | null | undefined;

async function probeInterpreter(
  deps: ToolDeps
): Promise<{ command: string; version: string | null } | null> {
  if (cachedInterpreter !== undefined) return cachedInterpreter;
  for (const cmd of ['python3', 'python', 'py']) {
    try {
      const r = await deps.execArray(cmd, ['--version']);
      if (r.exitCode === 0) {
        const version = (r.stdout || r.stderr || '').split('\n')[0]?.trim() || null;
        cachedInterpreter = { command: cmd, version };
        return cachedInterpreter;
      }
    } catch {
      /* candidate not available — try the next */
    }
  }
  cachedInterpreter = null;
  return null;
}

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

      // sandbox 走 MicroPython 容器（无探测）；宿主按 python3→python→py 探测。
      const interpreter =
        deps.env === 'sandbox'
          ? { command: 'python3', version: null }
          : await probeInterpreter(deps);
      if (!interpreter) {
        return 'Error: No Python interpreter found (tried python3, python, py).';
      }

      // Run via execArray (no shell) so file paths and code are passed as
      // literal argv elements. This prevents command injection from filenames
      // containing shell metacharacters (spaces, ;, $()) and removes the need
      // for manual shell escaping of code (SEC4).
      let result;
      if (args.file) {
        const filePath = deps.resolvePath(args.file);
        result = await deps.execArray(interpreter.command, [filePath]);
      } else {
        result = await deps.execArray(interpreter.command, ['-c', args.code!]);
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
