import {
  AgentRunner,
  DefaultContextCompressor,
  ToolRegistry,
  ConfirmableRegistry,
} from '@agentskillmania/colts';
import type {
  AgentState,
  RunnerEventMap,
  RunResult,
  RunOptions,
  IContextCompressor,
  CompressionConfig,
  ILLMProvider,
  IToolRegistry,
} from '@agentskillmania/colts';
import type { Tool } from '@agentskillmania/colts';
import type { Sandbox } from '@agentskillmania/sandbox';
import { produce } from 'immer';
import type { ZodTypeAny } from 'zod';

import { MarkdownMessageAssembler } from './markdown-assembler.js';
import type {
  AgentHarnessOptions,
  ResolvedRunnerConfig,
  ToolMetadata,
  SkillMetadata,
  ResumeOptions,
  BuiltinToolFilter,
  LLMConfig,
  SearchConfig,
} from './types.js';
import { createCommandMiddleware } from '../command/command-middleware.js';
import { createClearHandler } from '../command/handlers/clear.js';
import { createCompactHandler } from '../command/handlers/compact.js';
import { createSkillHandler } from '../command/handlers/skill.js';
import { createSkillsHandler } from '../command/handlers/skills.js';
import { CommandRegistry } from '../command/registry.js';
import type { HostEnv } from '../host-env/index.js';
import { resolveDefaultModel } from '../llm/resolve-model.js';
import type { SessionTitleSlot } from '../middleware/session-naming-middleware.js';
import { SessionNotFoundError } from '../session/errors.js';
import { SessionStore } from '../session/session-store.js';
import { emptySupervisorSlot } from '../session/supervisor.js';
import type { DelegateSupervisor, SupervisorSlot } from '../session/supervisor.js';
import { createSessionSupport } from '../session/support.js';
import { InventorySkillProvider } from '../skills/inventory-provider.js';
import { PlanStore } from '../spec-plan/plan-store.js';
import { SpecStore } from '../spec-plan/spec-store.js';
import { createDelegateTool } from '../subagent/delegate-tool.js';
import { createTodolistSupport } from '../todolist/support.js';
import { createA2UITools } from '../tools/a2ui/index.js';
import { createCoreTools } from '../tools/builtin/index.js';
import {
  DEFAULT_MAX_TOOL_OUTPUT,
  HostToolDeps,
  SandboxToolDeps,
} from '../tools/builtin/workspace-deps.js';
import type { ToolDeps } from '../tools/builtin/workspace-deps.js';
import { createReadResourceTool } from '../tools/skill/read-resource.js';
import { createRunScriptTool } from '../tools/skill/run-script.js';
import { createSpecPlanTools } from '../tools/spec-plan/index.js';

/**
 * Build the base skill directory list: user-provided skill dirs plus the
 * built-in wrangler spec-plan skills (resolved via runtime.resources).
 * Returns a fresh array the caller may extend.
 */
function collectSkillDirs(options: AgentHarnessOptions, runtime: HostEnv): string[] {
  const dirs = [...(options.skills?.dirs ?? [])];
  const builtinDirs = runtime.resources.builtinSkillDirs();
  dirs.push(...builtinDirs);
  return dirs;
}

function resolveLLMClient(options: { llm?: LLMConfig }): ILLMProvider {
  const llmGroup = options.llm;
  const client = llmGroup?.client;
  const quickInit = llmGroup?.quickInit;
  if (client && quickInit) {
    throw new Error(
      'Cannot specify both llm.client and llm.quickInit. Choose one: injection or quick initialization.'
    );
  }
  if (client) return client;
  if (quickInit?.providers && quickInit.providers.length > 0) {
    // 引擎不捆绑内置 LLM——quickInit 的创建器由宿主注入
    // （Node 宿主传 LLMClient.quickInit，浏览器宿主不用 quickInit）
    const factory = llmGroup?.quickInitFactory;
    if (!factory) {
      throw new Error(
        'llm.quickInit requires llm.quickInitFactory (e.g. (providers) => LLMClient.quickInit({ providers })) — wrangler core does not bundle the built-in LLM client.'
      );
    }
    return factory(quickInit.providers);
  }
  throw new Error('Must specify either llm.client or llm.quickInit.');
}

