import type { ZodTypeAny } from 'zod';
import type { Tool } from '@agentskillmania/colts';

export interface MCPLoaderOptions {
  configPath?: string;
}

export async function loadMCPTools(_options?: MCPLoaderOptions): Promise<Tool<ZodTypeAny>[]> {
  // MCP integration not yet implemented
  return [];
}
