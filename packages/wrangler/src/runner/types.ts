import type {
  ILLMProvider,
  AskHumanHandler,
  ConfirmHandler,
  Tool,
  CompressionConfig,
  IContextCompressor,
  LLMQuickInit,
} from '@agentskillmania/colts';
import type { ZodTypeAny } from 'zod';

import type { CommandHandler } from '../command/types.js';
import type { SearchProvider } from '../tools/builtin/index.js';
import type { SessionSource } from '../types.js';
import type { SubAgentConfig } from '../subagent/types.js';
import type { SubAgentRunnerFactory } from '../subagent/delegate-tool.js';

// ---- Tool & Skill metadata for diagnostics ----

/** Tool type classification — where the tool came from. */
export type ToolType = 'builtin' | 'mcp' | 'session' | 'todolist' | 'a2ui' | 'extra';

/** Extended tool info for diagnostics, including type and enabled state. */
export interface ToolMetadata {
  name: string;
  description: string;
  type: ToolType;
  enabled: boolean;
}

/** Extended skill info for diagnostics, including source path. */
export interface SkillMetadata {
  name: string;
  description: string;
  source: string;
}

export interface A2UIConfig {
  /** Enable A2UI support */
  enabled: boolean;
}

export interface EnhancedRunnerOptions {
  /** LLM provider instance (injection mode) */
  llmClient?: ILLMProvider;
  /** LLM quick initialization config (multi-provider, one apiKey per provider) */
  llm?: LLMQuickInit;
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
  /** Sampling temperature (passed through to LLM provider) */
  temperature?: number;
  /** Sub-agent configs — enables the 'delegate' tool for task delegation */
  subAgents?: SubAgentConfig[];
  /**
   * Custom sub-agent runner factory. Defaults to the built-in
   * `createSubAgentRunner` (buildTimeContext + MarkdownMessageAssembler +
   * todolist + tool/skill inheritance). Inject a custom factory to override
   * sub-agent runner construction (add middleware, swap assembler, pool
   * runners, etc.). Only effective when `subAgents` is non-empty.
   */
  subAgentRunnerFactory?: SubAgentRunnerFactory;
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
  /** Whether to enable spec-plan tools (default: true) */
  enableSpecPlan?: boolean;
  /** Whether to enable command middleware (default: true) */
  enableCommands?: boolean;
  /** Source of session creation — automatically set by AgentLoader when loading from agent directory */
  source?: SessionSource;
  /** Crew identifier — persisted into runnerConfig snapshot so resume can reload crew config */
  crewId?: string;
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
  /** Whether spec-plan tools are active */
  enableSpecPlan: boolean;
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
  /** Number of todolist tools */
  todolistToolCount: number;
  /** Number of spec-plan tools */
  specPlanToolCount: number;
  /** Names of all active middleware */
  middlewareNames: string[];
  /** Whether context compression is configured */
  compressorEnabled: boolean;
  /** Context window size for the model (from llm-client ModelMeta). Undefined if unknown. */
  contextWindow?: number;
}

/**
 * Options for EnhancedRunner.resume() — from session directory.
 */
export interface ResumeOptions {
  /** LLM provider instance (injection mode) */
  llmClient?: ILLMProvider;
  /** LLM quick initialization config (multi-provider, one apiKey per provider) */
  llm?: LLMQuickInit;
  /** Optional model override */
  model?: string;
  /** Optional thinking mode override */
  thinkingEnabled?: boolean;
  /** AskHuman handler for human-in-the-loop */
  askHumanHandler?: AskHumanHandler;
  /** Sub-agent configs to rebuild crew delegation on resume */
  subAgents?: SubAgentConfig[];
}
