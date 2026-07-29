import { createRequire } from 'node:module';
import path from 'node:path';

import {
  AgentRunner,
  FilesystemSkillProvider,
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
  LLMQuickInit,
} from '@agentskillmania/colts';
import type { Tool } from '@agentskillmania/colts';
import { Sandbox } from '@agentskillmania/sandbox';
import { produce } from 'immer';
import type { ZodTypeAny } from 'zod';

import { MarkdownMessageAssembler } from './markdown-assembler.js';
import { buildTimeContext } from './system-prompt.js';
import { createDelegateTool } from '../subagent/delegate-tool.js';
import type {
  EnhancedRunnerOptions,
  ResolvedRunnerConfig,
  ToolMetadata,
  SkillMetadata,
  ResumeOptions,
} from './types.js';
import { createCommandMiddleware } from '../command/command-middleware.js';
import { createClearHandler } from '../command/handlers/clear.js';
import { createCompactHandler } from '../command/handlers/compact.js';
import { createSkillHandler } from '../command/handlers/skill.js';
import { createSkillsHandler } from '../command/handlers/skills.js';
import { CommandRegistry } from '../command/registry.js';
import { createLLMClient, resolveDefaultModel } from '../llm/client.js';
import { SessionNotFoundError } from '../session/errors.js';
import { SessionStore } from '../session/session-store.js';
import { createSessionSupport } from '../session/support.js';
import { PlanStore } from '../spec-plan/plan-store.js';
import { SpecStore } from '../spec-plan/spec-store.js';
import { createTodolistSupport } from '../todolist/support.js';
import { createA2UITools, A2UIMiddleware } from '../tools/a2ui/index.js';
import { BingScrapeSearchProvider } from '../tools/builtin/bing-scrape-search.js';
import { createBuiltinTools } from '../tools/builtin/index.js';
import type { SearchProvider } from '../tools/builtin/index.js';
import { SogouScrapeSearchProvider } from '../tools/builtin/sogou-scrape-search.js';
import { loadMCPTools } from '../tools/mcp/index.js';
import { createSpecPlanTools } from '../tools/spec-plan/index.js';

const nodeRequire = typeof require === 'function' ? require : createRequire(import.meta.url);

function resolveSearchProvider(provider?: SearchProvider | 'bing' | 'sogou'): SearchProvider {
  if (!provider || provider === 'sogou') return new SogouScrapeSearchProvider();
  if (provider === 'bing') return new BingScrapeSearchProvider();
  return provider;
}

/**
 * Build the base skill directory list: user-provided skillDirs plus the
 * built-in wrangler spec-plan skills (resolved from the installed package).
 * Returns a fresh array the caller may extend.
 */
function collectSkillDirs(options: EnhancedRunnerOptions): string[] {
  const dirs = [...(options.skillDirs ?? [])];
  try {
    const wranglerRoot = nodeRequire.resolve('@agentskillmania/wrangler/package.json');
    dirs.push(path.join(path.dirname(wranglerRoot), 'dist', 'spec-plan', 'skills'));
  } catch {
    /* package resolution failed — skip built-in skills */
  }
  return dirs;
}

