import type { Tool } from '@agentskillmania/colts';
import { z } from 'zod';
import type { ZodTypeAny } from 'zod';

import type { ToolDeps } from './workspace-deps.js';

const FileWriteSchema = z.object({
  filePath: z.string().describe('Path to write to, relative to workspace'),
  content: z.string().describe('Full file content to write'),
});

export function createFileWriteTool(deps: ToolDeps): Tool<ZodTypeAny> {
  return {
    name: 'file_write',
    description: 'Write content to a file. Creates parent directories if needed.',
    parameters: FileWriteSchema,
    async execute(args: z.infer<typeof FileWriteSchema>) {
      await deps.writeFile(args.filePath, args.content);
      const lineCount = args.content === '' ? 0 : args.content.split('\n').length;
      return `File written: ${args.filePath} (${lineCount} line${lineCount !== 1 ? 's' : ''})`;
    },
  };
}
