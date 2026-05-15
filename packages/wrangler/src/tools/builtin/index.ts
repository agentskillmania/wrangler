import type { ZodTypeAny } from 'zod';
import type { Tool } from '@agentskillmania/colts';
import { createFileReadTool } from './file-read.js';
import { createFileWriteTool } from './file-write.js';
import { createFileEditTool } from './file-edit.js';
import { createGlobTool } from './glob.js';
import { createGrepTool } from './grep.js';
import { createWebFetchTool } from './web-fetch.js';
import { createWebSearchTool } from './web-search.js';
import { createShellTool } from './shell.js';
import type { SearchProvider } from './web-search.js';
import type { WorkspaceToolDeps } from './workspace-deps.js';
import { HostToolDeps } from './workspace-deps.js';

export interface BuiltinToolsOptions {
  workspacePath: string;
  timeout?: number;
  maxOutputSize?: number;
  searchProvider?: SearchProvider;
}

export function createBuiltinTools(options: BuiltinToolsOptions): Tool<ZodTypeAny>[] {
  const workspaceDeps: WorkspaceToolDeps = {
    workspacePath: options.workspacePath,
    timeout: options.timeout,
    maxOutputSize: options.maxOutputSize,
  };

  const hostDeps = new HostToolDeps(options.workspacePath, options.maxOutputSize ?? 1024 * 1024);

  const tools: Tool<ZodTypeAny>[] = [
    createFileReadTool(hostDeps),
    createFileWriteTool(hostDeps),
    createFileEditTool(hostDeps),
    createGlobTool(hostDeps),
    createGrepTool(hostDeps),
    createWebFetchTool(workspaceDeps),
    createWebSearchTool(options.searchProvider),
    createShellTool(hostDeps),
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
export type { SearchProvider, SearchResult } from './web-search.js';
export { resolvePath, truncateOutput, isBinaryFile } from './workspace-deps.js';
export type { WorkspaceToolDeps } from './workspace-deps.js';
