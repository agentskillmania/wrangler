// @agentskillmania/wrangler
// Wrangler 核心库 — agent crew 编排、skill 管理、workspace 组合

// Side-effect imports (must be first)
import './types/colts-augmentation.js';

// Types
export type { SessionMeta, SessionEntry } from './types.js';

// Session support
export { createSessionSupport } from './session/support.js';
export { SessionStore } from './session/session-store.js';
export { writeMeta, readMeta } from './session/meta.js';

// Middleware (advanced usage)
export { createSessionMiddleware } from './middleware/session-middleware.js';

// Runner (Layer 2)
export { EnhancedRunner, buildTimeContext } from './runner/index.js';
export type { EnhancedRunnerOptions } from './runner/index.js';

// Agent (Layer 5)
export { parseAgentMd } from './agent/index.js';
export type { ParsedAgent } from './agent/index.js';

// Tools (Layer 2)
export { createBuiltinTools } from './tools/builtin/index.js';
export type { BuiltinToolsOptions } from './tools/builtin/index.js';
export type { SearchProvider, SearchResult } from './tools/builtin/index.js';
export { resolvePath, truncateOutput, isBinaryFile } from './tools/builtin/index.js';
export type { ToolDeps, ExecResult } from './tools/builtin/index.js';
export { HostToolDeps } from './tools/builtin/index.js';
export { createPythonTool } from './tools/builtin/python.js';
export { createGitTool } from './tools/builtin/git.js';
export type { Tool } from '@agentskillmania/colts';
export { loadMCPTools } from './tools/mcp/index.js';
export type { MCPLoaderOptions } from './tools/mcp/index.js';
export { discoverGlobalConfigPath } from './tools/mcp/index.js';
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

// Command system
export {
  parseCommand,
  CommandRegistry,
  createCommandMiddleware,
  createClearHandler,
  createCompactHandler,
  createSkillsHandler,
  createSkillHandler,
} from './command/index.js';
export type {
  ParsedCommand,
  CommandContext,
  CommandResult,
  CommandHandler,
} from './command/index.js';

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

// Loader (Layer 4)
export { AgentLoader } from './loader/index.js';
export type { AgentLoadResult } from './loader/index.js';
