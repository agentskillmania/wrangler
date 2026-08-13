// @agentskillmania/wrangler
// Wrangler 核心库 — agent crew 编排、skill 管理、workspace 组合

// Side-effect imports (must be first)
import './types/colts-augmentation.js';

// Types
export type { SessionMeta, SessionSource, RunnerConfigSnapshot } from './types.js';

// Session support
export { createSessionSupport } from './session/support.js';
export { SessionStore } from './session/session-store.js';
export { writeMeta, readMeta } from './session/meta.js';
export { SessionNotFoundError } from './session/errors.js';

// Middleware (advanced usage)
export { createSessionMiddleware } from './middleware/session-middleware.js';
export type { SessionNamingDeps } from './middleware/session-naming-middleware.js';

// Runner (Layer 2)
export { EnhancedRunner, buildTimeContext } from './runner/index.js';
export type {
  EnhancedRunnerOptions,
  ResolvedRunnerConfig,
  LimitsConfig,
  BuiltinToolFilter,
  SandboxConfig,
  PolicyConfig,
} from './runner/index.js';

// Sub-agent delegation (Layer 2 — wrangler owns sub-agent mechanism)
export type { SubAgentConfig, DelegateResult } from './subagent/index.js';
export { createDelegateTool } from './subagent/index.js';
export type { DelegateToolDeps, SubAgentRunnerFactory } from './subagent/index.js';
export { createSubAgentRunner } from './runner/sub-agent-runner.js';
export type { SubAgentRunnerOptions } from './runner/sub-agent-runner.js';

// LLM client factory（createLLMClient 仅供 Node 宿主；resolveDefaultModel 纯函数）
export { createLLMClient } from './llm/client.js';
export { resolveDefaultModel } from './llm/resolve-model.js';

// Agent (Layer 5)
export { parseAgentMd } from './agent/index.js';
export type { ParsedAgent } from './agent/index.js';

// Tools (Layer 2) —— 主入口只含平台无关 core；web 工具走 ./tools/web 子路径
export { createCoreTools } from './tools/builtin/index.js';
export type { CoreToolsOptions } from './tools/builtin/index.js';
// 搜索 provider 类型（type-only，web 工具的宿主注入参数）——运行时零依赖
export type { SearchProvider, SearchResult } from './tools/web/index.js';
export { resolvePath, truncateOutput } from './tools/builtin/index.js';
export type { ToolDeps, ExecResult } from './tools/builtin/index.js';
export { HostToolDeps } from './tools/builtin/index.js';
export { createPythonTool } from './tools/builtin/python.js';
export { createGitTool } from './tools/builtin/git.js';
export type { Tool } from '@agentskillmania/colts';

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

// Crew (Layer 8) — config loader only
export { CrewLoader, crewToRunnerOptions } from './crew/index.js';
export type { CrewConfig, CrewRunnerOptions } from './crew/index.js';

// Loader (Layer 4)
export { AgentLoader } from './loader/index.js';
export type { AgentLoadResult } from './loader/index.js';

// HostEnv (宿主环境抽象层 — 引擎核心通过它访问 OS 资源)
// 注意：只导出接口和类型。NodeHostEnv 等具体实现从子路径 import
// （@agentskillmania/wrangler/host-env/node-host-env），由组合根负责创建。
export type {
  HostEnv,
  HostEnvFs,
  HostEnvProcess,
  HostEnvPath,
  HostEnvCrypto,
  HostEnvEnv,
  HostEnvResources,
  ShellInfo,
  DirEntry,
  RuntimeStat,
  GrepResult,
} from './host-env/index.js';
export { RuntimeCapabilityError } from './host-env/index.js';
