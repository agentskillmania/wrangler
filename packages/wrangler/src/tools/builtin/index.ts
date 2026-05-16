import type { ZodTypeAny } from 'zod';
import type { Tool } from '@agentskillmania/colts';
import type { SearchProvider } from './web-search.js';
import { HostToolDeps } from './workspace-deps.js';
import type { ToolDeps } from './workspace-deps.js';
import { createFileReadTool } from './file-read.js';
import { createFileWriteTool } from './file-write.js';
import { createFileEditTool } from './file-edit.js';
import { createGlobTool } from './glob.js';
import { createGrepTool } from './grep.js';
import { createWebFetchTool } from './web-fetch.js';
import { createWebSearchTool } from './web-search.js';
import { createShellTool } from './shell.js';
import { createPythonTool } from './python.js';
import { createGitTool } from './git.js';

export interface BuiltinToolsOptions {
  workspacePath: string;
  timeout?: number;
  maxOutputSize?: number;
  searchProvider?: SearchProvider;
}

export function createBuiltinTools(options: BuiltinToolsOptions): Tool<ZodTypeAny>[] {
  const deps: ToolDeps = new HostToolDeps(
    options.workspacePath,
    options.maxOutputSize ?? 1024 * 1024
  );

  return [
    createFileReadTool(deps),
    createFileWriteTool(deps),
    createFileEditTool(deps),
    createGlobTool(deps),
    createGrepTool(deps),
    createShellTool(deps),
    createPythonTool(deps),
    createGitTool(deps),
    createWebFetchTool(deps),
    createWebSearchTool(options.searchProvider),
  ];
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
export { HostToolDeps, resolvePath, detectShell } from './workspace-deps.js';
export type { ShellInfo } from './workspace-deps.js';
