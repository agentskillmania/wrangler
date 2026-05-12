import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';

/**
 * Definition of a single MCP server configuration
 */
export interface MCPServerDef {
  /** Command to execute for starting the MCP server */
  command: string;
  /** Optional arguments to pass to the command */
  args?: string[];
  /** Optional environment variables for the server process */
  env?: Record<string, string>;
}

/**
 * MCP configuration structure matching mcporter format
 */
export interface MCPConfig {
  /** Map of server names to their definitions */
  servers: Record<string, MCPServerDef>;
}

/**
 * Merges global and local MCP configurations
 * Local config takes precedence on server name collision
 *
 * @param globalConfig - Global mcporter config (optional)
 * @param localConfig - Local mcp.json config (optional)
 * @returns Merged configuration with local overrides applied
 */
export function mergeMCPConfigs(
  globalConfig?: MCPConfig,
  localConfig?: MCPConfig,
): MCPConfig {
  const merged: MCPConfig = { servers: {} };

  // Add global servers
  if (globalConfig?.servers) {
    Object.assign(merged.servers, globalConfig.servers);
  }

  // Override with local servers
  if (localConfig?.servers) {
    Object.assign(merged.servers, localConfig.servers);
  }

  return merged;
}

/**
 * Reads and parses a JSON config file
 * Returns empty config if file doesn't exist
 *
 * @param filePath - Absolute path to the config file
 * @returns Parsed config or empty object if file doesn't exist
 * @throws Error if file exists but contains invalid JSON
 */
export async function readConfigFile(filePath: string): Promise<MCPConfig> {
  try {
    const content = await readFile(filePath, 'utf-8');
    return JSON.parse(content) as MCPConfig;
  } catch (error) {
    // If file doesn't exist, return empty config
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { servers: {} };
    }
    // Re-throw other errors (e.g., JSON parse errors)
    throw error;
  }
}

/**
 * Discovers the global mcporter config path
 * Priority: explicitPath > MCPORTER_CONFIG env var > default path
 *
 * @param explicitPath - Explicitly provided config path (optional)
 * @returns Absolute path to the global mcporter config file
 */
export function discoverGlobalConfigPath(explicitPath?: string): string {
  if (explicitPath) {
    return explicitPath;
  }

  const envPath = process.env.MCPORTER_CONFIG;
  if (envPath && envPath.trim() !== '') {
    return envPath;
  }

  // Default path: ~/.mcporter/mcporter.json
  return join(homedir(), '.mcporter', 'mcporter.json');
}