/**
 * AgentHarness — Pre-wired AgentRunner with all wrangler runtime mechanisms
 *
 * Wraps colts AgentRunner and pre-configures:
 * - Builtin tools (file operations, shell, web search/fetch)
 * - MCP tools (loaded from explicitly provided config paths)
 * - Session support (persistence, calculator, ask_human)
 * - Todolist support (task management)
 * - Time context in system prompt
 *
 * Design principles:
 * - Stateless: state is managed externally, same as AgentRunner
 * - Interface consistent: run(state) signature matches AgentRunner.run()
 * - Pre-wires everything: constructor-time assembly of all Layer 1 mechanisms
 *
 * @example
 * ```typescript
 * const runner = await AgentHarness.create({
 *   llmClient,
 *   model: 'gpt-4',
 *   workspacePath: '/my/project',
 * });
 *
 * const result = await runner.run(initialState);
 * ```
 */
export class AgentHarness {
  private readonly innerRunner: AgentRunner;
  private readonly resolvedConfig: ResolvedRunnerConfig;
  /** Tool metadata map: tool name → enriched info with type and enabled state. */
  private readonly toolMetadataMap: Map<string, ToolMetadata>;
  /** Skill metadata list: source paths. */
  private readonly skillMetadataList: SkillMetadata[];
  /** Registered slash command handlers (populated at create() when commands enabled). */
  private commandRegistry: CommandRegistry | null = null;
  /**
   * Session-title notification slot (R2P-232, aligned Rust 2287cc1's
   * NamingEventSlot). Undefined when sessions are disabled — the late-binding
   * setter is then a silent no-op.
   */
  private readonly titleEventSlot?: SessionTitleSlot;
  /**
   * 异步委派监督者槽（R2P-141c，对齐 Rust SupervisorSlot）：构建时为空
   * （delegate 同步模式默认），会话物化后由宿主晚绑定
   * （{@link setDelegateSupervisor}）。与 titleEventSlot 不同，此槽恒存在
   * ——绑定一个没有 delegate 工具的 runner 无害（无处可读）。
   */
  private readonly delegateSupervisorSlot: SupervisorSlot;
  /**
   * 会话存储引用（会话启用时恒有）：`file:` 附件引用锚定目录的同源
   * 派生来源（R2P-107）。目录绑定会话在构建时即可锚定；标准会话的
   * 目录在 session id 生成后才存在，由宿主经
   * {@link resolveAttachmentDir} + {@link setAttachmentDir} 晚绑定。
   */
  private readonly sessionStoreRef?: SessionStore;

  private constructor(
    runner: AgentRunner,
    config: ResolvedRunnerConfig,
    toolMetadataMap: Map<string, ToolMetadata>,
    skillMetadataList: SkillMetadata[],
    commandRegistry: CommandRegistry | null = null,
    titleEventSlot?: SessionTitleSlot,
    delegateSupervisorSlot: SupervisorSlot = emptySupervisorSlot(),
    sessionStoreRef?: SessionStore
  ) {
    this.innerRunner = runner;
    this.resolvedConfig = config;
    this.toolMetadataMap = toolMetadataMap;
    this.commandRegistry = commandRegistry;
    this.skillMetadataList = skillMetadataList;
    this.titleEventSlot = titleEventSlot;
    this.delegateSupervisorSlot = delegateSupervisorSlot;
    this.sessionStoreRef = sessionStoreRef;
  }

  /**
   * Late-bind the async-delegation supervisor (R2P-141c, the TS analog of
   * Rust `set_delegate_supervisor`): the host (daemon session materialization)
   * injects the supervisor AFTER the runner is constructed; the delegate tool
   * reads the slot on every call — bound-and-alive = accept-and-return
   * (accepted receipt), empty = the sync path (zero change).
   */
  setDelegateSupervisor(supervisor: DelegateSupervisor): void {
    this.delegateSupervisorSlot.current = supervisor;
  }

  /**
   * Late-bind the `session-title` notification sink (R2P-232, the TS analog
   * of Rust 2287cc1's `set_naming_event_sink`): the host (daemon session
   * materialization) injects a listener AFTER the runner is constructed; the
   * naming middleware fires it once a Phase-2 LLM title upgrade has landed
   * on disk. Not injected (or sessions disabled) = silent — the title still
   * persists, nobody is notified.
   */
  setSessionTitleListener(sink: (title: string) => void): void {
    if (this.titleEventSlot) {
      this.titleEventSlot.sink = sink;
    }
  }

