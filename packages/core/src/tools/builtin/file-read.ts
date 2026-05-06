import { stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { z } from 'zod';
import type { WranglerToolDef } from '../types.js';
import type { WorkspaceToolDeps } from './workspace-deps.js';
import { resolvePath, isBinaryFile, truncateOutput } from './workspace-deps.js';

const MAX_LINE_LENGTH = 2000;
const MAX_OUTPUT_BYTES = 50 * 1024; // 50KB
const DEFAULT_LIMIT = 2000;

const FileReadSchema = z.object({
  filePath: z.string().describe('Path to the file to read, relative to workspace'),
  offset: z.number().min(1).optional().describe('Line number to start reading from (1-based)'),
  limit: z.number().min(1).optional().describe('Maximum number of lines to read'),
});

export function createFileReadTool(
  deps: WorkspaceToolDeps
): WranglerToolDef<typeof FileReadSchema> {
  return {
    name: 'file_read',
    description: 'Read file contents with line numbers. Supports offset/limit for pagination.',
    parameters: FileReadSchema,
    async execute(args) {
      const absolutePath = resolvePath(deps, args.filePath);

      const fileStat = await stat(absolutePath).catch(() => null);
      if (!fileStat?.isFile()) {
        return { output: `Error: File not found: ${args.filePath}` };
      }

      if (await isBinaryFile(absolutePath)) {
        return { output: `Error: Cannot read binary file: ${args.filePath}` };
      }

      const offset = args.offset ?? 1;
      const limit = args.limit ?? DEFAULT_LIMIT;
      const lines: string[] = [];
      let totalLines = 0;

      const rl = createInterface({ input: createReadStream(absolutePath, { encoding: 'utf8' }) });
      for await (const line of rl) {
        totalLines++;
        if (totalLines < offset) continue;
        if (lines.length >= limit) continue;
        const display =
          line.length > MAX_LINE_LENGTH ? line.slice(0, MAX_LINE_LENGTH) + '...' : line;
        lines.push(`${totalLines}:${display}`);
      }

      let output = lines.join('\n');
      if (lines.length > 0) {
        output += `\n\nTotal lines: ${totalLines}`;
        if (totalLines > offset + limit - 1) {
          output += `\nUse offset=${offset + limit} to continue reading`;
        }
      } else {
        output = `Total lines: ${totalLines}`;
      }

      const { content, truncated } = truncateOutput(output, MAX_OUTPUT_BYTES);
      return {
        output: content,
        metadata: { path: args.filePath, totalLines, offset, truncated },
      };
    },
  };
}
