import type { Tool, AskHumanHandler } from '@agentskillmania/colts';
import { calculatorTool, createAskHumanTool } from '@agentskillmania/colts';
import type { ZodTypeAny } from 'zod';

import { createFileEditTool } from './file-edit.js';
import { createFileReadTool } from './file-read.js';
import { createFileWriteTool } from './file-write.js';
import { createGitTool } from './git.js';
import { createGlobTool } from './glob.js';
import { createGrepTool } from './grep.js';
import { createListDirTool } from './list-dir.js';
import { createPythonTool } from './python.js';
import { createShellTool } from './shell.js';
import type { ToolDeps } from './workspace-deps.js';

export interface CoreToolsOptions {
  /**
   * 工具依赖（必传）——宿主注入：Node 用 HostToolDeps(NodeHostEnv, ...)、
   * 浏览器用 BrowserToolDeps。core 不构造 Node 实现（保持平台无关）。
   */
  deps: ToolDeps;
  /** When provided, registers the ask_human tool */
  askHumanHandler?: AskHumanHandler;
  /** Maximum tool output length in characters (default 100000). */
  maxToolOutput?: number;
}

/**
 * 平台无关的核心工具集：calculator / ask_human / file_* / glob / grep /
 * list_dir / shell / python / git。全部通过注入的 ToolDeps 访问宿主能力。
 *
 * web_fetch / web_search 是 Node 专属（jsdom 爬虫）——由宿主从
 * `@agentskillmania/wrangler/tools/web` 子路径组装后经 tools.inject 注入。
 */
export function createCoreTools(options: CoreToolsOptions): Tool<ZodTypeAny>[] {
  const deps = options.deps;

  // widenTool bridges specific Zod schemas to ZodTypeAny for uniform storage
  const widen = <T extends ZodTypeAny>(tool: Tool<T>): Tool<ZodTypeAny> =>
    tool as unknown as Tool<ZodTypeAny>;

  return [
    widen(calculatorTool),
    ...(options.askHumanHandler ? [widen(createAskHumanTool(options.askHumanHandler))] : []),
    createFileReadTool(deps),
    createFileWriteTool(deps),
    createFileEditTool(deps),
    createGlobTool(deps),
    createGrepTool(deps),
    createListDirTool(deps),
    createShellTool(deps, options.maxToolOutput),
    createPythonTool(deps),
    createGitTool(deps),
  ];
}

// Re-export tool factory functions for advanced usage（平台无关子集）
export { createFileReadTool } from './file-read.js';
export { createFileWriteTool } from './file-write.js';
export { createFileEditTool } from './file-edit.js';
export { createGlobTool } from './glob.js';
export { createGrepTool } from './grep.js';
export { createShellTool } from './shell.js';
export { createPythonTool } from './python.js';
export { createGitTool } from './git.js';
export { createListDirTool } from './list-dir.js';
export { truncateOutput } from './workspace-deps.js';
export type { ToolDeps, ExecResult } from './workspace-deps.js';
export { HostToolDeps, SandboxToolDeps, resolvePath } from './workspace-deps.js';
export type { ShellInfo } from './workspace-deps.js';
