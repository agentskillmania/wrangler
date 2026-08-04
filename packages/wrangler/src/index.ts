// @agentskillmania/wrangler
// Wrangler 核心库 — agent crew 编排、skill 管理、workspace 组合

// Side-effect imports (must be first)
import './types/colts-augmentation.js';

// Types
export type { SessionMeta, SessionSource, RunnerConfigSnapshot } from './types.js';

// Session support
export { appDir, createSessionSupport } from './session/support.js';
export { SessionStore } from './session/session-store.js';
export { writeMeta, readMeta } from './session/meta.js';
export { SessionNotFoundError } from './session/errors.js';

// Middleware (advanced usage)
export { createSessionMiddleware } from './middleware/session-middleware.js';
export type { SessionNamingDeps } from './middleware/session-naming-middleware.js';

// Runner (Layer 2)
export { EnhancedRunner, buildTimeContext } from './runner/index.js';
export type { EnhancedRunnerOptions, LimitsConfig, BuiltinToolFilter } from './runner/index.js';

// Sub-agent delegation (Layer 2 — wrangler owns sub-agent mechanism)
export type { SubAgentConfig, DelegateResult } from './subagent/index.js';
export { createDelegateTool } from './subagent/index.js';
export type { DelegateToolDeps, SubAgentRunnerFactory } from './subagent/index.js';
export { createSubAgentRunner } from './runner/sub-agent-runner.js';
export type { SubAgentRunnerOptions } from './runner/sub-agent-runner.js';

// LLM client factory
export { createLLMClient, resolveDefaultModel } from './llm/client.js';

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

// A2UI support
export { createA2UITools, A2UIMiddleware, a2uiRespond } from './tools/a2ui/index.js';
export type {
  A2UIOperation,
  A2UIEvent,
  ComponentNode,
  ComponentOperation,
  A2UIUserResponse,
} from './tools/a2ui/index.js';

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
export { WRITE_SPEC_CONTENT, REVIEW_SPEC_CONTENT } from './spec-plan/index.js';
export { WRITE_PLAN_CONTENT, REVIEW_PLAN_CONTENT } from './spec-plan/index.js';
export { EXECUTE_PLAN_CONTENT, CONCEIVE_CONTENT } from './spec-plan/index.js';

// Crew (Layer 8) — config loader only
export { CrewLoader, crewToRunnerOptions } from './crew/index.js';
export type { CrewConfig, CrewRunnerOptions } from './crew/index.js';

// Loader (Layer 4)
export { AgentLoader } from './loader/index.js';
export type { AgentLoadResult } from './loader/index.js';
