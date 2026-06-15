// packages/wrangler-devtool/src/devtool.ts
// DevTool facade — single entry point for programmatic usage

import type { ILLMProvider, AgentState } from '@agentskillmania/colts';
import { EnhancedRunner, resolveDefaultModel } from '@agentskillmania/wrangler';

import { runAgentArchitect, createArchitectRunner } from './agents/architect.js';
import { runCrewComposer, createCrewComposerRunner } from './agents/crew-composer.js';
import { runReviewer, createReviewerRunner as createReviewerRunnerFn } from './agents/reviewer.js';
import { runSessionCurator, createCuratorRunnerWrapper } from './agents/session-curator.js';
import { runSkillDesigner, createSkillDesignerRunner } from './agents/skill-designer.js';
import type { AgentOutput, ReviewReport, SessionSummary, AgentRunOptions } from './agents/types.js';
import { loadConfig } from './config.js';
import type { LLMConfig } from './config.js';
import { createLLMClient } from './llm.js';
import { TestRunner } from './test-runner/runner.js';
import type { TestReport, TestCliOptions } from './test-runner/types.js';
import { createTemplate } from './tools/create-template.js';
import { initProject } from './tools/init-workspace.js';
import type { InitOptions } from './tools/init-workspace.js';
import { applyChanges } from './utils/file-change.js';
import type { FileChange, ApplyOptions, ApplyResult } from './utils/file-change.js';

export interface DevToolOptions {
  llm: LLMConfig;
  workspacePath?: string;
  maxSteps?: number;
  requestTimeout?: number;
}

function validateLLMConfig(llm: unknown): asserts llm is LLMConfig {
  if (!llm || typeof llm !== 'object') {
    throw new Error('LLM configuration is required');
  }
  const c = llm as Record<string, unknown>;
  if (!Array.isArray(c.providers) || c.providers.length === 0) {
    throw new Error('llm.providers is required and must contain at least one provider');
  }
  const firstProvider = c.providers[0] as Record<string, unknown>;
  if (typeof firstProvider.name !== 'string' || firstProvider.name.length === 0) {
    throw new Error('llm.providers[0].name is required and must be a non-empty string');
  }
  if (typeof firstProvider.apiKey !== 'string' || firstProvider.apiKey.length === 0) {
    throw new Error('llm.providers[0].apiKey is required and must be a non-empty string');
  }
  if (!Array.isArray(firstProvider.models) || firstProvider.models.length === 0) {
    throw new Error('llm.providers[0].models is required and must contain at least one model');
  }
  const firstModel = firstProvider.models[0] as Record<string, unknown>;
  if (typeof firstModel.modelId !== 'string' || firstModel.modelId.length === 0) {
    throw new Error(
      'llm.providers[0].models[0].modelId is required and must be a non-empty string'
    );
  }
}

export class DevTool {
  private readonly client: ILLMProvider;
  private readonly llmConfig: LLMConfig;
  private readonly defaultModel: string;
  private readonly _workspacePath: string;
  readonly maxSteps?: number;
  readonly requestTimeout?: number;

  constructor(config: DevToolOptions) {
    validateLLMConfig(config.llm);
    this.llmConfig = config.llm;
    this.defaultModel = resolveDefaultModel(config.llm.providers);
    this.client = createLLMClient(config.llm);
    this._workspacePath = config.workspacePath ?? process.cwd();
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
        'No valid LLM configuration found. Create wrangler.yaml or ~/.agentskillmania/wrangler/config.yaml with llm.providers containing name, apiKey, and models.'
      );
    }
    return new DevTool({
      llm: config.llm,
      workspacePath: cwd,
      maxSteps: config.maxSteps,
      requestTimeout: config.requestTimeout,
    });
  }

  // ── Agent run methods ──────────────────────────────────────────

  async runAgentArchitect(
    prompt: string,
    existingContent?: string,
    options?: AgentRunOptions
  ): Promise<AgentOutput> {
    return runAgentArchitect(prompt, existingContent, {
      llmClient: this.client,
      workspacePath: this._workspacePath,
      model: options?.model ?? this.defaultModel,
      ...options,
    });
  }

  async runSkillDesigner(
    prompt: string,
    existingContent?: string,
    options?: AgentRunOptions
  ): Promise<AgentOutput> {
    return runSkillDesigner(prompt, existingContent, {
      llmClient: this.client,
      workspacePath: this._workspacePath,
      model: options?.model ?? this.defaultModel,
      ...options,
    });
  }

  async runCrewComposer(
    prompt: string,
    existingContent?: string,
    options?: AgentRunOptions
  ): Promise<AgentOutput> {
    return runCrewComposer(prompt, existingContent, {
      llmClient: this.client,
      workspacePath: this._workspacePath,
      model: options?.model ?? this.defaultModel,
      ...options,
    });
  }

  async runSessionCurator(text: string, options?: AgentRunOptions): Promise<SessionSummary> {
    return runSessionCurator(text, {
      llmClient: this.client,
      workspacePath: this._workspacePath,
      model: options?.model ?? this.defaultModel,
      ...options,
    });
  }

  async runReviewer(
    targetPath: string,
    content: string,
    prompt?: string,
    options?: AgentRunOptions
  ): Promise<ReviewReport> {
    return runReviewer(targetPath, content, prompt, {
      llmClient: this.client,
      workspacePath: this._workspacePath,
      model: options?.model ?? this.defaultModel,
      ...options,
    });
  }

  // ── create*Runner methods ─────────────────────────────────────

  async createArchitectRunner(): Promise<{ runner: EnhancedRunner; state: AgentState }> {
    return createArchitectRunner({
      llmClient: this.client,
      workspacePath: this._workspacePath,
    });
  }

  async createSkillDesignerRunner(): Promise<{ runner: EnhancedRunner; state: AgentState }> {
    return createSkillDesignerRunner({
      llmClient: this.client,
      workspacePath: this._workspacePath,
    });
  }

  async createCrewComposerRunner(): Promise<{ runner: EnhancedRunner; state: AgentState }> {
    return createCrewComposerRunner({
      llmClient: this.client,
      workspacePath: this._workspacePath,
    });
  }

  async createReviewerRunner(): Promise<{ runner: EnhancedRunner; state: AgentState }> {
    return createReviewerRunnerFn({
      llmClient: this.client,
      workspacePath: this._workspacePath,
    });
  }

  async createSessionCuratorRunner(): Promise<{ runner: EnhancedRunner; state: AgentState }> {
    return createCuratorRunnerWrapper({
      llmClient: this.client,
      workspacePath: this._workspacePath,
    });
  }

  // ── File operations ────────────────────────────────────────────

  async initProject(cwd: string, options: InitOptions): Promise<void> {
    return initProject(cwd, options);
  }

  async createTemplate(
    type: 'agent' | 'skill' | 'crew' | 'session',
    name: string,
    cwd: string
  ): Promise<string> {
    return createTemplate(type, name, cwd);
  }

  async applyChanges(changes: FileChange[], options?: ApplyOptions): Promise<ApplyResult> {
    return applyChanges(changes, options);
  }

  // ── Test runner ────────────────────────────────────────────────

  async runTests(targetPath: string, options: TestCliOptions = {}): Promise<TestReport> {
    const runner = new TestRunner();
    return runner.run(targetPath, options);
  }
}
