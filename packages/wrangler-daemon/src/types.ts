/** Daemon configuration stored in config.yaml */
export interface DaemonConfig {
  llm: {
    baseUrl: string;
    apiKey: string;
    model: string;
  };
  server: {
    port: number;
    host: string;
  };
  [key: string]: unknown; // Index signature for settings-yaml compatibility
}

/** Default daemon config values */
export const DEFAULT_CONFIG: DaemonConfig = {
  llm: {
    baseUrl: '',
    apiKey: '',
    model: 'deepseek-chat',
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
  toolCount: number;
  skillCount: number;
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
  configManager: import('./core/config-manager.js').ConfigManager;
  resourceManager: import('./core/resource-manager.js').ResourceManager;
  sessionManager: import('./core/session-manager.js').SessionManager;
}
