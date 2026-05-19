import {
  AgentRunner,
  FilesystemSkillProvider,
  DefaultContextCompressor,
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
import { discoverGlobalConfigPath } from '../tools/mcp/config-merger.js';
import { createSessionSupport } from '../session/support.js';
import { createTodolistSupport } from '../todolist/support.js';
import { buildTimeContext } from './system-prompt.js';
import { MarkdownMessageAssembler } from './markdown-assembler.js';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { BingScrapeSearchProvider } from '../tools/builtin/bing-scrape-search.js';
import type { Sandbox } from '@agentskillmania/sandbox';
import type { EnhancedRunnerOptions } from './types.js';
import { CommandRegistry } from '../command/registry.js';
import { createCommandMiddleware } from '../command/command-middleware.js';
import { createClearHandler } from '../command/handlers/clear.js';
import { createCompactHandler } from '../command/handlers/compact.js';
import { createSkillsHandler } from '../command/handlers/skills.js';
import { createSkillHandler } from '../command/handlers/skill.js';

function discoverMCPPaths(workspacePath: string): string[] {
  const paths: string[] = [];
  const globalPath = discoverGlobalConfigPath();
  if (existsSync(globalPath)) paths.push(globalPath);
  const localPath = join(workspacePath, 'mcp.json');
  if (existsSync(localPath)) paths.push(localPath);
  return paths;
}

/**
 * EnhancedRunner — Pre-wired AgentRunner with all wrangler runtime mechanisms
 *
 * Wraps colts AgentRunner and pre-configures:
 * - Builtin tools (file operations, shell, web search/fetch)
 * - MCP tools (discovered from global + local mcp.json configs)
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

    const mcpConfigPaths = options.mcpConfigPaths ?? discoverMCPPaths(workspacePath);
    const mcpTools = await loadMCPTools({ configPaths: mcpConfigPaths });

    const sessionSupport = createSessionSupport({
      workspacePath,
      sessionBaseDir: options.sessionBaseDir,
      askHumanHandler: options.askHumanHandler,
    });

    const todolistSupport = createTodolistSupport();

    const allTools: Tool<ZodTypeAny>[] = [
      ...sessionSupport.tools,
      ...builtinTools,
      ...mcpTools,
      ...todolistSupport.tools,
      ...(options.extraTools ?? []),
    ];

    // Build command registry with built-in + custom handlers
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
    let compressorInstance: IContextCompressor | undefined;
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

    const commandMiddleware = createCommandMiddleware(commandRegistry, {
      compressor: compressorInstance,
    });

    const runner = new AgentRunner({
      model: options.model ?? 'glm-5.1',
      llmClient: options.llmClient,
      tools: allTools,
      middleware: [commandMiddleware, sessionSupport.middleware, todolistSupport.middleware],
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
