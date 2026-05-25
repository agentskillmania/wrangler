// packages/wrangler-devtool/src/devtool.ts
// DevTool facade — single entry point for programmatic usage

import { loadConfig } from './config.js';
import type { LLMConfig } from './config.js';
import { createLLMClient } from './llm.js';
import type { ILLMProvider } from '@agentskillmania/colts';
import { runAgentArchitect, createArchitectRunner } from './agents/architect.js';
import { runSkillDesigner, createSkillDesignerRunner } from './agents/skill-designer.js';
import { runCrewComposer, createCrewComposerRunner } from './agents/crew-composer.js';
import { runReviewer, createReviewerRunner as createReviewerRunnerFn } from './agents/reviewer.js';
import { runSessionCurator, createCuratorRunnerWrapper } from './agents/session-curator.js';
import type { AgentOutput, ReviewReport, SessionSummary, AgentRunOptions } from './agents/types.js';
import type { EnhancedRunner } from '@agentskillmania/wrangler';
import type { AgentState } from '@agentskillmania/colts';
import { initProject } from './tools/init-workspace.js';
import type { InitOptions } from './tools/init-workspace.js';
import { createTemplate } from './tools/create-template.js';
import { applyChanges } from './utils/file-change.js';
import type { FileChange, ApplyOptions, ApplyResult } from './utils/file-change.js';
import { TestRunner } from './test-runner/runner.js';
import type { TestReport, TestCliOptions } from './test-runner/types.js';

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
  private readonly client: ILLMProvider;
  private readonly llmConfig: LLMConfig;
  private readonly _workspacePath: string;
  readonly maxSteps?: number;
  readonly requestTimeout?: number;

  constructor(config: DevToolOptions) {
    validateLLMConfig(config.llm);
    this.llmConfig = config.llm;
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
        'No valid LLM configuration found. Create wrangler.yaml or ~/.agentskillmania/wrangler/config.yaml with llm.provider, llm.apiKey, and llm.model.'
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
      model: options?.model ?? this.llmConfig.model,
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
      model: options?.model ?? this.llmConfig.model,
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
      model: options?.model ?? this.llmConfig.model,
      ...options,
    });
  }

  async runSessionCurator(text: string, options?: AgentRunOptions): Promise<SessionSummary> {
    return runSessionCurator(text, {
      llmClient: this.client,
      workspacePath: this._workspacePath,
      model: options?.model ?? this.llmConfig.model,
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
      model: options?.model ?? this.llmConfig.model,
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
