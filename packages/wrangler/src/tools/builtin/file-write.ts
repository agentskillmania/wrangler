import { writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { z } from 'zod';
import type { Tool } from '@agentskillmania/colts';
import type { ZodTypeAny } from 'zod';
import type { WorkspaceToolDeps } from './workspace-deps.js';
import { resolvePath } from './workspace-deps.js';

const FileWriteSchema = z.object({
  filePath: z.string().describe('Path to write to, relative to workspace'),
  content: z.string().describe('Full file content to write'),
});

export function createFileWriteTool(deps: WorkspaceToolDeps): Tool<ZodTypeAny> {
  return {
    name: 'file_write',
    description: 'Write content to a file. Creates parent directories if needed.',
    parameters: FileWriteSchema,
    async execute(args: z.infer<typeof FileWriteSchema>) {
      const absolutePath = resolvePath(deps, args.filePath);
      await mkdir(dirname(absolutePath), { recursive: true });
      await writeFile(absolutePath, args.content, 'utf8');

      const lineCount = args.content === '' ? 0 : args.content.split('\n').length;
      return `File written: ${args.filePath} (${lineCount} line${lineCount !== 1 ? 's' : ''})`;
    },
  };
}
