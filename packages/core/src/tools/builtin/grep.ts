import { z } from 'zod';
import { ripgrep } from 'ripgrep';
import type { WranglerToolDef } from '../types.js';
import type { WorkspaceToolDeps } from './workspace-deps.js';
import { resolvePath } from './workspace-deps.js';

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

export function createGrepTool(deps: WorkspaceToolDeps): WranglerToolDef<typeof GrepSchema> {
  return {
    name: 'grep',
    description: 'Search file contents by regex pattern.',
    parameters: GrepSchema,
    async execute(args) {
      try {
        new RegExp(args.pattern);
      } catch (e) {
        return { output: `Error: Invalid regex pattern: ${(e as Error).message}` };
      }

      const cwd = args.path ? resolvePath(deps, args.path) : deps.workspacePath;
      const rgArgs = ['--json', '--max-count', String(MAX_RESULTS), '--regexp', args.pattern];
      if (args.include) {
        rgArgs.push('--glob', args.include);
      }
      rgArgs.push(cwd);

      let stdout: string;
      try {
        const result = await ripgrep(rgArgs, { buffer: true });
        stdout = result.stdout ?? '';
      } catch (e) {
        return { output: `Error: Search failed: ${(e as Error).message}` };
      }

      const matches: Array<{ path: string; line: number; text: string }> = [];
      for (const line of stdout.split('\n')) {
        if (!line.trim()) continue;
        try {
          const obj = JSON.parse(line);
          if (obj.type === 'match') {
            const text = obj.data.lines.text;
            matches.push({
              path: obj.data.path.text,
              line: obj.data.line_number,
              text:
                text.length > MAX_LINE_LENGTH
                  ? text.slice(0, MAX_LINE_LENGTH) + '...'
                  : text.trimEnd(),
            });
            if (matches.length >= MAX_RESULTS) break;
          }
        } catch {
          // skip unparseable lines
        }
      }

      const truncated = matches.length >= MAX_RESULTS;

      let output: string;
      if (matches.length === 0) {
        output = `No matches found for "${args.pattern}"`;
      } else {
        const grouped = new Map<string, Array<{ line: number; text: string }>>();
        for (const m of matches) {
          if (!grouped.has(m.path)) grouped.set(m.path, []);
          grouped.get(m.path)!.push({ line: m.line, text: m.text });
        }
        output = Array.from(grouped.entries())
          .map(
            ([file, ms]) => `${file}:\n${ms.map((m) => `  Line ${m.line}: ${m.text}`).join('\n')}`
          )
          .join('\n\n');
      }

      return {
        output,
        metadata: { pattern: args.pattern, matches, total: matches.length, truncated },
      };
    },
  };
}
