import type { Tool, AskHumanHandler } from '@agentskillmania/colts';
import { calculatorTool, createAskHumanTool } from '@agentskillmania/colts';
import type { Sandbox } from '@agentskillmania/sandbox';
import type { ZodTypeAny } from 'zod';

import { BingScrapeSearchProvider } from './bing-scrape-search.js';
import { createFileEditTool } from './file-edit.js';
import { createFileReadTool } from './file-read.js';
import { createFileWriteTool } from './file-write.js';
import { createGitTool } from './git.js';
import { createGlobTool } from './glob.js';
import { createGrepTool } from './grep.js';
import { createPythonTool } from './python.js';
import { createShellTool } from './shell.js';
import { createWebFetchTool } from './web-fetch.js';
import type { SearchProvider } from './web-search.js';
import { createWebSearchTool } from './web-search.js';
import { HostToolDeps, SandboxToolDeps } from './workspace-deps.js';
import type { ToolDeps } from './workspace-deps.js';

export interface BuiltinToolsOptions {
  workspacePath: string;
  timeout?: number;
  maxOutputSize?: number;
  searchProvider?: SearchProvider;
  /** When provided, all tools operate through sandbox.run() with / paths */
  sandbox?: Sandbox;
  /** When provided, registers the ask_human tool */
  askHumanHandler?: AskHumanHandler;
}

export function createBuiltinTools(options: BuiltinToolsOptions): Tool<ZodTypeAny>[] {
  const deps: ToolDeps = options.sandbox
    ? new SandboxToolDeps(options.sandbox, options.maxOutputSize ?? 1024 * 1024)
    : new HostToolDeps(options.workspacePath, options.maxOutputSize ?? 1024 * 1024);

  const searchProvider = options.searchProvider ?? new BingScrapeSearchProvider();

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
    createShellTool(deps),
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
export type { SearchProvider, SearchResult } from './web-search.js';
export { truncateOutput, isBinaryFile } from './workspace-deps.js';
export type { ToolDeps, ExecResult } from './workspace-deps.js';
export { HostToolDeps, SandboxToolDeps, resolvePath, detectShell } from './workspace-deps.js';
export type { ShellInfo } from './workspace-deps.js';
export { BingScrapeSearchProvider } from './bing-scrape-search.js';
