import { stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { z } from 'zod';
import type { Tool } from '@agentskillmania/colts';
import type { ZodTypeAny } from 'zod';
import type { ToolDeps } from './workspace-deps.js';
import { isBinaryFile, truncateOutput } from './workspace-deps.js';

const MAX_LINE_LENGTH = 2000;
const MAX_OUTPUT_BYTES = 50 * 1024; // 50KB
const DEFAULT_LIMIT = 2000;

const FileReadSchema = z.object({
  filePath: z.string().describe('Path to the file to read, relative to workspace'),
  offset: z.number().min(1).optional().describe('Line number to start reading from (1-based)'),
  limit: z.number().min(1).optional().describe('Maximum number of lines to read'),
});

export function createFileReadTool(deps: ToolDeps): Tool<ZodTypeAny> {
  return {
    name: 'file_read',
    description: 'Read file contents with line numbers. Supports offset/limit for pagination.',
    parameters: FileReadSchema,
    async execute(args: z.infer<typeof FileReadSchema>) {
      const absolutePath = deps.resolvePath(args.filePath);

      const fileStat = await stat(absolutePath).catch(() => null);
      if (!fileStat?.isFile()) {
        return `Error: File not found: ${args.filePath}`;
      }

      if (await isBinaryFile(absolutePath)) {
        return `Error: Cannot read binary file: ${args.filePath}`;
      }

      const offset = args.offset ?? 1;
      const limit = args.limit ?? DEFAULT_LIMIT;
      const lines: string[] = [];
      let totalLines = 0;

      const rl = createInterface({ input: createReadStream(absolutePath, { encoding: 'utf8' }) });
      try {
        for await (const line of rl) {
          totalLines++;
          if (totalLines < offset) continue;
          if (lines.length >= limit) continue;
          const display =
            line.length > MAX_LINE_LENGTH ? line.slice(0, MAX_LINE_LENGTH) + '...' : line;
          lines.push(`${totalLines}:${display}`);
        }
      } finally {
        rl.close();
      }

      let output = lines.join('\n');
      if (lines.length > 0) {
        output += `\n\nTotal lines: ${totalLines}`;
        if (totalLines > offset + limit - 1) {
          output += `\nUse offset=${offset + limit} to continue reading`;
        }
      } else if (offset > 1 && totalLines > 0) {
        output = `Error: offset ${offset} exceeds file length (${totalLines} lines)`;
      } else {
        output = `Total lines: ${totalLines}`;
      }

      const { content } = truncateOutput(output, MAX_OUTPUT_BYTES);
      return content;
    },
  };
}
