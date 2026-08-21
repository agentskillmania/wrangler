import type { Tool } from '@agentskillmania/colts';
import type { ZodTypeAny } from 'zod';

import { MCPToolCache, type InlineServerDef } from './mcp-tool-cache.js';

/**
 * Options for loading MCP tools.
 *
 * Two supply channels (replacement semantics, mirroring the Rust engine):
 * - `configPaths`: ordered list of mcporter-standard config file paths,
 *   later paths override earlier ones on server name collision;
 * - `servers`: inline server definitions from the host — when given,
 *   `configPaths` is bypassed entirely (an empty object is an explicit
 *   empty set).
 */
export interface MCPLoaderOptions {
  /**
   * Ordered list of mcporter config file paths.
   * Later entries override earlier ones on server name collision.
   * Empty or undefined → returns no tools.
   */
  configPaths?: string[];
  /** Inline server definitions (host-owned registry; bypasses configPaths). */
  servers?: Record<string, InlineServerDef>;
}

/** Module-level cache singleton. Alive for the process lifetime. */
const globalCache = new MCPToolCache();

/** @internal Reset cache and runtime for testing. */
export async function _resetCache(): Promise<void> {
  await globalCache.shutdown();
}

/**
 * Load MCP tools from config files or inline server definitions.
 *
 * Uses a global MCPToolCache singleton. First call for a given
 * combination loads fresh; subsequent calls with the same combination
 * return cached tools instantly.
 */
export async function loadMCPTools(options?: MCPLoaderOptions): Promise<Tool<ZodTypeAny>[]> {
  return globalCache.getTools(options ?? {});
}
