import type { Tool } from '@agentskillmania/colts';
import { createRuntime, loadServerDefinitions } from 'mcporter';
import type { ServerDefinition, Runtime } from 'mcporter';
import type { ZodTypeAny } from 'zod';

import { createMCPTool } from './tool-converter.js';

interface CacheEntry {
  tools: Tool<ZodTypeAny>[];
}

function mergeServerDefinitions(allDefs: ServerDefinition[][]): ServerDefinition[] {
  const merged: ServerDefinition[] = [];
  for (const defs of allDefs) {
    for (const def of defs) {
      const idx = merged.findIndex((d) => d.name === def.name);
      if (idx >= 0) {
        merged[idx] = def;
      } else {
        merged.push(def);
      }
    }
  }
  return merged;
}

async function safeLoadDefinitions(configPath: string): Promise<ServerDefinition[]> {
  try {
    return await loadServerDefinitions({ configPath });
  } catch (error) {
    console.warn(
      `[wrangler/mcp] Failed to load config from ${configPath}: ${error instanceof Error ? error.message : String(error)}`
    );
    return [];
  }
}

/**
 * Global MCP tool cache with Runtime singleton.
 *
 * One mcporter Runtime is created on first access and reused for all
 * subsequent tool loads. Tool lists are cached by configPaths key.
 * No hot-reload — process restart required for config changes.
 */
export class MCPToolCache {
  private runtime: Runtime | null = null;
  private cache = new Map<string, CacheEntry>();

  /**
   * Get MCP tools for the given config paths.
   *
   * Returns cached tools if this exact configPaths combination was loaded before.
   * Otherwise loads fresh from config files via the shared Runtime.
   */
  async getTools(configPaths?: string[]): Promise<Tool<ZodTypeAny>[]> {
    if (!configPaths || configPaths.length === 0) {
      return [];
    }

    const key = configPaths.join('\0');
    const cached = this.cache.get(key);
    if (cached) {
      return cached.tools;
    }

    const tools = await this.loadTools(configPaths);
    this.cache.set(key, { tools });
    return tools;
  }

  private async loadTools(configPaths: string[]): Promise<Tool<ZodTypeAny>[]> {
    const allDefs = mergeServerDefinitions(
      await Promise.all(configPaths.map((p) => safeLoadDefinitions(p)))
    );

    if (allDefs.length === 0) {
      return [];
    }

    if (!this.runtime) {
      try {
        this.runtime = await createRuntime({ servers: allDefs });
      } catch (error) {
        console.warn(
          `[wrangler/mcp] Failed to create MCP runtime: ${error instanceof Error ? error.message : String(error)}`
        );
        return [];
      }
    } else {
      // BUG9 fix: incrementally register any new servers not yet in the runtime.
      // The old code skipped this entirely (runtime already existed), so new
      // config paths with new servers were silently unavailable.
      const existingServers = new Set(this.runtime.listServers());
      for (const def of allDefs) {
        if (!existingServers.has(def.name)) {
          try {
            this.runtime.registerDefinition(def);
          } catch (error) {
            console.warn(
              `[wrangler/mcp] Failed to register server "${def.name}": ${error instanceof Error ? error.message : String(error)}`
            );
          }
        }
      }
    }

    const tools: Tool<ZodTypeAny>[] = [];

    for (const serverDef of allDefs) {
      try {
        const mcpTools = await this.runtime.listTools(serverDef.name);

        for (const mcpTool of mcpTools) {
          tools.push(
            createMCPTool(
              serverDef.name,
              mcpTool.name,
              mcpTool.description || `MCP tool ${mcpTool.name} from ${serverDef.name}`,
              mcpTool.inputSchema as Record<string, unknown> | undefined,
              async (srv, tool, args) => {
                try {
                  const result = await this.runtime!.callTool(srv, tool, { args });
                  if (typeof result === 'string') return result;
                  if (result && typeof result === 'object') {
                    const res = result as Record<string, unknown>;
                    if (typeof res.text === 'string') return res.text;
                    if (typeof res.content === 'string') return res.content;
                    if (Array.isArray(res.content)) {
                      return res.content
                        .map((c: unknown) => {
                          if (typeof c === 'object' && c !== null && 'text' in (c as object)) {
                            return (c as { text: string }).text;
                          }
                          return JSON.stringify(c);
                        })
                        .join('\n');
                    }
                    return JSON.stringify(res);
                  }
                  return String(result);
                } catch (error) {
                  const message = error instanceof Error ? error.message : String(error);
                  return `Error calling MCP tool ${srv}__${tool}: ${message}`;
                }
              }
            )
          );
        }
      } catch (error) {
        console.warn(
          `[wrangler/mcp] Failed to list tools from server "${serverDef.name}": ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }

    return tools;
  }

  /** Clear the tool cache and discard the Runtime. */
  shutdown(): void {
    this.cache.clear();
    this.runtime = null;
  }
}
