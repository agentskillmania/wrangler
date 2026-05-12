import { createRuntime } from 'mcporter';
import type { ZodTypeAny } from 'zod';
import type { Tool } from '@agentskillmania/colts';
import {
  mergeMCPConfigs,
  readConfigFile,
  discoverGlobalConfigPath,
  type MCPServerDef,
  type MCPConfig,
} from './config-merger.js';
import { createMCPTool } from './tool-converter.js';

/**
 * Options for loading MCP tools
 */
export interface MCPLoaderOptions {
  /** Explicit path to global mcporter config */
  globalConfigPath?: string;
  /** Path to a local mcp.json (crew/agent level) */
  localConfigPath?: string;
  /** Server names to filter */
  serverFilter?: string[];
}

/**
 * Loads MCP tools from global and local configurations
 *
 * @param options - Configuration options for loading MCP tools
 * @returns Array of Tools loaded from MCP servers
 */
export async function loadMCPTools(options?: MCPLoaderOptions): Promise<Tool<ZodTypeAny>[]> {
  const tools: Tool<ZodTypeAny>[] = [];

  // Step 1: Load global config
  let globalConfig: MCPConfig;
  try {
    const globalConfigPath = discoverGlobalConfigPath(options?.globalConfigPath);
    globalConfig = await readConfigFile(globalConfigPath);
  } catch (error) {
    // Silently fail on global config errors
    globalConfig = { servers: {} };
  }

  // Step 2: Load local config if provided
  let localConfig: MCPConfig;
  if (options?.localConfigPath) {
    try {
      localConfig = await readConfigFile(options.localConfigPath);
    } catch (error) {
      // Silently fail on local config errors
      localConfig = { servers: {} };
    }
  } else {
    localConfig = { servers: {} };
  }

  // Step 3: Merge configs
  const mergedConfig = mergeMCPConfigs(globalConfig, localConfig);

  // Step 4: Check if any servers exist
  const serverNames = Object.keys(mergedConfig.servers);
  if (serverNames.length === 0) {
    return [];
  }

  // Step 5: Apply server filter if provided
  let filteredServers = serverNames;
  if (options?.serverFilter) {
    filteredServers = serverNames.filter((name) => options.serverFilter!.includes(name));
  }

  // Step 6: Check if any servers remain after filtering
  if (filteredServers.length === 0) {
    return [];
  }

  // Step 7: Create mcporter runtime
  const serverDefs: Record<string, MCPServerDef> = {};
  for (const name of filteredServers) {
    serverDefs[name] = mergedConfig.servers[name]!;
  }

  let runtime;
  try {
    runtime = await createRuntime({ servers: serverDefs });
  } catch (error) {
    // Warn and return empty on runtime creation failure
    console.warn(
      `Failed to create MCP runtime: ${error instanceof Error ? error.message : String(error)}`
    );
    return [];
  }

  try {
    // Step 8: Load tools from each server
    for (const serverName of filteredServers) {
      try {
        const mcpTools = await runtime.listTools(serverName);

        // Step 9: Convert each tool to colts Tool
        for (const mcpTool of mcpTools) {
          const tool = createMCPTool(
            serverName,
            mcpTool.name,
            mcpTool.description || `MCP tool ${mcpTool.name} from ${serverName}`,
            mcpTool.inputSchema,
            async (srv, tool, args) => {
              try {
                const result = await runtime.callTool(srv, tool, { args });
                // Extract text/content from result
                if (typeof result === 'string') {
                  return result;
                }
                if (result && typeof result === 'object') {
                  // Check for common result properties
                  const res = result as Record<string, unknown>;
                  if (typeof res.text === 'string') {
                    return res.text;
                  }
                  if (typeof res.content === 'string') {
                    return res.content;
                  }
                  if (Array.isArray(res.content)) {
                    // Handle content array (common in MCP)
                    return JSON.stringify(res.content);
                  }
                  // Return JSON string of entire result
                  return JSON.stringify(res);
                }
                return String(result);
              } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                return `Error calling MCP tool ${srv}__${tool}: ${message}`;
              }
            }
          );
          tools.push(tool);
        }
      } catch (error) {
        // Warn and continue on per-server errors
        console.warn(
          `Failed to list tools from MCP server ${serverName}: ${error instanceof Error ? error.message : String(error)}`
        );
        continue;
      }
    }
  } finally {
    // Step 10: Close runtime
    try {
      await runtime.close();
    } catch (error) {
      // Silently fail on close errors
      console.warn(
        `Failed to close MCP runtime: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  // Step 11: Return tools
  return tools;
}
