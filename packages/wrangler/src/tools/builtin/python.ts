import { z } from 'zod';
import type { Tool } from '@agentskillmania/colts';
import type { ZodTypeAny } from 'zod';
import type { ToolDeps } from './workspace-deps.js';

const PythonSchema = z.object({
  code: z.string().optional().describe('Python code to execute'),
  file: z.string().optional().describe('Python script file path to execute'),
});

export function createPythonTool(deps: ToolDeps): Tool<ZodTypeAny> {
  return {
    name: 'python',
    description: 'Execute Python code. Provide either `code` (inline) or `file` (script path).',
    parameters: PythonSchema,
    async execute(args: z.infer<typeof PythonSchema>) {
      if (!args.code && !args.file) {
        return 'Error: Provide either `code` or `file` parameter.';
      }

      let command: string;
      if (args.file) {
        const filePath = deps.resolvePath(args.file);
        command = `python3 ${filePath}`;
      } else {
        const escapedCode = args.code!.replace(/'/g, "'\\''");
        command = `python3 -c '${escapedCode}'`;
      }

      const result = await deps.exec(command);

      if (result.exitCode === 0) {
        return result.stdout || '(no output)';
      }
      const parts: string[] = [`Exit code: ${result.exitCode}`];
      if (result.stdout) parts.push(`\nSTDOUT:\n${result.stdout}`);
      if (result.stderr) parts.push(`\nSTDERR:\n${result.stderr}`);
      return parts.join('');
    },
  };
}
