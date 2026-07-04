import type { Tool } from '@agentskillmania/colts';
import type { ZodTypeAny } from 'zod';

import { MCPToolCache } from './mcp-tool-cache.js';

/**
 * Options for loading MCP tools.
 *
 * Accepts an ordered list of mcporter-standard config file paths.
 * Each is loaded via `loadServerDefinitions()`, then merged:
 * later paths override earlier ones on server name collision.
 */
export interface MCPLoaderOptions {
  /**
   * Ordered list of mcporter config file paths.
   * Later entries override earlier ones on server name collision.
   * Empty or undefined → returns no tools.
   */
  configPaths?: string[];
}

/** Module-level cache singleton. Alive for the process lifetime. */
const globalCache = new MCPToolCache();

/** @internal Reset cache and runtime for testing. */
export async function _resetCache(): Promise<void> {
  await globalCache.shutdown();
}

/**
 * Load MCP tools from one or more mcporter config files.
 *
 * Uses a global MCPToolCache singleton. First call for a given
 * configPaths combination loads from config files; subsequent calls
 * with the same paths return cached tools instantly.
 */
export async function loadMCPTools(options?: MCPLoaderOptions): Promise<Tool<ZodTypeAny>[]> {
  return globalCache.getTools(options?.configPaths);
}