  /**
   * 派生 `file:` 附件引用的锚定目录（R2P-107，对齐 Rust build.rs 的
   * attachment_dir 同源派生）：目录绑定会话不传 sessionId；标准会话传
   * session id（baseDir/hash(workspace)/<id>）。会话未启用或会话 id
   * 未知时返回 undefined——此时收到 `file:` 引用会在 wire 物化时报错。
   */
  resolveAttachmentDir(sessionId?: string): string | undefined {
    return this.sessionStoreRef?.getSessionDir(sessionId);
  }

  /**
   * 晚绑定附件锚定目录到内核 runner（透传 colts
   * AgentRunner.setAttachmentDir）。
   */
  setAttachmentDir(dir: string | undefined): void {
    this.innerRunner.setAttachmentDir(dir);
  }

  /**
   * Get tool list with name, description, type, and enabled state for diagnostics.
   * Built from metadata captured at create() time — reflects the original tool
   * assembly including disabled builtin tools.
   */
  getToolInfo(): ToolMetadata[] {
    return Array.from(this.toolMetadataMap.values());
  }

  /**
   * Get skill list with name, description, and source path for diagnostics.
   * Built from metadata captured at create() time.
   */
  getSkillInfo(): SkillMetadata[] {
    return this.skillMetadataList;
  }

  /**
   * Get resolved runner config for diagnostics.
   * Frozen snapshot built at create() time.
   */
  getConfig(): Readonly<ResolvedRunnerConfig> {
    return this.resolvedConfig;
  }

  /**
   * 已注册的斜杠命令列表（如 /clear /compact）——UI 用它构建快捷命令。
   * 返回注册顺序，commands 禁用时为空数组。
   */
  getCommandNames(): Array<{ name: string; description: string }> {
    if (!this.commandRegistry) return [];
    return this.commandRegistry.list().map((h) => ({
      name: h.name,
      description: h.description,
    }));
  }

