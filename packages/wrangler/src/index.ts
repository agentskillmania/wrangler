// @agentskillmania/wrangler
// Wrangler 核心库 — agent crew 编排、skill 管理、workspace 组合

// Types
export type { SessionMeta, TranscriptEntry } from './types.js';

// Session support
export { createSessionSupport } from './session/support.js';
export { SessionStore } from './session/session-store.js';
export { writeMeta, readMeta } from './session/meta.js';
export { formatTranscriptEntry } from './session/transcript.js';
export type { ConversationMessage } from './session/types.js';

// Middleware (advanced usage)
export { createSessionMiddleware } from './middleware/session-middleware.js';

// Agent (Layer 5)
export { parseAgentMd, ConfigurableAgent } from './agent/index.js';
export type { AgentMeta, AgentDefinition, ConfigurableAgentOptions } from './agent/index.js';

// Tools (Layer 2)
export { createBuiltinTools } from './tools/builtin/index.js';
export type { BuiltinToolsOptions } from './tools/builtin/index.js';
export type { SearchProvider, SearchResult } from './tools/builtin/index.js';
export { resolvePath, truncateOutput, isBinaryFile } from './tools/builtin/index.js';
export type { WorkspaceToolDeps } from './tools/builtin/index.js';
export type { Tool } from '@agentskillmania/colts';
export { loadMCPTools } from './tools/mcp/index.js';
export type { MCPLoaderOptions } from './tools/mcp/index.js';
export type { MCPServerDef, MCPConfig } from './tools/mcp/index.js';
export { mergeMCPConfigs, readConfigFile, discoverGlobalConfigPath } from './tools/mcp/index.js';
export { createMCPTool, jsonSchemaToZod } from './tools/mcp/index.js';

// Todolist (Layer 3)
export { createTodolistSupport } from './todolist/index.js';
export type { TodoStatus, TodoItem, TodoList } from './todolist/index.js';
export {
  createEmptyTodoList,
  addTodo,
  updateTodo,
  deleteTodo,
  formatTodoForContext,
} from './todolist/index.js';

// Spec/Plan (Layer 4)
export { SpecStore, PlanStore } from './spec-plan/index.js';
export type {
  SpecStatus,
  PlanStatus,
  SpecMeta,
  PlanMeta,
  SpecDocument,
  PlanDocument,
} from './spec-plan/index.js';
export { WRITING_SPEC_CONTENT, REVIEW_SPEC_CONTENT } from './spec-plan/index.js';
export { WRITING_PLAN_CONTENT, REVIEW_PLAN_CONTENT } from './spec-plan/index.js';
export { EXECUTE_PLAN_CONTENT } from './spec-plan/index.js';

// Crew (Layer 8)
export { Crew } from './crew/index.js';
export {
  AgentInstance,
  MessageRouter,
  CrewTodoList,
  buildLiaisonPrompt,
  CrewLoader,
} from './crew/index.js';
export {
  createCreateTaskTool,
  createSendMessageTool,
  createRelayToPrimaryTool,
  createReadCrewTodolistTool,
  createUpdateCrewTodolistTool,
} from './crew/index.js';
export type {
  CrewConfig,
  CrewState,
  CrewInput,
  CrewOutputEvent,
  CrewEventHandler,
  CrewTodoItem,
  AgentRole,
  AgentInstanceInfo,
  TaskStatus,
  TaskInfo,
  CrewOptions,
  CrewRunner,
  RunnerFactory,
  CrewToolInvokedEvent,
  CrewToolCompletedEvent,
  CrewAgentAdvancedEvent,
  CrewMessageRoutedEvent,
} from './crew/index.js';
