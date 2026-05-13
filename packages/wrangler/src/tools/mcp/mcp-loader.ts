import { createRuntime, loadServerDefinitions } from 'mcporter';
import type { ServerDefinition } from 'mcporter';
import type { ZodTypeAny } from 'zod';
import type { Tool } from '@agentskillmania/colts';
import { createMCPTool } from './tool-converter.js';

/**
 * Options for loading MCP tools.
 *
 * Accepts an ordered list of mcporter-standard config file paths.
 * Each is loaded via `loadServerDefinitions()`, then merged:
 * later paths override earlier ones on server name collision.
 *
 * The caller is responsible for deciding which paths to pass
 * (e.g. global auto-discovered config + local workspace mcp.json).
 */
export interface MCPLoaderOptions {
  /**
   * Ordered list of mcporter config file paths.
   * Later entries override earlier ones on server name collision.
   * Empty or undefined → returns no tools.
   */
  configPaths?: string[];
}

/** Merge multiple ServerDefinition arrays; later entries override earlier on name collision. */
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

/** Load server definitions, returning empty array on failure. */
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
 * Load MCP tools from one or more mcporter config files.
 *
 * Each config path is loaded independently via `loadServerDefinitions()`,
 * then merged at the `ServerDefinition[]` level. Later config paths
 * override earlier ones on server name collision.
 */
export async function loadMCPTools(options?: MCPLoaderOptions): Promise<Tool<ZodTypeAny>[]> {
  const paths = options?.configPaths;
  if (!paths || paths.length === 0) {
    return [];
  }

  const allDefs = mergeServerDefinitions(
    await Promise.all(paths.map((p) => safeLoadDefinitions(p)))
  );

  if (allDefs.length === 0) {
    return [];
  }

  let runtime;
  try {
    runtime = await createRuntime({ servers: allDefs });
  } catch (error) {
    console.warn(
      `[wrangler/mcp] Failed to create MCP runtime: ${error instanceof Error ? error.message : String(error)}`
    );
    return [];
  }

  const tools: Tool<ZodTypeAny>[] = [];

  try {
    for (const serverDef of allDefs) {
      try {
        const mcpTools = await runtime.listTools(serverDef.name);

        for (const mcpTool of mcpTools) {
          tools.push(
            createMCPTool(
              serverDef.name,
              mcpTool.name,
              mcpTool.description || `MCP tool ${mcpTool.name} from ${serverDef.name}`,
              mcpTool.inputSchema as Record<string, unknown> | undefined,
              async (srv, tool, args) => {
                try {
                  const result = await runtime.callTool(srv, tool, { args });
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
  } finally {
    try {
      await runtime.close();
    } catch (error) {
      console.warn(
        `[wrangler/mcp] Failed to close runtime: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  return tools;
}