  /**
   * Create an AgentHarness with all tools and middleware pre-wired
   *
   * @param options - Configuration options
   * @returns Configured AgentHarness instance
   */
  static async create(options: AgentHarnessOptions): Promise<AgentHarness> {
    // runtime 必传：宿主注入（Node 用 NodeHostEnv、浏览器用 BrowserHostEnv）
    // ——引擎 core 不 import NodeHostEnv（保持零 node: 依赖）
    if (!options.runtime) {
      throw new Error(
        'AgentHarnessOptions.runtime is required — Node host: new NodeHostEnv() from @agentskillmania/wrangler/host-env/node-host-env'
      );
    }
    const runtime = options.runtime;
    const workspacePath = options.workspacePath ?? runtime.env.cwd();
    // 斜杠命令注册表（commands 启用时填充，构造时传入实例）
    let registeredCommands: CommandRegistry | null = null;
    // Resolve skill dirs once and reuse across all consumers below (avoids
    // repeated array allocation + repeated runtime.resources.builtinSkillDirs()).
    const resolvedSkillDirs = collectSkillDirs(options, runtime);
    const llmClient = resolveLLMClient(options);

    const sandboxEnabled = options.sandbox?.enabled;

    // Sandbox 实例由宿主注入（Node 宿主构造）——引擎 core 不捆绑 sandbox 运行时
    const sandboxInstance: Sandbox | undefined = options.sandbox?.instance;
    if (sandboxEnabled && !sandboxInstance) {
      throw new Error(
        'sandbox.enabled requires sandbox.instance (host constructs `new Sandbox({ sandboxDir, ...params })`) — wrangler core does not bundle the sandbox runtime'
      );
    }

    // 统一的工具依赖（core 工具与技能工具共用）——宿主注入优先，
    // 否则按 sandbox 实例 / runtime 构造（平台无关，HostToolDeps 接受 HostEnv）
    const maxOutputSize = options.limits?.maxToolOutput ?? DEFAULT_MAX_TOOL_OUTPUT;
    const toolTimeout = options.limits?.toolTimeout ?? 600_000;
    const resolvedDeps: ToolDeps =
      options.tools?.deps ??
      (sandboxInstance
        ? new SandboxToolDeps(sandboxInstance, maxOutputSize, toolTimeout)
        : new HostToolDeps(runtime, workspacePath, maxOutputSize, undefined, toolTimeout));

    // 平台无关 core 工具（web_fetch/web_search 由宿主经 tools.inject 注入）
    const builtinTools = createCoreTools({
      deps: resolvedDeps,
      askHumanHandler: options.tools?.askHumanHandler,
      maxToolOutput: options.limits?.maxToolOutput,
    });

    // Filter builtin tools based on toggle options.
    // When builtinTools is provided, it acts as a whitelist:
    // - Listed with true → include
    // - Listed with false → exclude
    // - Not listed → exclude
    // When omitted → include all (backward compatible)
    const toolToggles = options.tools?.builtinFilter;
    const filteredBuiltinTools = toolToggles
      ? builtinTools.filter((tool) => {
          const toggleMap: Record<string, keyof NonNullable<BuiltinToolFilter>> = {
            calculate: 'calculate',
            ask_human: 'askHuman',
            file_read: 'fileRead',
            file_write: 'fileWrite',
            file_edit: 'fileEdit',
            glob: 'glob',
            grep: 'grep',
            shell: 'shell',
            web_search: 'webSearch',
            web_fetch: 'webFetch',
            python: 'python',
            git: 'git',
          };
          const key = toggleMap[tool.name as string];
          if (!key || !(key in toolToggles)) return false;
          return toolToggles[key] !== false;
        })
      : builtinTools;

    // MCP 工具：加载器由宿主注入（Node 用 loadMCPTools 子路径）——
    // 引擎 core 不捆绑 MCP 加载（拖入 @modelcontextprotocol 等 Node 依赖）
    const mcpConfigPaths = options.tools?.mcpConfigPaths ?? [];
    let mcpTools: Tool<ZodTypeAny>[] = [];
    if (mcpConfigPaths.length > 0) {
      const loader = options.tools?.mcpLoader;
      if (!loader) {
        throw new Error(
          'tools.mcpConfigPaths requires tools.mcpLoader (Node host: (paths) => loadMCPTools({ configPaths: paths }) from @agentskillmania/wrangler/tools/mcp)'
        );
      }
      mcpTools = await loader(mcpConfigPaths);
    }

    const llmQuickInit = options.llm?.quickInit;
    const resolvedModel =
      options.llm?.model ??
      (llmQuickInit?.providers ? resolveDefaultModel(llmQuickInit.providers) : 'glm-5.1');

    const sessionEnabled = options.session?.enabled !== false;

    const todolistEnabled = options.todolist?.enabled !== false;
    const todolistSupport = todolistEnabled
      ? createTodolistSupport()
      : { tools: [] as Tool<ZodTypeAny>[], middleware: { name: 'todolist' } };

    // Spec-plan support (conditional)
    const specPlanEnabled = options.specPlan?.enabled !== false;
    // Fixed unified root: {appDataDir}/spec-plan. Decoupled from the session
    // base dir (the two concerns used to share a setting, which broke the
    // daemon: sessions at {root}/sessions but specs under {root}/sessions).
    const specPlanBaseDir = runtime.path.join(runtime.env.appDataDir(), 'spec-plan');
    const specStore = new SpecStore(runtime.path.join(specPlanBaseDir, 'specs'), runtime);
    const planStore = new PlanStore(runtime.path.join(specPlanBaseDir, 'plans'), runtime);
    const specPlanTools = specPlanEnabled ? createSpecPlanTools(specStore, planStore) : [];

    // A2UI support (conditional) — 纯展示工具面（D4，对齐 Rust 02b1bc6）：
    // 四把工具非阻塞、无专属 middleware；需用户输入走 ask_human。
    const a2uiEnabled = options.a2ui?.enabled === true; // a2ui already uses { enabled } shape
    const a2uiTools = a2uiEnabled ? createA2UITools() : [];

    // Sub-agent delegation support (conditional)
    // When subAgents are configured, a delegate tool is created and registered
    // AFTER the AgentRunner is built (so it can close over the runner's registry
    // and EventEmitter). See the post-construction registration below.
    const subAgentConfigs =
      options.delegation?.subAgents && options.delegation.subAgents.length > 0
        ? new Map(options.delegation.subAgents.map((sa) => [sa.name, sa]))
        : undefined;
    // 监督者槽与 runner 同庚创建（空 = 同步默认）；宿主在会话物化后
    // setDelegateSupervisor 晚绑定（R2P-141c）。
    const delegateSupervisorSlot = emptySupervisorSlot();

    // Build skill-resource tools (read_skill_resource + run_skill_script) when
    // skill directories are configured. These complement load_skill by giving
    // the agent access to reference docs and bundled scripts.
    // 技能 provider：只认注入（浏览器扩展传 OPFS 适配、daemon 由 agent-session
    // 从 dirs 构造后注入）——引擎 core 不构造 FilesystemSkillProvider，
    // 保持零 node: 依赖，宿主环境决定技能后端。注入后统一套清单对齐层：
    // colts 现行收集是顶层扫描（嵌套路径丢失、垃圾不剪、scripts 双列、
    // 无 cap），而 Rust 的收集+分区都在 wrangler 侧——包装层按 Rust
    // dc5cb1f 规则重导清单，load_skill 目录//skill: 注入/自愈提示全部
    // 消费同一份。后端 source 不可读（浏览器 OPFS 等）时原样透传。
    // (R2P-114w)
    const skillProvider = options.skills?.provider
      ? new InventorySkillProvider(options.skills.provider)
      : undefined;
    const skillTools: Tool<ZodTypeAny>[] = [];
    if (skillProvider) {
      skillTools.push(createReadResourceTool(skillProvider));
      skillTools.push(createRunScriptTool(resolvedDeps, skillProvider));
    }

    // 宿主注入：静态数组 + 工厂（工厂收到解析好的 ToolDeps）
    const injectedTools: Tool<ZodTypeAny>[] = [
      ...(options.tools?.inject ?? []),
      ...(options.tools?.injectFactory ? options.tools.injectFactory(resolvedDeps) : []),
    ];

    const allTools: Tool<ZodTypeAny>[] = [
      ...filteredBuiltinTools,
      ...injectedTools,
      ...specPlanTools,
      ...mcpTools,
      ...todolistSupport.tools,
      ...a2uiTools,
      ...skillTools,
      ...(options.tools?.extra ?? []),
    ];

    // Build tool metadata map — track type and enabled state for diagnostics.
    // Builtin tools that were filtered out (disabled via toggle) are included
    // with enabled=false so the UI can show them as disabled.
    const toolMeta = new Map<string, ToolMetadata>();

    // Add all builtin tools — enabled if they passed the filter, disabled otherwise
    const filteredNameSet = new Set(filteredBuiltinTools.map((t) => t.name));
    for (const tool of builtinTools) {
      toolMeta.set(tool.name, {
        name: tool.name,
        description: tool.description,
        type: 'builtin',
        enabled: filteredNameSet.has(tool.name),
      });
    }
    // Add spec-plan tools (type='builtin' per design)
    for (const tool of specPlanTools) {
      toolMeta.set(tool.name, {
        name: tool.name,
        description: tool.description,
        type: 'builtin',
        enabled: true,
      });
    }
    // Add MCP, todolist, a2ui, extra tools (always enabled if present)
    for (const tool of mcpTools) {
      toolMeta.set(tool.name, {
        name: tool.name,
        description: tool.description,
        type: 'mcp',
        enabled: true,
      });
    }
    for (const tool of todolistSupport.tools) {
      toolMeta.set(tool.name, {
        name: tool.name,
        description: tool.description,
        type: 'todolist',
        enabled: true,
      });
    }
    for (const tool of a2uiTools) {
      toolMeta.set(tool.name, {
        name: tool.name,
        description: tool.description,
        type: 'a2ui',
        enabled: true,
      });
    }
    for (const tool of skillTools) {
      toolMeta.set(tool.name, {
        name: tool.name,
        description: tool.description,
        type: 'skill',
        enabled: true,
      });
    }
    for (const tool of options.tools?.extra ?? []) {
      toolMeta.set(tool.name, {
        name: tool.name,
        description: tool.description,
        type: 'extra',
        enabled: true,
      });
    }

    // resolvedModel is computed earlier after llmClient resolution
    let modelMeta: { contextWindow: number; maxTokens: number } | undefined;
    try {
      modelMeta = llmClient.getModelMeta(resolvedModel);
    } catch {
      // Model not found in registry
    }

    // Build command registry with built-in + custom handlers (conditional)
    const commandsEnabled = options.commands?.enabled !== false;
    let commandMiddleware: { name: string } | undefined;
    let compressorInstance: IContextCompressor | undefined;
    if (commandsEnabled) {
      const commandRegistry = new CommandRegistry();
      commandRegistry.register(createClearHandler());
      commandRegistry.register(createCompactHandler());
      {
        // When a2ui is enabled, automatically include the a2ui-generation skill from @agentskillmania/genui
        const skillDirs = [...resolvedSkillDirs];
        if (a2uiEnabled) {
          const genuiRoot = runtime.resources.resolvePackagePath('@agentskillmania/genui');
          if (genuiRoot) {
            const genuiSkillsDir = runtime.path.join(genuiRoot, 'skills');
            skillDirs.push(genuiSkillsDir);
          }
        }
        if (skillProvider) {
          commandRegistry.register(createSkillsHandler(skillProvider));
          commandRegistry.register(createSkillHandler(skillProvider));
        }
      }
      for (const cmd of options.commands?.extra ?? []) {
        commandRegistry.register(cmd);
      }
      // Create compressor instance for both AgentRunner auto-compression and /compact command.
      // Default: enabled (compression !== false). If no config provided, auto-detect
      // contextWindowSize from model metadata; fall back to message-count threshold.
      if (options.compression !== false) {
        if (
          options.compression &&
          typeof options.compression === 'object' &&
          'shouldCompress' in options.compression
        ) {
          compressorInstance = options.compression as IContextCompressor;
        } else {
          // Default strategy = 'summarize' (LLM-generated summary of dropped
          // messages). Mirrors the Rust daemon's 3ab40fe default. The caller
          // can override with strategy: 'truncate' to just drop old messages.
          const compressionConfig = {
            strategy: 'summarize' as const,
            ...((options.compression as CompressionConfig) ?? {}),
          };
          // Auto-detect context window size from pre-resolved model metadata
          if (!compressionConfig.contextWindowSize && modelMeta) {
            compressionConfig.contextWindowSize = modelMeta.contextWindow;
          }
          compressorInstance = new DefaultContextCompressor(
            compressionConfig,
            llmClient,
            resolvedModel
          );
        }
      }

      commandMiddleware = createCommandMiddleware(commandRegistry, {
        compressor: compressorInstance,
        // Command side-effect events (/compact → compressed) ride the runner's
        // EventEmitter — the same channel stream consumers (daemon SSE) already
        // subscribe to. Closure over `runner` assigned below; emission only
        // happens during run(), after assignment (same pattern as the delegate
        // tool's emit). (R2P-104w)
        emit: (type, data) => {
          runner.emit(type as keyof RunnerEventMap, data as never);
        },
      });
      // commandRegistry 存入实例字段在构造时完成（create 是 static，不能 this.xxx）
      registeredCommands = commandRegistry;
    }
    // Reuse pre-resolved model metadata for diagnostics
    const contextWindow = modelMeta?.contextWindow;

    // Now that modelMeta + compressorInstance are resolved, construct the
    // session support with a COMPLETE runnerConfigSnapshot — no fields lost.
    const sessionSupport = sessionEnabled
      ? createSessionSupport({
          runtime,
          workspacePath,
          sessionBaseDir: options.session?.baseDir,
          sessionDir: options.session?.sessionDir,
          llmClient,
          model: resolvedModel,
          runnerConfigSnapshot: {
            model: resolvedModel,
            contextWindow,
            thinking: options.thinking,
            limits: options.limits,
            compression: { enabled: !!compressorInstance },
            search: options.search
              ? {
                  provider:
                    typeof options.search.provider === 'string'
                      ? options.search.provider
                      : undefined,
                }
              : undefined,
            skillDirs: options.skills?.dirs,
            mcpConfigPaths,
            builtinTools: options.tools?.builtinFilter as Record<string, boolean> | undefined,
            sandbox: sandboxEnabled,
            enableSession: options.session?.enabled,
            enableTodolist: options.todolist?.enabled,
            enableSpecPlan: options.specPlan?.enabled,
            enableCommands: options.commands?.enabled,
            a2ui: options.a2ui as { enabled: boolean } | undefined,
            crewId: options.crewId,
          },
          source: options.source,
        })
      : { middlewares: [{ name: 'session' }] };
    // The naming-title slot exists only when sessions are enabled (mirror of
    // Rust 2287cc1's MiddlewareChain.naming_event_slot: None when disabled).
    // Narrow on the support object itself — `sessionEnabled` is an independent
    // variable, so a ternary on it cannot narrow the union type.
    const titleEventSlot =
      'titleEventSlot' in sessionSupport ? sessionSupport.titleEventSlot : undefined;

    // Build skill metadata from the injected provider (if any).
    const skillMeta: SkillMetadata[] = skillProvider
      ? (await skillProvider.listSkills()).map((s) => ({
          name: s.name,
          description: s.description,
          source: s.source,
        }))
      : [];

    // Build tool registry and optionally wrap with confirmation
    let finalToolRegistry: IToolRegistry | undefined;
    if (options.tools?.confirmHandler) {
      const toolRegistry = new ToolRegistry();
      for (const tool of allTools) {
        toolRegistry.register(tool);
      }
      finalToolRegistry = new ConfirmableRegistry(toolRegistry, {
        confirm: options.tools.confirmHandler,
        confirmTools: options.tools.confirmTools ?? [],
      });
    }

    const runner = new AgentRunner({
      model: resolvedModel,
      llmClient,
      tools: finalToolRegistry ? undefined : allTools,
      toolRegistry: finalToolRegistry,
      middleware: [
        ...(commandMiddleware ? [commandMiddleware] : []),
        ...(sessionEnabled ? sessionSupport.middlewares : []),
        ...(todolistEnabled ? [todolistSupport.middleware] : []),
      ],
      // 头部不带时间上下文——分钟级时间戳在头部会按分钟作废整个 provider
      // 前缀缓存;时间行由装配器在尾部动态 reminder 里现算(R2P-101w,
      // 对齐 Rust 5120a3e)。这里只透传使用方的静态 systemPrompt。
      systemPrompt: options.systemPrompt,
      skillProvider: skillProvider ?? undefined,
      thinkingEnabled: options.thinking?.enabled,
      enablePromptThinking: options.thinking?.promptLevel,
      temperature: options.llm?.temperature,
      requestTimeout: options.limits?.requestTimeout ?? options.llm?.requestTimeout,
      maxSteps: options.limits?.maxSteps,
      compressor: compressorInstance,
      messageAssembler: new MarkdownMessageAssembler(subAgentConfigs),
      // `file:` 附件锚定（R2P-107）：目录绑定会话在构建时即可锚定；
      // 标准会话由宿主晚绑定（session id 尚不存在）。
      attachmentDir: options.session?.sessionDir,
    });

    // Register the delegate tool after construction so it can close over the
    // runner's tool registry (for tool inheritance) and EventEmitter (for
    // sub-agent event forwarding). colts no longer handles this.
    if (subAgentConfigs) {
      const delegateTool = createDelegateTool({
        subAgentConfigs,
        llmProvider: llmClient,
        model: resolvedModel,
        parentToolRegistry: runner.getToolRegistry(),
        parentSkillProvider: runner.skillProvider,
        thinkingEnabled: options.thinking?.enabled,
        temperature: options.llm?.temperature,
        subAgentRunnerFactory: options.delegation?.runnerFactory,
        // 监督者槽晚绑定（R2P-141c）：空槽 = 同步模式；宿主（会话物化）
        // setDelegateSupervisor 后即异步受理。
        supervisorSlot: delegateSupervisorSlot,
        emit: (type: string, data: Record<string, unknown>) => {
          runner.emit(type as keyof RunnerEventMap, data as never);
        },
      });
      runner.registerTool(delegateTool);
    }

    const resolvedConfig: ResolvedRunnerConfig = {
      model: resolvedModel,
      sandbox: !!sandboxInstance,
      enableSession: sessionEnabled,
      enableTodolist: todolistEnabled,
      enableSpecPlan: specPlanEnabled,
      enableCommands: commandsEnabled,
      thinkingEnabled: options.thinking?.enabled ?? false,
      enablePromptThinking: options.thinking?.promptLevel ?? false,
      a2ui: options.a2ui as { enabled: boolean } | undefined,
      builtinTools: toolToggles as Record<string, boolean> | undefined,
      skillDirs: options.skills?.dirs ?? [],
      mcpConfigPaths: mcpConfigPaths,
      builtinToolCount: filteredBuiltinTools.length,
      mcpToolCount: mcpTools.length,
      todolistToolCount: todolistSupport.tools.length,
      specPlanToolCount: specPlanTools.length,
      middlewareNames: [
        ...(commandMiddleware ? [commandMiddleware.name] : []),
        ...(sessionEnabled ? sessionSupport.middlewares.map((m) => m.name) : []),
        ...(todolistEnabled ? [todolistSupport.middleware.name] : []),
      ].filter(Boolean) as string[],
      compressorEnabled: !!compressorInstance,
      contextWindow,
    };

    return new AgentHarness(
      runner,
      resolvedConfig,
      toolMeta,
      skillMeta,
      registeredCommands,
      titleEventSlot,
      delegateSupervisorSlot,
      'store' in sessionSupport ? sessionSupport.store : undefined
    );
  }

