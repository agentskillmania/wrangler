// packages/wrangler-devtool/src/devtool.ts
// DevTool facade — single entry point for programmatic usage

import { loadConfig } from './config.js';
import type { LLMConfig, DevToolConfig as FileDevToolConfig } from './config.js';
import { createLLMClient } from './llm.js';
import { LLMClient } from '@agentskillmania/llm-client';
import { runAgent } from './agents/orchestrator.js';
import { runReviewAgent } from './agents/orchestrator.js';
import type { AgentOutput, ReviewReport, AgentOptions } from './agents/types.js';
import { initWorkspace } from './tools/init-workspace.js';
import type { InitOptions } from './tools/init-workspace.js';
import { createTemplate } from './tools/create-template.js';
import { applyChanges } from './utils/file-change.js';
import type { FileChange, ApplyOptions, ApplyResult } from './utils/file-change.js';
import { TestRunner } from './test-runner/runner.js';
import type { TestReport, TestCliOptions } from './test-runner/types.js';

export interface DevToolOptions {
  llm: LLMConfig;
  maxSteps?: number;
  requestTimeout?: number;
}

function validateLLMConfig(llm: unknown): asserts llm is LLMConfig {
  if (!llm || typeof llm !== 'object') {
    throw new Error('LLM configuration is required');
  }
  const c = llm as Record<string, unknown>;
  if (typeof c.provider !== 'string' || c.provider.length === 0) {
    throw new Error('llm.provider is required and must be a non-empty string');
  }
  if (typeof c.apiKey !== 'string' || c.apiKey.length === 0) {
    throw new Error('llm.apiKey is required and must be a non-empty string');
  }
  if (typeof c.model !== 'string' || c.model.length === 0) {
    throw new Error('llm.model is required and must be a non-empty string');
  }
}

export class DevTool {
  private readonly client: LLMClient;
  private readonly llmConfig: LLMConfig;
  readonly maxSteps?: number;
  readonly requestTimeout?: number;

  constructor(config: DevToolOptions) {
    validateLLMConfig(config.llm);
    this.llmConfig = config.llm;
    this.client = createLLMClient(config.llm);
    this.maxSteps = config.maxSteps;
    this.requestTimeout = config.requestTimeout;
  }

  /**
   * Create a DevTool instance from a config file on disk.
   */
  static async fromConfig(
    cwd?: string,
    options?: { extraPaths?: string[]; skipGlobal?: boolean }
  ): Promise<DevTool> {
    const config = await loadConfig(cwd, {
      extraPaths: options?.extraPaths,
      skipGlobal: options?.skipGlobal,
    });
    if (!config?.llm) {
      throw new Error(
        'No valid LLM configuration found. Create wrangler.yaml or ~/.agentskillmania/wrangler/config.yaml with llm.provider, llm.apiKey, and llm.model.'
      );
    }
    return new DevTool({
      llm: config.llm,
      maxSteps: config.maxSteps,
      requestTimeout: config.requestTimeout,
    });
  }

  // ── Agent methods ──────────────────────────────────────────────

  /**
   * Run the Agent Architect to generate or modify an agent definition.
   */
  async runAgentArchitect(
    prompt: string,
    existingContent?: string,
    options?: AgentOptions
  ): Promise<AgentOutput> {
    const model = options?.model ?? this.llmConfig.model;
    return runAgent(this.client, model, 'architect', prompt, existingContent, options);
  }

  /**
   * Run the Skill Designer to generate or modify a skill definition.
   */
  async runSkillDesigner(
    prompt: string,
    existingContent?: string,
    options?: AgentOptions
  ): Promise<AgentOutput> {
    const model = options?.model ?? this.llmConfig.model;
    return runAgent(this.client, model, 'skill-designer', prompt, existingContent, options);
  }

  /**
   * Run the Crew Composer to generate or modify a crew definition.
   */
  async runCrewComposer(
    prompt: string,
    existingContent?: string,
    options?: AgentOptions
  ): Promise<AgentOutput> {
    const model = options?.model ?? this.llmConfig.model;
    return runAgent(this.client, model, 'crew-composer', prompt, existingContent, options);
  }

  /**
   * Run the Session Curator for session-related operations.
   */
  async runSessionCurator(
    prompt: string,
    existingContent?: string,
    options?: AgentOptions
  ): Promise<AgentOutput> {
    const model = options?.model ?? this.llmConfig.model;
    return runAgent(this.client, model, 'session-curator', prompt, existingContent, options);
  }

  /**
   * Run the Code Reviewer on a target file's content.
   */
  async runReviewer(
    targetPath: string,
    content: string,
    prompt?: string,
    options?: AgentOptions
  ): Promise<ReviewReport> {
    const model = options?.model ?? this.llmConfig.model;
    const reviewPrompt = `Review the following wrangler definition file (${targetPath}):\n\n\`\`\`markdown\n${content}\n\`\`\`\n${prompt ? `\nAdditional focus: ${prompt}` : ''}`;
    return runReviewAgent(this.client, model, reviewPrompt, options);
  }

  // ── File operations ────────────────────────────────────────────

  /**
   * Initialize a new wrangler workspace.
   */
  async initWorkspace(cwd: string, options: InitOptions): Promise<void> {
    return initWorkspace(cwd, options);
  }

  /**
   * Create a new template file (agent, skill, crew, or session).
   */
  async createTemplate(
    type: 'agent' | 'skill' | 'crew' | 'session',
    name: string,
    cwd: string
  ): Promise<string> {
    return createTemplate(type, name, cwd);
  }

  /**
   * Apply structured file changes to disk.
   */
  async applyChanges(
    changes: FileChange[],
    options?: ApplyOptions
  ): Promise<ApplyResult> {
    return applyChanges(changes, options);
  }

  // ── Test runner ────────────────────────────────────────────────

  /**
   * Run test cases against agent or crew definitions.
   */
  async runTests(targetPath: string, options: TestCliOptions = {}): Promise<TestReport> {
    const runner = new TestRunner();
    return runner.run(targetPath, options);
  }
}
