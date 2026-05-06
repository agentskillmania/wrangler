import { readFile, writeFile } from 'node:fs/promises';
import { z } from 'zod';
import { createTwoFilesPatch } from 'diff';
import type { WranglerToolDef } from '../types.js';
import type { WorkspaceToolDeps } from './workspace-deps.js';
import { resolvePath } from './workspace-deps.js';

const FileEditSchema = z.object({
  filePath: z.string().describe('Path to the file to edit, relative to workspace'),
  oldString: z.string().describe('Exact text to find and replace'),
  newString: z.string().describe('Replacement text'),
  replaceAll: z.boolean().optional().describe('Replace all occurrences (default: false)'),
});

export function createFileEditTool(
  deps: WorkspaceToolDeps
): WranglerToolDef<typeof FileEditSchema> {
  return {
    name: 'file_edit',
    description: 'Edit a file by replacing exact text matches. Preserves line endings.',
    parameters: FileEditSchema,
    async execute(args) {
      const absolutePath = resolvePath(deps, args.filePath);
      const content = await readFile(absolutePath, 'utf8').catch(() => null);
      if (content === null) {
        return { output: `Error: File not found: ${args.filePath}` };
      }
      if (args.oldString === args.newString) {
        return { output: `Error: No changes: oldString and newString are identical` };
      }

      // Count occurrences
      let count = 0;
      let pos = 0;
      while ((pos = content.indexOf(args.oldString, pos)) !== -1) {
        count++;
        pos += args.oldString.length;
      }
      if (count === 0) {
        return { output: `Error: oldString not found in ${args.filePath}` };
      }
      if (count > 1 && !args.replaceAll) {
        return {
          output: `Error: Found ${count} matches in ${args.filePath}. Set replaceAll to true to replace all.`,
        };
      }

      const newContent = args.replaceAll
        ? content.split(args.oldString).join(args.newString)
        : content.replace(args.oldString, args.newString);

      await writeFile(absolutePath, newContent, 'utf8');

      const diff = createTwoFilesPatch(args.filePath, args.filePath, content, newContent);
      const additions = diff
        .split('\n')
        .filter((l) => l.startsWith('+') && !l.startsWith('+++')).length;
      const deletions = diff
        .split('\n')
        .filter((l) => l.startsWith('-') && !l.startsWith('---')).length;

      return {
        output: `Edited ${args.filePath}: replaced ${args.replaceAll ? count : 1} occurrence(s)`,
        metadata: { path: args.filePath, diff, additions, deletions },
      };
    },
  };
}
