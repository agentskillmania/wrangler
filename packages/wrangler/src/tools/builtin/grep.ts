import { z } from 'zod';
import type { Tool } from '@agentskillmania/colts';
import type { ZodTypeAny } from 'zod';
import type { ToolDeps } from './workspace-deps.js';

const MAX_RESULTS = 100;
const MAX_LINE_LENGTH = 2000;

const GrepSchema = z.object({
  pattern: z.string().describe('Regex pattern to search for in file contents'),
  path: z.string().optional().describe('Subdirectory to search in, relative to workspace'),
  include: z
    .string()
    .optional()
    .describe('File glob pattern to filter (e.g. "*.ts", "*.{ts,tsx}")'),
});

export function createGrepTool(deps: ToolDeps): Tool<ZodTypeAny> {
  return {
    name: 'grep',
    description: 'Search file contents by regex pattern.',
    parameters: GrepSchema,
    async execute(args: z.infer<typeof GrepSchema>) {
      // Validate regex pattern
      try {
        new RegExp(args.pattern);
      } catch (e) {
        return `Error: Invalid regex pattern: ${(e as Error).message}`;
      }

      // Resolve and validate the search path
      let searchPath: string;
      if (args.path) {
        // Validate the path by resolving it (this will throw on traversal)
        try {
          deps.resolvePath(args.path);
          searchPath = args.path;
        } catch (error) {
          const err = error as Error;
          if (err.message.includes('Path traversal detected')) {
            throw err;
          }
          return `Error: Invalid path: ${err.message}`;
        }
      } else {
        searchPath = '.';
      }

      // Use ToolDeps.grep for the actual search
      const result = await deps.grep(args.pattern, searchPath, {
        include: args.include,
        cwd: deps.workspaceRoot,
      });

      // Format the output
      // ToolDeps.grep returns ripgrep output in format: "file:line:content"
      if (result.trim() === '' || result.includes('No matches found')) {
        return `No matches found for "${args.pattern}"`;
      }

      // Parse and format the ripgrep output
      const matches: Array<{ path: string; line: number; text: string }> = [];
      for (const line of result.split('\n')) {
        if (!line.trim()) continue;

        // Parse ripgrep output format: "file:line:content"
        const colonIndex1 = line.indexOf(':');
        if (colonIndex1 === -1) continue;

        const colonIndex2 = line.indexOf(':', colonIndex1 + 1);
        if (colonIndex2 === -1) continue;

        const path = line.slice(0, colonIndex1);
        const lineNum = parseInt(line.slice(colonIndex1 + 1, colonIndex2), 10);
        let text = line.slice(colonIndex2 + 1);

        // Truncate long lines
        if (text.length > MAX_LINE_LENGTH) {
          text = text.slice(0, MAX_LINE_LENGTH) + '...';
        }

        matches.push({ path, line: lineNum, text: text.trimEnd() });

        if (matches.length >= MAX_RESULTS) break;
      }

      if (matches.length === 0) {
        return `No matches found for "${args.pattern}"`;
      }

      // Group by file and convert absolute paths to relative
      const grouped = new Map<string, Array<{ line: number; text: string }>>();
      for (const m of matches) {
        // Convert absolute path to relative for cleaner output
        let relativePath = m.path;
        if (m.path.startsWith(deps.workspaceRoot)) {
          relativePath = m.path.slice(deps.workspaceRoot.length + 1).replace(/\\/g, '/');
        }

        if (!grouped.has(relativePath)) grouped.set(relativePath, []);
        grouped.get(relativePath)!.push({ line: m.line, text: m.text });
      }

      return Array.from(grouped.entries())
        .map(([file, ms]) => `${file}:\n${ms.map((m) => `  Line ${m.line}: ${m.text}`).join('\n')}`)
        .join('\n\n');
    },
  };
}
