import { z } from 'zod';
import fg from 'fast-glob';
import type { Tool } from '@agentskillmania/colts';
import type { ZodTypeAny } from 'zod';
import type { WorkspaceToolDeps } from './workspace-deps.js';
import { resolvePath } from './workspace-deps.js';

const MAX_RESULTS = 100;

const GlobSchema = z.object({
  pattern: z.string().describe('Glob pattern to match files (e.g. "**/*.ts")'),
  path: z.string().optional().describe('Subdirectory to search in, relative to workspace'),
});

export function createGlobTool(deps: WorkspaceToolDeps): Tool<ZodTypeAny> {
  return {
    name: 'glob',
    description: 'Search for files by name pattern using glob syntax.',
    parameters: GlobSchema,
    async execute(args: z.infer<typeof GlobSchema>) {
      const cwd = args.path ? resolvePath(deps, args.path) : deps.workspacePath;
      const entries = await fg(args.pattern, {
        cwd,
        stats: true,
        onlyFiles: true,
        dot: false,
      });
      entries.sort((a, b) => (b.stats?.mtimeMs ?? 0) - (a.stats?.mtimeMs ?? 0));
      const truncated = entries.length > MAX_RESULTS;
      const files = entries.slice(0, MAX_RESULTS).map((e) => e.path);
      const total = entries.length;

      let output: string;
      if (files.length === 0) {
        output = `No files found matching "${args.pattern}"`;
      } else {
        output = files.join('\n');
        if (truncated) {
          output += `\n... and ${total - MAX_RESULTS} more files (showing first ${MAX_RESULTS})`;
        }
        output += `\n\nTotal: ${total} files`;
      }

      return output;
    },
  };
}
