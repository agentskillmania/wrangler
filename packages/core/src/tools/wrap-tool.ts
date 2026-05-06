import type { ZodTypeAny } from 'zod';
import type { Tool } from '@agentskillmania/colts';
import type { WranglerToolDef } from './types.js';

/**
 * Wrap a wrangler internal tool into a colts Tool.
 * Only `output` string is returned to colts, metadata is discarded at this layer.
 */
export function wrapToColtsTool(tool: WranglerToolDef): Tool<ZodTypeAny> {
  return {
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters,
    async execute(args, options) {
      const result = await tool.execute(args, options);
      return result.output;
    },
  };
}
