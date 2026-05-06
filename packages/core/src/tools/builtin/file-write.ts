import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { z } from 'zod';
import { createTwoFilesPatch } from 'diff';
import type { WranglerToolDef } from '../types.js';
import type { WorkspaceToolDeps } from './workspace-deps.js';
import { resolvePath } from './workspace-deps.js';

const FileWriteSchema = z.object({
  filePath: z.string().describe('Path to write to, relative to workspace'),
  content: z.string().describe('Full file content to write'),
});

export function createFileWriteTool(
  deps: WorkspaceToolDeps
): WranglerToolDef<typeof FileWriteSchema> {
  return {
    name: 'file_write',
    description: 'Write content to a file. Creates parent directories if needed.',
    parameters: FileWriteSchema,
    async execute(args) {
      const absolutePath = resolvePath(deps, args.filePath);
      const oldContent = await readFile(absolutePath, 'utf8').catch(() => '');
      await mkdir(dirname(absolutePath), { recursive: true });
      await writeFile(absolutePath, args.content, 'utf8');

      const lineCount = args.content === '' ? 0 : args.content.split('\n').length;
      const diff = createTwoFilesPatch(args.filePath, args.filePath, oldContent, args.content);

      const additions = diff
        .split('\n')
        .filter((l) => l.startsWith('+') && !l.startsWith('+++')).length;
      const deletions = diff
        .split('\n')
        .filter((l) => l.startsWith('-') && !l.startsWith('---')).length;

      return {
        output: `File written: ${args.filePath} (${lineCount} line${lineCount !== 1 ? 's' : ''})`,
        metadata: { path: args.filePath, diff, additions, deletions },
      };
    },
  };
}
