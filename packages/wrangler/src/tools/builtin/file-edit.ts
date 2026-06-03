import type { Tool } from '@agentskillmania/colts';
import { z } from 'zod';
import type { ZodTypeAny } from 'zod';

import type { ToolDeps } from './workspace-deps.js';

const FileEditSchema = z.object({
  filePath: z.string().describe('Path to the file to edit, relative to workspace'),
  oldString: z.string().describe('Exact text to find and replace'),
  newString: z.string().describe('Replacement text'),
  replaceAll: z.boolean().optional().describe('Replace all occurrences (default: false)'),
});

export function createFileEditTool(deps: ToolDeps): Tool<ZodTypeAny> {
  return {
    name: 'file_edit',
    description: 'Edit a file by replacing exact text matches. Preserves line endings.',
    parameters: FileEditSchema,
    async execute(args: z.infer<typeof FileEditSchema>) {
      const result = await deps.editFile(
        args.filePath,
        args.oldString,
        args.newString,
        args.replaceAll
      );
      return `Edited ${args.filePath}: ${result}`;
    },
  };
}
