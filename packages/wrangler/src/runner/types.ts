import type { ZodTypeAny } from 'zod';
import type { ILLMProvider, AskHumanHandler, Tool } from '@agentskillmania/colts';
import type { SearchProvider } from '../tools/builtin/index.js';

export interface EnhancedRunnerOptions {
  llmClient: ILLMProvider;
  model?: string;
  workspacePath?: string;
  extraTools?: Tool<ZodTypeAny>[];
  searchProvider?: SearchProvider;
  sandbox?: boolean;
  mcpConfigPaths?: string[];
  sessionBaseDir?: string;
  skillDirectories?: string[];
  askHumanHandler?: AskHumanHandler;
  thinkingEnabled?: boolean;
}
