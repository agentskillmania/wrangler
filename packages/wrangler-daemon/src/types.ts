import type { LLMQuickInit } from '@agentskillmania/colts';
import type { SandboxConfig } from '@agentskillmania/wrangler';

import type { ConfigManager } from './core/config-manager.js';
import type { ResourceManager } from './core/resource-manager.js';
import type { SessionManager } from './core/session-manager.js';

/** Daemon configuration stored in config.yaml */

/**
 * Daemon-level runner defaults (mirrors Rust `RunnerConfig`).
 * Every field is optional — an absent group keeps the runner's built-in default.
 * Merged with per-request body.config and agent-definition defaults:
 * body > agent > config.runner > built-in.
 */
export interface RunnerConfig {
  thinking?: { enabled?: boolean; promptLevel?: boolean };
  limits?: {
    maxInputLength?: number;
    maxSteps?: number;
    requestTimeout?: number;
    maxToolOutput?: number;
    toolTimeout?: number;
  };
  tools?: { builtinTools?: Record<string, boolean> };
  session?: { enabled?: boolean };
  todolist?: { enabled?: boolean };
  specPlan?: { enabled?: boolean };
  commands?: { enabled?: boolean };
  a2ui?: { enabled?: boolean };
  compression?: { enabled?: boolean; strategy?: string };
  skillDirs?: string[];
  mcpConfigPaths?: string[];
}

export interface DaemonConfig {
  llm: LLMQuickInit;
  server: {
    port: number;
    host: string;
  };
  /** Sandbox execution defaults for all sessions (overridable per request). */
  sandbox?: SandboxConfig;
  /** Daemon-level runner config defaults (merged per-request: body > agent > runner). */
  runner?: RunnerConfig;
  /** Search provider registry (providers with apiKey + defaultProvider). */
  search?: {
    defaultProvider?: string;
    providers?: Array<{ name: string; apiKey: string; baseUrl?: string }>;
  };
  [key: string]: unknown; // Index signature for settings-yaml compatibility
}

/** Default daemon config values */
export const DEFAULT_CONFIG: DaemonConfig = {
  llm: {
    providers: [
      {
        name: 'openai',
        apiKey: '',
        models: [{ modelId: 'deepseek-chat' }],
      },
    ],
  },
  server: {
    port: 3100,
    host: 'localhost',
  },
};

/** Options for creating a Daemon instance */
export interface DaemonOptions {
  port?: number;
  host?: string;
  /** Pre-bound listener for in-process embedding (mirrors Rust's
   * `Daemon::with_listener`). When provided, the daemon serves on this
   * already-listening server instead of self-binding, eliminating the
   * TOCTOU window between port-probe and bind. */
  listener?: import('http').Server;
}

/** Agent resource metadata returned by list API */
export interface AgentInfo {
  id: string;
  name: string;
  description: string;
  path: string;
}

/** Detailed agent info returned by GET /api/agents/:id */
export interface AgentDetail {
  id: string;
  name: string;
  description?: string;
  instructions: string;
  model?: string;
  thinking?: { enabled?: boolean };
  path: string;
  skillDirs: string[];
  mcpPaths: string[];
  skillCount: number;
}

/** Skill resource metadata returned by list API */
export interface SkillInfo {
  id: string;
  name: string;
  description: string;
  path: string;
}

/** Detailed skill info returned by GET /api/skills/:id */
export interface SkillDetail {
  id: string;
  name: string;
  description?: string;
  path: string;
  files: SkillFile[];
}

/** File entry within a skill directory */
export interface SkillFile {
  name: string;
  path: string;
  size: number;
}

/** Options for creating a new agent resource */
export interface CreateAgentOptions {
  name: string;
  instructions: string;
  skills?: string[];
}

/** Options for creating a new skill resource */
export interface CreateSkillOptions {
  name: string;
  description: string;
}

/** Crew resource metadata returned by list API */
export interface CrewInfo {
  id: string;
  name: string;
  description: string;
  path: string;
  agentCount: number;
  skillCount: number;
}

/** Detailed crew info returned by GET /api/crews/:id */
export interface CrewDetail {
  id: string;
  name: string;
  description?: string;
  primaryAgent?: string;
  path: string;
  crewMd: string;
  agents: { name: string; fileName: string }[];
  skills: { name: string; dirName: string }[];
}

export interface CreateCrewOptions {
  name: string;
  description?: string;
  primaryAgent?: string;
  instructions?: string;
}

/** SSE event payload pushed to frontend */
export interface SSEEvent {
  event: string;
  data: unknown;
}

/**
 * Fastify instance decorated with core manager singletons.
 *
 * Routes access managers via this interface instead of `any` casts.
 * The Daemon class calls `fastify.decorate()` during startup.
 */
export interface DecoratedFastifyInstance {
  configManager: ConfigManager;
  resourceManager: ResourceManager;
  sessionManager: SessionManager;
}

/** Per-request parameters — both chat endpoints accept these */
export interface PerRequestParams {
  message: string;
  thinkingEnabled?: boolean;
  model?: string;
}

/** Session-init parameters — only create endpoint accepts these */
export interface SessionInitParams {
  workspacePath: string;
  /**
   * Explicit session directory ("notebook dir is the session"). When set,
   * the session persists to this directory instead of the standard
   * `{root}/sessions/{hash}/{id}` tree.
   */
  sessionDir?: string;
  /** Structured runner config — mirrors `EnhancedRunnerOptions` groups
   * (field-level merged over the daemon config.yaml defaults; absent groups
   * fall back to runner defaults). */
  config?: {
    /** Skill directories to scan for SKILL.md files. */
    skills?: { dirs?: string[] };
    /** MCP config paths + builtin tool whitelist. */
    tools?: { mcpConfigPaths?: string[]; builtinFilter?: Record<string, boolean> };
    /** Sandbox config: boolean (legacy) or full execution-parameter object. */
    sandbox?: boolean | SandboxConfig;
    /** Thinking/reasoning mode + prompt-level guidance. */
    thinking?: { enabled?: boolean; promptLevel?: boolean };
    /** Session persistence (baseDir is daemon-managed, not exposed). */
    session?: { enabled?: boolean };
    /** Todolist support (default: enabled). */
    todolist?: { enabled?: boolean };
    /** Spec-plan tools (default: enabled). */
    specPlan?: { enabled?: boolean };
    /** Command middleware (default: enabled). */
    commands?: { enabled?: boolean };
    /** A2UI support (default: disabled). */
    a2ui?: { enabled?: boolean };
    /** Execution limits (maxInputLength, maxSteps, requestTimeout, maxToolOutput, toolTimeout). */
    limits?: {
      maxInputLength?: number;
      maxSteps?: number;
      requestTimeout?: number;
      maxToolOutput?: number;
      toolTimeout?: number;
    };
    /** Web search provider. Defaults to 'sogou'. */
    search?: { provider?: 'sogou' | 'bing' };
    /** Context compression. Omit = enabled; false = disabled. */
    compression?: boolean;
  };
}

/** POST /api/agents/:name/chat — create session + send first message */
export type CreateAndChatRequest = PerRequestParams & SessionInitParams;

/** POST /api/chat/:sessionId — send message to existing session */
export type ResumeChatRequest = PerRequestParams & {
  /**
   * Explicit session directory ("notebook dir is the session"). When set,
   * resume reads identity from this directory's meta.yaml instead of
   * looking the session up in the standard `{root}/sessions` tree.
   */
  sessionDir?: string;
};
