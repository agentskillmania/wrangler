// @agentskillmania/wrangler
// Wrangler 核心库 — agent crew 编排、skill 管理、workspace 组合

// Side-effect imports (must be first)
import './types/colts-augmentation.js';

// Types
export type { SessionMeta, SessionSource, RunnerConfigSnapshot } from './types.js';

// ─── 定向再导出（R2P-201，对齐 Rust c410f79 契约清单 §8）──────────────────
// daemon 生产代码零 @agentskillmania/colts / llm-client 直驱（daemon 包
// eslint no-restricted-imports 执法）：内核词汇经 wrangler 门面触达——
// 「wrangler 是 harness、colts 是 agent」。清单只转发 harness 消费面实际
// 用到的名字，新增=契约变更须记录。
//
// 引擎状态 + LLM 装配词汇（Rust: pub use colts::types::AgentState；
// LLMQuickInit/LLMProviderEntry 系 colts 自 llm-client 的同源转发）。
export type {
  AgentState,
  ILLMProvider,
  ISkillProvider,
  LLMQuickInit,
  LLMProviderEntry,
} from '@agentskillmania/colts';
export {
  createAgentState,
  updateState,
  addUserMessage,
  deserializeState,
} from '@agentskillmania/colts';

// runner 事件/选项词汇（Rust: wrangler::events 定向再导出执行词汇）。
export type { RunStreamEvent, RunOptions, RunnerEventMap } from '@agentskillmania/colts';

// HITL 协议类型（Rust: pub use colts::hitl::{HumanRequest, HumanResponse,
// PendingInterrupt, ...}）；注入原语 respond/removePendingInterrupt 同源转发。
export type {
  HumanRequest,
  HumanAnswer,
  HitlHumanResponse,
  PendingInterrupt,
  HumanResponse,
  AskHumanHandler,
} from '@agentskillmania/colts';
export { respond, removePendingInterrupt } from '@agentskillmania/colts';

// skill provider（Rust: wrangler::skills::fs::FilesystemSkillProvider——
// 与运行时/清单端点同一套 provider）。
export { FilesystemSkillProvider } from '@agentskillmania/colts';

// 宿主自举（Rust: wrangler::bootstrap::ensure_sandbox_runtime 同位）

// Session support
export { createSessionSupport } from './session/support.js';
export { SessionStore } from './session/session-store.js';
export { writeMeta, readMeta } from './session/meta.js';
export { SessionNotFoundError } from './session/errors.js';
export { truncateStateTurns } from './session/truncate.js';
export type { TruncatedState, TruncateResult } from './session/truncate.js';

// Middleware (advanced usage)
export { createSessionMiddleware } from './middleware/session-middleware.js';
export type {
  SessionNamingDeps,
  SessionTitleSlot,
} from './middleware/session-naming-middleware.js';

// Runner (Layer 2)
export { EnhancedRunner, buildTimeLine } from './runner/index.js';
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
export type {
  SearchProvider,
  SearchResult,
  SearchOutcome,
  NamedSearchProvider,
} from './tools/web/index.js';
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

// Skills — inventory alignment layer (wraps an injected provider; collection
// rules mirror Rust dc5cb1f: recursive walk, junk pruning, sort, cap+tail,
// single-side partition)
export { InventorySkillProvider } from './skills/inventory-provider.js';
export type { SkillDirWalker, InventorySkillProviderOptions } from './skills/inventory-provider.js';
export { INVENTORY_CAP, isJunkEntry, isDocumentFile, splitInventory } from './skills/inventory.js';

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
