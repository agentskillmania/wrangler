import type { ZodTypeAny } from 'zod';
import type { Tool } from '@agentskillmania/colts';
import { wrapToColtsTool } from '../wrap-tool.js';
import { createFileReadTool } from './file-read.js';
import { createFileWriteTool } from './file-write.js';
import { createFileEditTool } from './file-edit.js';
import { createGlobTool } from './glob.js';
import { createGrepTool } from './grep.js';
import { createWebFetchTool } from './web-fetch.js';
import { createWebSearchTool } from './web-search.js';
import type { WranglerToolDef } from '../types.js';
import type { SearchProvider } from './web-search.js';
import type { WorkspaceToolDeps } from './workspace-deps.js';

export interface BuiltinToolsOptions {
  workspacePath: string;
  timeout?: number;
  maxOutputSize?: number;
  searchProvider?: SearchProvider;
}

export function createBuiltinTools(options: BuiltinToolsOptions): Tool<ZodTypeAny>[] {
  const deps: WorkspaceToolDeps = {
    workspacePath: options.workspacePath,
    timeout: options.timeout,
    maxOutputSize: options.maxOutputSize,
  };

  // NOTE: shell_exec and python_exec will be added when sandbox integration is ready
  const tools = [
    createFileReadTool(deps),
    createFileWriteTool(deps),
    createFileEditTool(deps),
    createGlobTool(deps),
    createGrepTool(deps),
    createWebFetchTool(deps),
    createWebSearchTool(options.searchProvider),
  ];

  return tools.map((t) => wrapToColtsTool(t as unknown as WranglerToolDef));
}

// Re-export all tool factory functions for advanced usage
export { createFileReadTool } from './file-read.js';
export { createFileWriteTool } from './file-write.js';
export { createFileEditTool } from './file-edit.js';
export { createGlobTool } from './glob.js';
export { createGrepTool } from './grep.js';
export { createWebFetchTool } from './web-fetch.js';
export { createWebSearchTool } from './web-search.js';
export type { SearchProvider, SearchResult } from './web-search.js';
export { resolvePath, truncateOutput, isBinaryFile } from './workspace-deps.js';
export type { WorkspaceToolDeps } from './workspace-deps.js';