function resolveLLMClient(options: {
  llmClient?: ILLMProvider;
  llm?: LLMQuickInit;
  model?: string;
}): ILLMProvider {
  if (options.llmClient && options.llm) {
    throw new Error(
      'Cannot specify both llmClient and llm. Choose one: injection or quick initialization.'
    );
  }
  if (options.llmClient) return options.llmClient;
  if (options.llm?.providers && options.llm.providers.length > 0) {
    return createLLMClient(options.llm.providers);
  }
  throw new Error('Must specify either llmClient or llm.');
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

  private constructor(
    runner: AgentRunner,
    config: ResolvedRunnerConfig,
    toolMetadataMap: Map<string, ToolMetadata>,
    skillMetadataList: SkillMetadata[]
  ) {
    this.innerRunner = runner;
    this.resolvedConfig = config;
    this.toolMetadataMap = toolMetadataMap;
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
   * Create an EnhancedRunner with all tools and middleware pre-wired
   *
   * @param options - Configuration options
   * @returns Configured EnhancedRunner instance
   */
  static async create(options: EnhancedRunnerOptions): Promise<EnhancedRunner> {
    const workspacePath = options.workspacePath ?? process.cwd();
    const llmClient = resolveLLMClient(options);

    const searchProvider = resolveSearchProvider(options.searchProvider);

    let sandboxInstance: Sandbox | undefined;
    if (options.sandbox) {
      sandboxInstance = new Sandbox({ sandboxDir: workspacePath });
    }

    const builtinTools = createBuiltinTools({
      workspacePath,
      searchProvider,
      sandbox: sandboxInstance,
      askHumanHandler: options.askHumanHandler,
    });

    // Filter builtin tools based on toggle options.
    // When builtinTools is provided, it acts as a whitelist:
    // - Listed with true → include
    // - Listed with false → exclude
    // - Not listed → exclude
    // When omitted → include all (backward compatible)
    const toolToggles = options.builtinTools;
    const filteredBuiltinTools = toolToggles
      ? builtinTools.filter((tool) => {
          // calculate and ask_human are always-on base tools, not toggleable
          if (tool.name === 'calculate' || tool.name === 'ask_human') return true;
          const toggleMap: Record<
            string,
            keyof NonNullable<EnhancedRunnerOptions['builtinTools']>
          > = {
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

    const mcpConfigPaths = options.mcpConfigPaths ?? [];
    const mcpTools = await loadMCPTools({ configPaths: mcpConfigPaths });

    const resolvedModel =
      options.model ??
      (options.llm?.providers ? resolveDefaultModel(options.llm.providers) : 'glm-5.1');

    const sessionEnabled = options.enableSession !== false;
    const sessionSupport = sessionEnabled
      ? createSessionSupport({
          workspacePath,
          sessionBaseDir: options.sessionBaseDir,
          llmClient,
          model: resolvedModel,
          runnerConfigSnapshot: {
            model: resolvedModel,
            skillDirs: options.skillDirs,
            mcpConfigPaths,
            builtinTools: options.builtinTools,
            sandbox: options.sandbox,
            enableSession: options.enableSession,
            enableTodolist: options.enableTodolist,
            enableSpecPlan: options.enableSpecPlan,
            enableCommands: options.enableCommands,
            a2ui: options.a2ui,
            crewId: options.crewId,
          },
          source: options.source,
        })
      : { middlewares: [{ name: 'session' }] };

    const todolistEnabled = options.enableTodolist !== false;
    const todolistSupport = todolistEnabled
      ? createTodolistSupport()
      : { tools: [] as Tool<ZodTypeAny>[], middleware: { name: 'todolist' } };

    // Spec-plan support (conditional)
    const specPlanEnabled = options.enableSpecPlan !== false;
    const specPlanBaseDir = path.join(
      options.sessionBaseDir ?? path.join(workspacePath, '.agentskillmania'),
      'spec-plan'
    );
    const specStore = new SpecStore(path.join(specPlanBaseDir, 'specs'));
    const planStore = new PlanStore(path.join(specPlanBaseDir, 'plans'));
    const specPlanTools = specPlanEnabled ? createSpecPlanTools(specStore, planStore) : [];

    // A2UI support (conditional)
    const a2uiEnabled = options.a2ui?.enabled === true;
    const a2uiTools = a2uiEnabled ? createA2UITools() : [];
    const a2uiMiddleware = a2uiEnabled ? [new A2UIMiddleware()] : [];

    // Sub-agent delegation support (conditional)
    // When subAgents are configured, a delegate tool is created and registered
    // AFTER the AgentRunner is built (so it can close over the runner's registry
    // and EventEmitter). See the post-construction registration below.
    const subAgentConfigs =
      options.subAgents && options.subAgents.length > 0
        ? new Map(options.subAgents.map((sa) => [sa.name, sa]))
        : undefined;

    const allTools: Tool<ZodTypeAny>[] = [
      ...filteredBuiltinTools,
      ...specPlanTools,
      ...mcpTools,
      ...todolistSupport.tools,
      ...a2uiTools,
      ...(options.extraTools ?? []),
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
    for (const tool of options.extraTools ?? []) {
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
    const commandsEnabled = options.enableCommands !== false;
    let commandMiddleware: { name: string } | undefined;
    let compressorInstance: IContextCompressor | undefined;
    if (commandsEnabled) {
      const commandRegistry = new CommandRegistry();
      commandRegistry.register(createClearHandler());
      commandRegistry.register(createCompactHandler());
      {
        // When a2ui is enabled, automatically include the a2ui-generation skill from @agentskillmania/agenui
        const skillDirs = collectSkillDirs(options);
        if (a2uiEnabled) {
          try {
            const agenuiRoot = nodeRequire.resolve('@agentskillmania/agenui/package.json');
            const agenuiSkillsDir = path.join(path.dirname(agenuiRoot), 'dist', 'skills');
            skillDirs.push(agenuiSkillsDir);
          } catch {
            /* agenui not installed — skip */
          }
        }
        if (skillDirs.length > 0) {
          const skillProvider = new FilesystemSkillProvider(skillDirs);
          commandRegistry.register(createSkillsHandler(skillProvider));
          commandRegistry.register(createSkillHandler(skillProvider));
        }
      }
      for (const cmd of options.commands ?? []) {
        commandRegistry.register(cmd);
      }
      // Create compressor instance for both AgentRunner auto-compression and /compact command
      if (options.compression) {
        if (typeof options.compression === 'object' && 'shouldCompress' in options.compression) {
          compressorInstance = options.compression as IContextCompressor;
        } else {
          const compressionConfig = { ...(options.compression as CompressionConfig) };
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
    }

    // Reuse pre-resolved model metadata for diagnostics
    const contextWindow = modelMeta?.contextWindow;

    // Build skill metadata from the resolved skill provider (if any).
    // The AgentRunner's FilesystemSkillProvider is constructed inside AgentRunner
    // from skillDirs, so we list skills from our own provider to capture source.
    const resolvedSkillDirs = collectSkillDirs(options);
    const skillMeta: SkillMetadata[] =
      resolvedSkillDirs.length > 0
        ? new FilesystemSkillProvider(resolvedSkillDirs)
            .listSkills()
            .map((s) => ({ name: s.name, description: s.description, source: s.source }))
        : [];

    // Build tool registry and optionally wrap with confirmation
    let finalToolRegistry: IToolRegistry | undefined;
    if (options.confirmHandler) {
      const toolRegistry = new ToolRegistry();
      for (const tool of allTools) {
        toolRegistry.register(tool);
      }
      finalToolRegistry = new ConfirmableRegistry(toolRegistry, {
        confirm: options.confirmHandler,
        confirmTools: options.confirmTools ?? [],
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
      systemPrompt: buildTimeContext(),
      skillDirs: collectSkillDirs(options),
      thinkingEnabled: options.thinkingEnabled,
      enablePromptThinking: options.enablePromptThinking,
      temperature: options.temperature,
      requestTimeout: options.requestTimeout,
      maxSteps: options.maxSteps,
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
        thinkingEnabled: options.thinkingEnabled,
        temperature: options.temperature,
        subAgentRunnerFactory: options.subAgentRunnerFactory,
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
      thinkingEnabled: options.thinkingEnabled ?? false,
      enablePromptThinking: options.enablePromptThinking ?? false,
      a2ui: options.a2ui,
      builtinTools: toolToggles as Record<string, boolean> | undefined,
      skillDirs: options.skillDirs ?? [],
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

    return new EnhancedRunner(runner, resolvedConfig, toolMeta, skillMeta);
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
    const store = SessionStore.fromDir(sessionDir);

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
      llmClient: resolveLLMClient(options),
      model: options.model ?? rc.model,
      thinkingEnabled: options.thinkingEnabled,
      workspacePath: meta.workspacePath,
      skillDirs: rc.skillDirs,
      mcpConfigPaths: rc.mcpConfigPaths,
      builtinTools: rc.builtinTools,
      sandbox: rc.sandbox,
      enableSession: rc.enableSession,
      enableTodolist: rc.enableTodolist,
      enableSpecPlan: rc.enableSpecPlan,
      enableCommands: rc.enableCommands,
      a2ui: rc.a2ui,
      sessionBaseDir: path.dirname(path.dirname(sessionDir)),
      source: meta.source,
      subAgents: options.subAgents,
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
