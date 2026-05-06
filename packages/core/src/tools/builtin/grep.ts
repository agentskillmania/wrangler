import { resolve } from 'node:path';
import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { z } from 'zod';
import fg from 'fast-glob';
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
      let regex: RegExp;
      try {
        regex = new RegExp(args.pattern);
      } catch (e) {
        return { output: `Error: Invalid regex pattern: ${(e as Error).message}` };
      }

      const cwd = args.path ? resolvePath(deps, args.path) : deps.workspacePath;
      const files = await fg(args.include ?? '**/*', { cwd, onlyFiles: true, dot: false });
      const matches: Array<{ path: string; line: number; text: string }> = [];

      for (const file of files) {
        if (matches.length >= MAX_RESULTS) break;
        const absPath = resolve(cwd, file);
        const rl = createInterface({ input: createReadStream(absPath, { encoding: 'utf8' }) });
        let lineNum = 0;
        for await (const line of rl) {
          lineNum++;
          if (regex.test(line)) {
            const text =
              line.length > MAX_LINE_LENGTH ? line.slice(0, MAX_LINE_LENGTH) + '...' : line;
            matches.push({ path: file, line: lineNum, text });
            if (matches.length >= MAX_RESULTS) break;
          }
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
