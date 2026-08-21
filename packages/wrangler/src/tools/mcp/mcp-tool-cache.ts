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
/** 内联 MCP 服务器定义(与配置文件内 mcpServers 条目同形;宿主全权注入)。 */
export interface InlineServerDef {
  command: string;
  args?: string[];
  env?: Record<string, string>;
  description?: string;
}

/** 内联定义 → mcporter ServerDefinition(stdio)。 */
function inlineServerDefs(servers: Record<string, InlineServerDef>): ServerDefinition[] {
  return Object.entries(servers).map(([name, s]) => ({
    name,
    command: { kind: 'stdio' as const, command: s.command, args: s.args ?? [], cwd: '' },
    env: s.env,
    ...(s.description ? { description: s.description } : {}),
  }));
}

/** 稳定序列化(cache 键用:键排序后 JSON,免受对象键序影响)。 */
function stableKey(value: unknown): string {
  return JSON.stringify(value, (_k, v) => {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      return Object.keys(v as Record<string, unknown>)
        .sort()
        .reduce<Record<string, unknown>>((acc, k) => {
          acc[k] = (v as Record<string, unknown>)[k];
          return acc;
        }, {});
    }
    return v;
  });
}

export class MCPToolCache {
  private runtime: Runtime | null = null;
  private cache = new Map<string, CacheEntry>();

  /**
   * Get MCP tools for config paths or inline server definitions.
   *
   * Replacement semantics: when `servers` is given, `configPaths` is
   * bypassed entirely (an empty object is an explicit empty set) —
   * mirrors the Rust daemon's `mcpServers` request contract.
   *
   * Returns cached tools if this exact combination was loaded before.
   */
  async getTools(opts: {
    configPaths?: string[];
    servers?: Record<string, InlineServerDef>;
  }): Promise<Tool<ZodTypeAny>[]> {
    const allDefs = opts.servers
      ? inlineServerDefs(opts.servers)
      : mergeServerDefinitions(
          await Promise.all((opts.configPaths ?? []).map((p) => safeLoadDefinitions(p)))
        );

    if (allDefs.length === 0) {
      return [];
    }

    const key = opts.servers
      ? `inline:${stableKey(opts.servers)}`
      : `paths:${opts.configPaths!.join('\n')}`;
    const cached = this.cache.get(key);
    if (cached) {
      return cached.tools;
    }

    const tools = await this.loadTools(allDefs);
    this.cache.set(key, { tools });
    return tools;
  }

  private async loadTools(allDefs: ServerDefinition[]): Promise<Tool<ZodTypeAny>[]> {
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

  /** Clear the tool cache and close the Runtime (releases MCP server connections). */
  async shutdown(): Promise<void> {
    this.cache.clear();
    // CONC4 fix: close the runtime to release MCP server connections
    // (stdio child processes, HTTP connections). The old code just set
    // this.runtime = null without closing, leaving orphan connections.
    if (this.runtime) {
      try {
        await this.runtime.close();
      } catch {
        // runtime.close() may fail if connections are already broken — ignore
      }
    }
    this.runtime = null;
  }
}