  /**
   * Resume an existing session from its directory.
   *
   * @param sessionDir - Absolute path to the session directory
   * @param options - Resume configuration (llm/llmClient + optional overrides)
   * @returns Reconstructed runner and restored state
   */
  static async resume(
    sessionDir: string,
    options: ResumeOptions
  ): Promise<{ runner: AgentHarness; state: AgentState }> {
    const runtime = options.runtime;
    if (!runtime) throw new Error('ResumeOptions.runtime is required');
    const store = SessionStore.fromDir(sessionDir, runtime);

    const meta = await store.getMeta();
    if (!meta) {
      throw new SessionNotFoundError(sessionDir);
    }
    if (!meta.runnerConfig) {
      throw new SessionNotFoundError(sessionDir);
    }

    const state = await store.loadState();
    if (!state) {
      throw new SessionNotFoundError(sessionDir);
    }

    const rc = meta.runnerConfig;
    const runner = await AgentHarness.create({
      runtime,
      llm: {
        client: resolveLLMClient(options),
        model: options.model ?? rc.model,
      },
      // Restore thinking config from snapshot unless caller overrides.
      thinking: {
        enabled: options.thinkingEnabled ?? rc.thinking?.enabled,
        promptLevel: rc.thinking?.promptLevel,
      },
      limits: rc.limits,
      // R2P-239（对齐 Rust 934d8ce 的 resume merge）：宿主(daemon)现读的
      // 压缩策略优先;缺省回落 meta 快照的 enabled 开关(调优字段不落
      // 快照——每次 resume 从 config.yaml 现读)。
      compression: options.compression ?? (rc.compression?.enabled === false ? false : undefined),
      search: rc.search as SearchConfig | undefined,
      workspacePath: meta.workspacePath,
      skills: { dirs: rc.skillDirs },
      tools: {
        mcpConfigPaths: rc.mcpConfigPaths,
        // 宿主 MCP 加载器必须随会话恢复——否则带 MCP 工具的会话冷恢复直接
        // 500（R2P-161b②）：非空快照无 loader 会被 create() 拒绝。
        mcpLoader: options.mcpLoader,
        builtinFilter: rc.builtinTools as Record<string, boolean> | undefined,
        // HITL 桥接必须随会话恢复——否则恢复后的会话静默失去 ask_human 工具
        askHumanHandler: options.askHumanHandler,
      },
      // Host-injected sandbox wins; fall back to the snapshot (which carries
      // only the enabled flag — an enabled snapshot without an instance is
      // rejected by create(), so Node hosts should always pass one).
      sandbox: options.sandbox ?? (rc.sandbox !== undefined ? { enabled: rc.sandbox } : undefined),
      session: { enabled: rc.enableSession, sessionDir },
      todolist: { enabled: rc.enableTodolist },
      specPlan: { enabled: rc.enableSpecPlan },
      commands: { enabled: rc.enableCommands },
      a2ui: rc.a2ui as { enabled: boolean } | undefined,
      source: meta.source,
      delegation: { subAgents: options.subAgents },
    });

    const newState = produce(state, (draft) => {
      draft.config.tools = runner.getToolInfo();
    });

    return { runner, state: newState };
  }

  /**
   * Run agent until completion
   *
   * @param state - Current agent state
   * @param options - Optional run configuration (maxSteps, signal, thinkingEnabled)
   * @returns Final state and run result
   */
  run(state: AgentState, options?: RunOptions): Promise<{ state: AgentState; result: RunResult }> {
    return this.innerRunner.run(state, options);
  }

  /**
   * Register event listener on the underlying runner
   *
   * @param event - Event name (keyof RunnerEventMap)
   * @param handler - Event handler (accepts variadic args from EventEmitter)
   * @returns this for chaining
   */
  on<K extends keyof RunnerEventMap>(event: K, handler: (...args: unknown[]) => void): this {
    this.innerRunner.on(event, handler);
    return this;
  }

  /**
   * Remove an event listener from the underlying runner.
   */
  off<K extends keyof RunnerEventMap>(event: K, handler: (...args: unknown[]) => void): this {
    this.innerRunner.off(event, handler);
    return this;
  }
}
