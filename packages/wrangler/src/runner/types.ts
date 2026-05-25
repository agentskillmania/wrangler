import type { ZodTypeAny } from 'zod';
import type {
  ILLMProvider,
  AskHumanHandler,
  ConfirmHandler,
  Tool,
  CompressionConfig,
  IContextCompressor,
} from '@agentskillmania/colts';
import type { SearchProvider } from '../tools/builtin/index.js';
import type { CommandHandler } from '../command/types.js';

export interface A2UIConfig {
  /** Enable A2UI support */
  enabled: boolean;
}

export interface EnhancedRunnerOptions {
  llmClient: ILLMProvider;
  model?: string;
  workspacePath?: string;
  extraTools?: Tool<ZodTypeAny>[];
  searchProvider?: SearchProvider;
  sandbox?: boolean;
  mcpConfigPaths?: string[];
  sessionBaseDir?: string;
  skillDirs?: string[];
  askHumanHandler?: AskHumanHandler;
  confirmHandler?: ConfirmHandler;
  confirmTools?: string[];
  thinkingEnabled?: boolean;
  enablePromptThinking?: boolean;
  requestTimeout?: number;
  maxSteps?: number;
  /** Context compression config (passed to AgentRunner and /compact handler) */
  compression?: CompressionConfig | IContextCompressor;
  /** Custom command handlers (override built-in if same name) */
  commands?: CommandHandler[];
  /** A2UI support configuration */
  a2ui?: A2UIConfig;
  /** Builtin tool toggles. Omit to load all; pass empty {} to load none. */
  builtinTools?: {
    fileRead?: boolean;
    fileWrite?: boolean;
    fileEdit?: boolean;
    glob?: boolean;
    grep?: boolean;
    shell?: boolean;
    webSearch?: boolean;
    webFetch?: boolean;
    python?: boolean;
    git?: boolean;
  };
}
