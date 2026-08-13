import type { Tool, AskHumanHandler } from '@agentskillmania/colts';
import { calculatorTool, createAskHumanTool } from '@agentskillmania/colts';
import type { Sandbox } from '@agentskillmania/sandbox';
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
import { SogouScrapeSearchProvider } from './sogou-scrape-search.js';
import { createWebFetchTool } from './web-fetch.js';
import type { SearchProvider } from './web-search.js';
import { createWebSearchTool } from './web-search.js';
import { HostToolDeps, SandboxToolDeps, DEFAULT_MAX_TOOL_OUTPUT } from './workspace-deps.js';
import type { ToolDeps } from './workspace-deps.js';
import { NodeHostEnv } from '../../host-env/node-host-env.js';

export interface BuiltinToolsOptions {
  workspacePath: string;
  timeout?: number;
  maxOutputSize?: number;
  searchProvider?: SearchProvider;
  /** When provided, all tools operate through sandbox.run() with / paths */
  sandbox?: Sandbox;
  /**
   * External ToolDeps injection — overrides HostToolDeps/SandboxToolDeps.
   * Browser extensions pass BrowserToolDeps here; omit for Node.
   */
  deps?: ToolDeps;
  /** When provided, registers the ask_human tool */
  askHumanHandler?: AskHumanHandler;
  /** Maximum tool output length in characters (default 100000). */
  maxToolOutput?: number;
  /** Default tool execution timeout in ms (default 600000 = 10min). */
  toolTimeout?: number;
}

export function createBuiltinTools(options: BuiltinToolsOptions): Tool<ZodTypeAny>[] {
  const maxOutputSize = options.maxOutputSize ?? DEFAULT_MAX_TOOL_OUTPUT;
  const toolTimeout = options.toolTimeout ?? 600_000;
  const deps: ToolDeps =
    options.deps ??
    (options.sandbox
      ? new SandboxToolDeps(options.sandbox, maxOutputSize, toolTimeout)
      : new HostToolDeps(
          new NodeHostEnv(),
          options.workspacePath,
          maxOutputSize,
          undefined,
          toolTimeout
        ));

  // Default provider matches the enhanced runner + Rust (sogou).
  const searchProvider = options.searchProvider ?? new SogouScrapeSearchProvider();

  // widenTool bridges specific Zod schemas to ZodTypeAny for uniform storage
  const widen = <T extends ZodTypeAny>(tool: Tool<T>): Tool<ZodTypeAny> =>
    tool as unknown as Tool<ZodTypeAny>;

  const tools: Tool<ZodTypeAny>[] = [
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
    createWebFetchTool(deps),
    createWebSearchTool(searchProvider),
  ];
  return tools;
}

// Re-export all tool factory functions for advanced usage
export { createFileReadTool } from './file-read.js';
export { createFileWriteTool } from './file-write.js';
export { createFileEditTool } from './file-edit.js';
export { createGlobTool } from './glob.js';
export { createGrepTool } from './grep.js';
export { createWebFetchTool } from './web-fetch.js';
export { createWebSearchTool } from './web-search.js';
export { createShellTool } from './shell.js';
export { createPythonTool } from './python.js';
export { createGitTool } from './git.js';
export { createListDirTool } from './list-dir.js';
export type { SearchProvider, SearchResult } from './web-search.js';
export { truncateOutput } from './workspace-deps.js';
export type { ToolDeps, ExecResult } from './workspace-deps.js';
export { HostToolDeps, SandboxToolDeps, resolvePath } from './workspace-deps.js';
export type { ShellInfo } from './workspace-deps.js';
export { BingScrapeSearchProvider } from './bing-scrape-search.js';
