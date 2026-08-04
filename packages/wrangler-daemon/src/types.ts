import type { LLMQuickInit } from '@agentskillmania/colts';

import type { ConfigManager } from './core/config-manager.js';
import type { ResourceManager } from './core/resource-manager.js';
import type { SessionManager } from './core/session-manager.js';

/** Daemon configuration stored in config.yaml */
export interface DaemonConfig {
  llm: LLMQuickInit;
  server: {
    port: number;
    host: string;
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
  sandbox?: boolean;
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
  config?: {
    skillDirs?: string[];
    mcpConfigPaths?: string[];
    builtinTools?: Record<string, boolean>;
    enableSession?: boolean;
    enableTodolist?: boolean;
    enableCommands?: boolean;
    sandbox?: boolean;
    a2ui?: { enabled: boolean };
    /** Execution limits (maxInputLength, maxSteps, requestTimeout, maxToolOutput, toolTimeout) */
    limits?: {
      maxInputLength?: number;
      maxSteps?: number;
      requestTimeout?: number;
      maxToolOutput?: number;
      toolTimeout?: number;
    };
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
