import type {
  ILLMProvider,
  AskHumanHandler,
  ConfirmHandler,
  Tool,
  CompressionConfig,
  IContextCompressor,
} from '@agentskillmania/colts';
import type { ZodTypeAny } from 'zod';

import type { CommandHandler } from '../command/types.js';
import type { SearchProvider } from '../tools/builtin/index.js';

export interface A2UIConfig {
  /** Enable A2UI support */
  enabled: boolean;
}

export interface EnhancedRunnerOptions {
  llmClient: ILLMProvider;
  model?: string;
  workspacePath?: string;
  extraTools?: Tool<ZodTypeAny>[];
  /** Search provider instance or name. Defaults to 'sogou'. */
  searchProvider?: SearchProvider | 'bing' | 'sogou';
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
  /** Whether to enable session support (default: true) */
  enableSession?: boolean;
  /** Whether to enable todolist support (default: true) */
  enableTodolist?: boolean;
  /** Whether to enable command middleware (default: true) */
  enableCommands?: boolean;
}

/**
 * Resolved runner config — a frozen snapshot built at create() time.
 * Single source of truth for all consumers (daemon, playground).
 */
export interface ResolvedRunnerConfig {
  /** LLM model identifier */
  model: string;
  /** Whether sandbox mode is active */
  sandbox: boolean;
  /** Whether session support is active */
  enableSession: boolean;
  /** Whether todolist support is active */
  enableTodolist: boolean;
  /** Whether command middleware is active */
  enableCommands: boolean;
  /** Whether thinking/reasoning mode is enabled */
  thinkingEnabled: boolean;
  /** Whether prompt-level thinking guidance is enabled */
  enablePromptThinking: boolean;
  /** A2UI config if enabled */
  a2ui: { enabled: boolean } | undefined;
  /** Builtin tool toggle map (undefined = all enabled) */
  builtinTools: Record<string, boolean> | undefined;
  /** Resolved skill directories (includes auto-appended built-in dirs) */
  skillDirs: string[];
  /** MCP config paths */
  mcpConfigPaths: string[];
  /** Number of builtin tools after filtering */
  builtinToolCount: number;
  /** Number of MCP tools loaded */
  mcpToolCount: number;
  /** Number of session tools */
  sessionToolCount: number;
  /** Number of todolist tools */
  todolistToolCount: number;
  /** Names of all active middleware */
  middlewareNames: string[];
  /** Whether context compression is configured */
  compressorEnabled: boolean;
  /** Context window size for the model (from llm-client ModelMeta). Undefined if unknown. */
  contextWindow?: number;
}
