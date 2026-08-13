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
import { Sandbox } from '@agentskillmania/sandbox';
import { produce } from 'immer';
import type { ZodTypeAny } from 'zod';

import { MarkdownMessageAssembler } from './markdown-assembler.js';
import { buildTimeContext } from './system-prompt.js';
import type {
  EnhancedRunnerOptions,
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
import { NodeHostEnv } from '../host-env/node-host-env.js';
import { resolveDefaultModel } from '../llm/resolve-model.js';
import { SessionNotFoundError } from '../session/errors.js';
import { SessionStore } from '../session/session-store.js';
import { createSessionSupport } from '../session/support.js';
import { PlanStore } from '../spec-plan/plan-store.js';
import { SpecStore } from '../spec-plan/spec-store.js';
import { createDelegateTool } from '../subagent/delegate-tool.js';
import { createTodolistSupport } from '../todolist/support.js';
import { createA2UITools, A2UIMiddleware } from '../tools/a2ui/index.js';
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
function collectSkillDirs(options: EnhancedRunnerOptions, runtime: HostEnv): string[] {
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
 * EnhancedRunner — Pre-wired AgentRunner with all wrangler runtime mechanisms
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
 * const runner = await EnhancedRunner.create({
 *   llmClient,
 *   model: 'gpt-4',
 *   workspacePath: '/my/project',
 * });
 *
 * const result = await runner.run(initialState);
 * ```
 */
export class EnhancedRunner {
  private readonly innerRunner: AgentRunner;
  private readonly resolvedConfig: ResolvedRunnerConfig;
  /** Tool metadata map: tool name → enriched info with type and enabled state. */
  private readonly toolMetadataMap: Map<string, ToolMetadata>;
  /** Skill metadata list with source paths. */
  private readonly skillMetadataList: SkillMetadata[];
  /** Registered slash command handlers (populated at create() when commands enabled). */
  private commandRegistry: CommandRegistry | null = null;

  private constructor(
    runner: AgentRunner,
    config: ResolvedRunnerConfig,
    toolMetadataMap: Map<string, ToolMetadata>,
    skillMetadataList: SkillMetadata[],
    commandRegistry: CommandRegistry | null = null
  ) {
    this.innerRunner = runner;
    this.resolvedConfig = config;
    this.toolMetadataMap = toolMetadataMap;
    this.commandRegistry = commandRegistry;
    this.skillMetadataList = skillMetadataList;
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
   * Create an EnhancedRunner with all tools and middleware pre-wired
   *
   * @param options - Configuration options
   * @returns Configured EnhancedRunner instance
   */
  static async create(options: EnhancedRunnerOptions): Promise<EnhancedRunner> {
    // runtime 可选：默认 NodeHostEnv（daemon / CLI 零改动，types.ts 契约）；
    // 浏览器扩展等受限宿主显式注入 BrowserHostEnv
    const runtime = options.runtime ?? new NodeHostEnv();
    const workspacePath = options.workspacePath ?? runtime.env.cwd();
    // 斜杠命令注册表（commands 启用时填充，构造时传入实例）
    let registeredCommands: CommandRegistry | null = null;
    // Resolve skill dirs once and reuse across all consumers below (avoids
    // repeated array allocation + repeated runtime.resources.builtinSkillDirs()).
    const resolvedSkillDirs = collectSkillDirs(options, runtime);
    const llmClient = resolveLLMClient(options);

    const sandboxEnabled = options.sandbox?.enabled;

    let sandboxInstance: Sandbox | undefined;
    if (sandboxEnabled) {
      // Pass the full sandbox config through: execution parameters (timeout/
      // allowNetwork/policies) come from the wrangler-level configuration,
      // NOT from the sandbox package's own config.yaml/env (that file serves
      // the standalone CLI/MCP only).
      const { enabled: _enabled, ...sandboxParams } = options.sandbox ?? {};
      sandboxInstance = new Sandbox({ sandboxDir: workspacePath, ...sandboxParams });
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
            list_dir: 'listDir',
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

    // A2UI support (conditional)
    const a2uiEnabled = options.a2ui?.enabled === true; // a2ui already uses { enabled } shape
    const a2uiTools = a2uiEnabled ? createA2UITools() : [];
    const a2uiMiddleware = a2uiEnabled ? [new A2UIMiddleware()] : [];

    // Sub-agent delegation support (conditional)
    // When subAgents are configured, a delegate tool is created and registered
    // AFTER the AgentRunner is built (so it can close over the runner's registry
    // and EventEmitter). See the post-construction registration below.
    const subAgentConfigs =
      options.delegation?.subAgents && options.delegation.subAgents.length > 0
        ? new Map(options.delegation.subAgents.map((sa) => [sa.name, sa]))
        : undefined;

    // Build skill-resource tools (read_skill_resource + run_skill_script) when
    // skill directories are configured. These complement load_skill by giving
    // the agent access to reference docs and bundled scripts.
    // 技能 provider：只认注入（浏览器扩展传 OPFS 适配、daemon 由 agent-session
    // 从 dirs 构造后注入）——引擎 core 不构造 FilesystemSkillProvider，
    // 保持零 node: 依赖，宿主环境决定技能后端
    const skillProvider = options.skills?.provider;
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
        ...a2uiMiddleware,
      ],
      systemPrompt: [buildTimeContext(), options.systemPrompt].filter(Boolean).join('\n\n'),
      skillProvider: skillProvider ?? undefined,
      thinkingEnabled: options.thinking?.enabled,
      enablePromptThinking: options.thinking?.promptLevel,
      temperature: options.llm?.temperature,
      requestTimeout: options.limits?.requestTimeout ?? options.llm?.requestTimeout,
      maxSteps: options.limits?.maxSteps,
      compressor: compressorInstance,
      messageAssembler: new MarkdownMessageAssembler(subAgentConfigs),
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
        ...a2uiMiddleware.map((m) => (m as { name?: string }).name ?? 'a2ui'),
      ].filter(Boolean) as string[],
      compressorEnabled: !!compressorInstance,
      contextWindow,
    };

    return new EnhancedRunner(runner, resolvedConfig, toolMeta, skillMeta, registeredCommands);
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
  ): Promise<{ runner: EnhancedRunner; state: AgentState }> {
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
    const runner = await EnhancedRunner.create({
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
      compression: rc.compression?.enabled === false ? false : undefined,
      search: rc.search as SearchConfig | undefined,
      workspacePath: meta.workspacePath,
      skills: { dirs: rc.skillDirs },
      tools: {
        mcpConfigPaths: rc.mcpConfigPaths,
        builtinFilter: rc.builtinTools as Record<string, boolean> | undefined,
      },
      sandbox: rc.sandbox !== undefined ? { enabled: rc.sandbox } : undefined,
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
