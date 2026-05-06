import type { z } from 'zod';
import type { Tool } from '@agentskillmania/colts';

/**
 * Wrangler internal tool result.
 * output is returned to the LLM via colts, metadata is preserved for future UI consumption.
 */
export interface WranglerToolResult<T = unknown> {
  output: string;
  metadata?: T;
}

/**
 * Internal wrangler tool definition (before wrapping to colts Tool).
 * Each factory function returns this shape, then wrapToColtsTool converts it.
 */
export interface WranglerToolDef<TParams extends z.ZodTypeAny = z.ZodTypeAny, TMeta = unknown> {
  name: string;
  description: string;
  parameters: TParams;
  execute: (
    args: z.infer<TParams>,
    options?: { signal?: AbortSignal }
  ) => Promise<WranglerToolResult<TMeta>>;
}

// Re-export colts Tool for convenience
export type { Tool };
