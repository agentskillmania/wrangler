import type { Tool } from '@agentskillmania/colts';
import { z } from 'zod';
import type { ZodTypeAny } from 'zod';

import type { ToolDeps } from './workspace-deps.js';

const ListDirSchema = z.object({
  path: z
    .string()
    .optional()
    .describe('Subdirectory to list, relative to workspace (default: workspace root)'),
});

/**
 * List the direct children of a directory (mirrors the Rust `list_dir`
 * builtin: `ls -1` semantics, sorted, "(empty directory)" when empty).
 */
export function createListDirTool(deps: ToolDeps): Tool<ZodTypeAny> {
  return {
    name: 'list_dir',
    description: 'List the direct children of a directory.',
    parameters: ListDirSchema,
    async execute(args: z.infer<typeof ListDirSchema>) {
      const rel = args.path?.trim() || '.';
      // Resolve and validate the target directory (mirrors the Rust builtin:
      // missing path or a file → error, otherwise list).
      const target = rel === '.' ? deps.workspaceRoot : deps.resolvePath(rel);
      const stat = await deps.statFile(rel === '.' ? '.' : rel);
      if (!stat.exists) {
        throw new Error(`Path not found: ${rel}`);
      }
      if (stat.isFile) {
        throw new Error(`Not a directory: ${rel}`);
      }

      const result = await deps.execArray('ls', ['-1', target]);
      const listing = (result.stdout || '')
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l.length > 0)
        .sort();
      return listing.length === 0 ? '(empty directory)' : listing.join('\n');
    },
  };
}
