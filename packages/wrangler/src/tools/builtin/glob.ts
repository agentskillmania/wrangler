import { z } from 'zod';
import type { Tool } from '@agentskillmania/colts';
import type { ZodTypeAny } from 'zod';
import type { ToolDeps } from './workspace-deps.js';

const MAX_RESULTS = 100;

const GlobSchema = z.object({
  pattern: z.string().describe('Glob pattern to match files (e.g. "**/*.ts")'),
  path: z.string().optional().describe('Subdirectory to search in, relative to workspace'),
});

export function createGlobTool(deps: ToolDeps): Tool<ZodTypeAny> {
  return {
    name: 'glob',
    description: 'Search for files by name pattern using glob syntax.',
    parameters: GlobSchema,
    async execute(args: z.infer<typeof GlobSchema>) {
      let cwd: string;
      if (args.path) {
        // Resolve the subdirectory path and use it as cwd
        cwd = deps.resolvePath(args.path);
      } else {
        // Use workspace root
        cwd = deps.workspaceRoot;
      }

      const files = await deps.glob(args.pattern, { cwd });

      // Sort by modification time (note: HostToolDeps.glob returns unsorted results)
      // For now, we'll use the files as-is since sorting would require stat calls
      const truncated = files.length > MAX_RESULTS;
      const displayedFiles = files.slice(0, MAX_RESULTS);
      const total = files.length;

      let output: string;
      if (displayedFiles.length === 0) {
        output = `No files found matching "${args.pattern}"`;
      } else {
        // Convert absolute paths to relative for cleaner output
        const relativeFiles = displayedFiles.map((f) => {
          try {
            // Get the relative path from workspace root
            const workspaceRoot = deps.workspaceRoot;
            if (f.startsWith(workspaceRoot)) {
              return f.slice(workspaceRoot.length + 1).replace(/\\/g, '/');
            }
            return f;
          } catch {
            return f;
          }
        });

        output = relativeFiles.join('\n');
        if (truncated) {
          output += `\n... and ${total - MAX_RESULTS} more files (showing first ${MAX_RESULTS})`;
        }
        output += `\n\nTotal: ${total} files`;
      }

      return output;
    },
  };
}
