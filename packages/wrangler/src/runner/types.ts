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
import type { SubAgentRunnerFactory } from '../subagent/delegate-tool.js';
import type { SubAgentConfig } from '../subagent/types.js';
import type { SearchProvider } from '../tools/builtin/index.js';
import type { SessionSource } from '../types.js';

// ---- Tool & Skill metadata for diagnostics ----

/** Tool type classification — where the tool came from. */
export type ToolType = 'builtin' | 'mcp' | 'session' | 'todolist' | 'a2ui' | 'skill' | 'extra';

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

// ── Builtin tool filter ──────────────────────────────────────────

export interface BuiltinToolFilter {
  calculate?: boolean;
  askHuman?: boolean;
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
}

// ── Structured config groups ─────────────────────────────────────

export interface LLMConfig {
  /** LLM provider instance (injection mode) */
  client?: ILLMProvider;
  /** LLM quick initialization config (multi-provider, one apiKey per provider) */
  quickInit?: LLMQuickInit;
  /** Model identifier */
  model?: string;
  /** Sampling temperature (passed through to LLM provider) */
  temperature?: number;
  /** Request timeout in ms */
  requestTimeout?: number;
}

export interface SkillsConfig {
  /** Skill directories to scan for SKILL.md files */
  dirs?: string[];
}

export interface ToolsConfig {
  /** Builtin tool whitelist. Omit to load all; pass to filter. */
  builtinFilter?: BuiltinToolFilter;
  /** MCP config file paths */
  mcpConfigPaths?: string[];
  /** Extra custom tools */
  extra?: Tool<ZodTypeAny>[];
  /** AskHuman handler for human-in-the-loop */
  askHumanHandler?: AskHumanHandler;
  /** Confirm handler for tool confirmation */
  confirmHandler?: ConfirmHandler;
  /** Tool names that require confirmation */
  confirmTools?: string[];
}

/** Command/network security policy (mirrors `@agentskillmania/sandbox`) */
export interface PolicyConfig {
  /** whitelist = only allow these, blacklist = block these */
  mode: 'whitelist' | 'blacklist';
  /** Items to apply the mode to (commands or domains) */
  list: string[];
}

export interface SandboxConfig {
  /** Enable WASM sandbox (default: true) */
  enabled?: boolean;
  /** Execution timeout in ms (sandbox default: 600_000) */
  timeout?: number;
  /** Allow network access (default: false) */
  allowNetwork?: boolean;
  /** Command security policy */
  commandPolicy?: PolicyConfig;
  /** Network security policy */
  networkPolicy?: PolicyConfig;
}

export interface ThinkingConfig {
  /** Enable thinking/reasoning mode */
  enabled?: boolean;
  /** Add thinking guidance to system prompt */
  promptLevel?: boolean;
}

export interface SessionConfig {
  /** Enable session persistence (default: true) */
  enabled?: boolean;
  /** Session storage root directory (standard mode) */
  baseDir?: string;
  /** Pin the session to this exact directory (dir-bound mode). When set,
   *  state.json + meta.yaml live directly in this directory — no session ID
   *  subdirectory is created. Used when the session directory is owned by
   *  an external system (e.g. gmemo's per-note directory). */
  sessionDir?: string;
}

export interface DelegationConfig {
  /** Sub-agent configs — enables the 'delegate' tool */
  subAgents?: SubAgentConfig[];
  /** Custom sub-agent runner factory */
  runnerFactory?: SubAgentRunnerFactory;
}

export interface SearchConfig {
  /** Search provider instance or name. Defaults to 'sogou'. */
  provider?: SearchProvider | 'bing' | 'sogou';
}

export interface LimitsConfig {
  /** Max characters per user message. Default 100000. */
  maxInputLength?: number;
  /** Max agent execution steps. Default 500. */
  maxSteps?: number;
  /** LLM request timeout in ms. Default 1800000 (30 min). */
  requestTimeout?: number;
  /** Tool output truncation in characters. Default 100000. */
  maxToolOutput?: number;
  /** Shell/python execution timeout in ms. Default 600000 (10 min). */
  toolTimeout?: number;
}

// ── Main options interface ───────────────────────────────────────

export interface EnhancedRunnerOptions {
  // ── Core ──
  workspacePath?: string;

  // ── Structured groups ──
  llm?: LLMConfig;
  skills?: SkillsConfig;
  tools?: ToolsConfig;
  /** Sandbox execution config. */
  sandbox?: SandboxConfig;
  thinking?: ThinkingConfig;
  session?: SessionConfig;
  delegation?: DelegationConfig;
  search?: SearchConfig;
  limits?: LimitsConfig;

  /** Todolist support (default: enabled) */
  todolist?: { enabled?: boolean };
  /** Spec-plan tools (default: enabled) */
  specPlan?: { enabled?: boolean };
  /** Command middleware (default: enabled) */
  commands?: { enabled?: boolean; extra?: CommandHandler[] };
  /** A2UI support */
  a2ui?: { enabled?: boolean };

  /** Context compression config. Omit = default enabled; false = disabled. */
  compression?: CompressionConfig | IContextCompressor | false;

  /** Session metadata */
  source?: SessionSource;
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
  /** Max user input length in characters. Undefined = no limit. */
  maxInputLength?: number;
}

/**
 * Options for EnhancedRunner.resume() — from session directory.
 */
export interface ResumeOptions {
  /** LLM config: provider injection (client) or quick-init (quickInit). */
  llm?: LLMConfig;
  /** Optional model override */
  model?: string;
  /** Optional thinking mode override */
  thinkingEnabled?: boolean;
  /** AskHuman handler for human-in-the-loop */
  askHumanHandler?: AskHumanHandler;
  /** Sub-agent configs to rebuild crew delegation on resume */
  subAgents?: SubAgentConfig[];
}
