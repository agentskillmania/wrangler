/**
 * MCP → SearchProvider adapter for demos.
 *
 * Loads MCP tools from config, finds the search tool,
 * wraps it as a SearchProvider for createBuiltinTools().
 */

import { writeFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadMCPTools } from '@agentskillmania/wrangler';
import type { SearchProvider, SearchResult } from '@agentskillmania/wrangler';
import type { Tool, ZodTypeAny } from '@agentskillmania/colts';

export interface MCPSearchProviderOptions {
  /** API key for the MCP server (e.g. Zhipu API key) */
  apiKey: string;
  /** Server name in config (default: "search") */
  serverName?: string;
}

/**
 * Write a temp mcporter config and return its path.
 * File is in OS tmpdir — never committed to git.
 */
async function writeTempConfig(serverName: string, serverUrl: string): Promise<string> {
  const config = {
    imports: [] as string[],
    mcpServers: {
      [serverName]: { url: serverUrl },
    },
  };
  const tmpPath = join(tmpdir(), `wrangler-mcp-search-${Date.now()}.json`);
  await writeFile(tmpPath, JSON.stringify(config, null, 2));
  return tmpPath;
}

function findSearchTool(
  tools: Tool<ZodTypeAny>[],
  serverName: string
): Tool<ZodTypeAny> | undefined {
  // Prefer tools from the target server, fallback to any tool with "search" in name
  return (
    tools.find(
      (t) => t.name.startsWith(`${serverName}__`) && t.name.toLowerCase().includes('search')
    ) ?? tools.find((t) => t.name.toLowerCase().includes('search'))
  );
}

function parseSearchResults(raw: string): SearchResult[] {
  try {
    let parsed: unknown = JSON.parse(raw);
    // Handle double-encoded JSON (MCP tool returns stringified JSON string)
    if (typeof parsed === 'string') {
      parsed = JSON.parse(parsed);
    }
    if (Array.isArray(parsed)) {
      return parsed.map((item: Record<string, unknown>) => ({
        title: String(item.title ?? ''),
        url: String(item.url ?? item.link ?? ''),
        snippet: String(item.snippet ?? item.content ?? ''),
      }));
    }
  } catch {
    // not JSON
  }
  return [{ title: 'Search result', url: '', snippet: raw }];
}

/**
 * Create a SearchProvider backed by an MCP search server.
 *
 * @param options.serverUrl - Full MCP server URL with auth resolved
 * @param options.serverName - Name for the server in config (default: "search")
 * @returns SearchProvider for use with createBuiltinTools()
 */
export async function createMCPSearchProvider(
  options: MCPSearchProviderOptions
): Promise<{ provider: SearchProvider; cleanup: () => Promise<void> }> {
  const serverName = options.serverName ?? 'search';
  const serverUrl = `https://open.bigmodel.cn/api/mcp-broker/proxy/web-search/mcp?Authorization=${options.apiKey}`;
  const configPath = await writeTempConfig(serverName, serverUrl);

  const tools = await loadMCPTools({ configPaths: [configPath] });
  const tool = findSearchTool(tools, serverName);

  if (!tool) {
    const names = tools.map((t) => t.name).join(', ') || '(none)';
    await unlink(configPath).catch(() => {});
    throw new Error(`No search tool found. Available: ${names}`);
  }

  return {
    provider: {
      async search(query: string): Promise<SearchResult[]> {
        // Zhipu MCP expects "search_query"; passthrough schema accepts any key
        const result = await tool.execute({ search_query: query });
        return parseSearchResults(String(result));
      },
    },
    cleanup: () => unlink(configPath).catch(() => {}),
  };
}
