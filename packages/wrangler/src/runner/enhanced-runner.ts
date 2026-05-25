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
  IContextCompressor,
  CompressionConfig,
} from '@agentskillmania/colts';
import type { ZodTypeAny } from 'zod';
import type { Tool } from '@agentskillmania/colts';
import { createBuiltinTools } from '../tools/builtin/index.js';
import { loadMCPTools } from '../tools/mcp/index.js';
import { createSessionSupport } from '../session/support.js';
import { createTodolistSupport } from '../todolist/support.js';
import { buildTimeContext } from './system-prompt.js';
import { MarkdownMessageAssembler } from './markdown-assembler.js';
import { BingScrapeSearchProvider } from '../tools/builtin/bing-scrape-search.js';
import type { Sandbox } from '@agentskillmania/sandbox';
import type { EnhancedRunnerOptions } from './types.js';
import { CommandRegistry } from '../command/registry.js';
import { createCommandMiddleware } from '../command/command-middleware.js';
import { createClearHandler } from '../command/handlers/clear.js';
import { createCompactHandler } from '../command/handlers/compact.js';
import { createSkillsHandler } from '../command/handlers/skills.js';
import { createSkillHandler } from '../command/handlers/skill.js';
import { createA2UITools, A2UIMiddleware } from '../tools/a2ui/index.js';

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

  private constructor(runner: AgentRunner) {
    this.innerRunner = runner;
  }

  /**
   * Create an EnhancedRunner with all tools and middleware pre-wired
   *
   * @param options - Configuration options
   * @returns Configured EnhancedRunner instance
   */
  static async create(options: EnhancedRunnerOptions): Promise<EnhancedRunner> {
    const workspacePath = options.workspacePath ?? process.cwd();

    const searchProvider = options.searchProvider ?? new BingScrapeSearchProvider();

    let sandboxInstance: Sandbox | undefined;
    if (options.sandbox) {
      const { Sandbox } = await import('@agentskillmania/sandbox');
      sandboxInstance = new Sandbox();
    }

    const builtinTools = createBuiltinTools({
      workspacePath,
      searchProvider,
      sandbox: sandboxInstance,
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

    const sessionEnabled = options.enableSession !== false;
    const sessionSupport = sessionEnabled
      ? createSessionSupport({
          workspacePath,
          sessionBaseDir: options.sessionBaseDir,
          askHumanHandler: options.askHumanHandler,
        })
      : { tools: [] as Tool<ZodTypeAny>[], middleware: { name: 'session' } };

    const todolistEnabled = options.enableTodolist !== false;
    const todolistSupport = todolistEnabled
      ? createTodolistSupport()
      : { tools: [] as Tool<ZodTypeAny>[], middleware: { name: 'todolist' } };

    // A2UI support (conditional)
    const a2uiEnabled = options.a2ui?.enabled === true;
    const a2uiTools = a2uiEnabled ? createA2UITools() : [];
    const a2uiMiddleware = a2uiEnabled ? [new A2UIMiddleware()] : [];

    const allTools: Tool<ZodTypeAny>[] = [
      ...sessionSupport.tools,
      ...filteredBuiltinTools,
      ...mcpTools,
      ...todolistSupport.tools,
      ...a2uiTools,
      ...(options.extraTools ?? []),
    ];

    // Build command registry with built-in + custom handlers (conditional)
    const commandsEnabled = options.enableCommands !== false;
    let commandMiddleware: { name: string } | undefined;
    let compressorInstance: IContextCompressor | undefined;
    if (commandsEnabled) {
      const commandRegistry = new CommandRegistry();
      commandRegistry.register(createClearHandler());
      commandRegistry.register(createCompactHandler());
      if (options.skillDirs && options.skillDirs.length > 0) {
        const skillProvider = new FilesystemSkillProvider(options.skillDirs);
        commandRegistry.register(createSkillsHandler(skillProvider));
        commandRegistry.register(createSkillHandler(skillProvider));
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
          // Auto-detect context window size from llm-client if not explicitly set
          if (!compressionConfig.contextWindowSize) {
            try {
              const meta = (
                options.llmClient as unknown as {
                  getModelMeta?: (model: string) => { contextWindow: number; maxTokens: number };
                }
              ).getModelMeta?.(options.model ?? 'glm-5.1');
              if (meta) {
                compressionConfig.contextWindowSize = meta.contextWindow;
              }
            } catch {
              // Model not found in registry, use message-count fallback
            }
          }
          compressorInstance = new DefaultContextCompressor(
            compressionConfig,
            options.llmClient,
            options.model
          );
        }
      }

      commandMiddleware = createCommandMiddleware(commandRegistry, {
        compressor: compressorInstance,
      });
    }

    // Build tool registry and optionally wrap with confirmation
    let finalToolRegistry: import('@agentskillmania/colts').IToolRegistry | undefined;
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
      model: options.model ?? 'glm-5.1',
      llmClient: options.llmClient,
      tools: finalToolRegistry ? undefined : allTools,
      toolRegistry: finalToolRegistry,
      middleware: [
        ...(commandMiddleware ? [commandMiddleware] : []),
        ...(sessionEnabled ? [sessionSupport.middleware] : []),
        ...(todolistEnabled ? [todolistSupport.middleware] : []),
        ...a2uiMiddleware,
      ],
      systemPrompt: buildTimeContext(),
      skillDirs: options.skillDirs,
      thinkingEnabled: options.thinkingEnabled,
      enablePromptThinking: options.enablePromptThinking,
      requestTimeout: options.requestTimeout,
      maxSteps: options.maxSteps,
      compressor: compressorInstance,
      messageAssembler: new MarkdownMessageAssembler(),
    });

    return new EnhancedRunner(runner);
  }

  /**
   * Run agent until completion
   *
   * @param state - Current agent state
   * @param options - Optional run configuration (maxSteps, signal)
   * @returns Final state and run result
   */
  run(
    state: AgentState,
    options?: { maxSteps?: number; signal?: AbortSignal }
  ): Promise<{ state: AgentState; result: RunResult }> {
    return this.innerRunner.run(state, options);
  }

  /**
   * Stream agent execution until completion
   *
   * @param state - Current agent state
   * @param options - Optional run configuration (maxSteps, signal)
   * @returns Async generator of run stream events
   */
  runStream(
    state: AgentState,
    options?: { maxSteps?: number; signal?: AbortSignal }
  ): AsyncIterable<unknown> {
    return this.innerRunner.runStream(state, options);
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
}
