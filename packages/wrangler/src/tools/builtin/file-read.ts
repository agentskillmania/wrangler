import type { Tool } from '@agentskillmania/colts';
import { z } from 'zod';
import type { ZodTypeAny } from 'zod';

import type { ToolDeps } from './workspace-deps.js';
import { truncateOutput } from './workspace-deps.js';

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
      // Validate path stays within workspace (resolvePath throws on traversal)
      deps.resolvePath(args.filePath);

      // Check file existence and type via deps (no direct Node.js stat)
      const { exists, isFile } = await deps.statFile(args.filePath);
      if (!exists) {
        throw new Error(`File not found: ${args.filePath}`);
      }
      if (!isFile) {
        return `Error: Not a file: ${args.filePath}`;
      }

      // Check binary via deps (no direct Node.js isbinaryfile)
      if (await deps.isBinaryFile(args.filePath)) {
        return `Error: Cannot read binary file: ${args.filePath}`;
      }

      // Read content via deps (no direct Node.js createReadStream)
      const content = await deps.readFile(args.filePath);

      const offset = args.offset ?? 1;
      const limit = args.limit ?? DEFAULT_LIMIT;

      // Split content into lines and apply offset/limit/line-numbering in JS
      const allLines = content.split('\n');
      // Remove trailing empty line from trailing newline
      if (allLines.length > 0 && allLines[allLines.length - 1] === '') {
        allLines.pop();
      }
      const totalLines = allLines.length;

      const lines: string[] = [];
      for (let i = offset - 1; i < allLines.length && lines.length < limit; i++) {
        const line = allLines[i];
        const display =
          line.length > MAX_LINE_LENGTH ? line.slice(0, MAX_LINE_LENGTH) + '...' : line;
        lines.push(`${i + 1}:${display}`);
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

      const { content: finalContent } = truncateOutput(output, MAX_OUTPUT_BYTES);
      return finalContent;
    },
  };
}
