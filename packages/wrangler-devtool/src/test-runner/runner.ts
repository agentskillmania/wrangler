// packages/wrangler-devtool/src/test-runner/runner.ts
// Execute test cases sequentially

import { mkdir, copyFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { mkdtempSync } from 'node:fs';
import type {
  TestCase,
  TestCaseResult,
  TestSuite,
  TestReport,
  TestCliOptions,
  AgentRunOutput,
  ToolCallRecord,
  RunTestsDeps,
} from './types.js';
import { evaluateAssertion } from './assertions.js';
import { loadTestCases } from './loader.js';
import { evaluateSoft } from './soft-evaluator.js';
import { loadConfig } from '../config.js';

// wrangler imports
import { AgentLoader, CrewLoader, EnhancedRunner, Crew } from '@agentskillmania/wrangler';
import type { EnhancedRunnerOptions, CrewOptions } from '@agentskillmania/wrangler';
import { createAgentState, addUserMessage, addAssistantMessage } from '@agentskillmania/colts';
import type { ILLMProvider } from '@agentskillmania/colts';

export interface TestRunnerDeps {
  llmClient?: ILLMProvider;
  runnerFactory?: (options: EnhancedRunnerOptions) => Promise<EnhancedRunner>;
  crewFactory?: (config: Awaited<ReturnType<CrewLoader['load']>>, options: CrewOptions) => Crew;
}

function defaultRunnerFactory(options: EnhancedRunnerOptions): Promise<EnhancedRunner> {
  return EnhancedRunner.create(options);
}

function defaultCrewFactory(
  config: Awaited<ReturnType<CrewLoader['load']>>,
  options: CrewOptions
): Crew {
  return new Crew(config, options);
}

export class TestRunner {
  private deps: TestRunnerDeps;

  constructor(deps: TestRunnerDeps = {}) {
    this.deps = deps;
  }

  async run(targetPath: string, options: TestCliOptions = {}): Promise<TestReport> {
    const cases = await loadTestCases(targetPath);
    const filteredCases = options.case ? cases.filter((c) => c.name === options.case) : cases;

    if (filteredCases.length === 0) {
      return {
        suites: [],
        summary: { total: 0, passed: 0, failed: 0, duration: 0, hardPassed: 0, hardFailed: 0 },
      };
    }

    const suite: TestSuite = {
      file: targetPath,
      cases: [],
      passed: true,
    };

    const summary: TestReport['summary'] = {
      total: 0,
      passed: 0,
      failed: 0,
      duration: 0,
      hardPassed: 0,
      hardFailed: 0,
    };

    const startTime = Date.now();

    for (const testCase of filteredCases) {
      const result = await this.runCase(testCase, targetPath, options);
      suite.cases.push(result);
      summary.total++;
      if (result.passed) {
        summary.passed++;
      } else {
        summary.failed++;
        suite.passed = false;
      }
      for (const hr of result.hardResults) {
        if (hr.passed) summary.hardPassed++;
        else summary.hardFailed++;
      }
    }

    summary.duration = Date.now() - startTime;

    return {
      suites: [suite],
      summary,
    };
  }

  private async runCase(
    testCase: TestCase,
    targetPath: string,
    options: TestCliOptions
  ): Promise<TestCaseResult> {
    const caseStart = Date.now();
    const workspacePath = this.prepareWorkspace(targetPath);
    let output: AgentRunOutput | undefined;
    let error: string | undefined;

    try {
      // Apply fixtures
      await this.applyFixtures(testCase, targetPath, workspacePath);

      // Apply env vars
      this.applyEnv(testCase);

      // Detect agent vs crew
      const isCrew = existsSync(resolve(targetPath, 'CREW.md'));

      if (isCrew) {
        output = await this.runCrew(testCase, targetPath, workspacePath, options);
      } else {
        output = await this.runAgent(testCase, targetPath, workspacePath, options);
      }
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
      output = {
        answer: '',
        toolCalls: [],
        resultType: 'error',
        totalSteps: 0,
        error: err instanceof Error ? err : new Error(String(err)),
      };
    } finally {
      // Cleanup env vars
      this.cleanupEnv(testCase);
    }

    // Evaluate hard assertions
    const hardAssertions = testCase.expected?.hard ?? [];
    const hardResults = hardAssertions.map((assertion) =>
      evaluateAssertion(assertion, output!, workspacePath)
    );

    let softResults: unknown[] | undefined;
    let allSoftPassed = true;

    // Evaluate soft assertions (if not hard-only mode and no error)
    if (
      !options.hardOnly &&
      !error &&
      testCase.expected?.soft &&
      testCase.expected.soft.length > 0
    ) {
      try {
        const llmConfig = await loadConfig();
        if (llmConfig?.llm) {
          softResults = [];
          for (const softEval of testCase.expected.soft) {
            const result = await evaluateSoft(softEval, output!, llmConfig.llm);
            softResults.push(result);
            if (!result.passed) {
              allSoftPassed = false;
            }
          }
        }
      } catch {
        // Soft evaluation failure is not fatal
        allSoftPassed = false;
      }
    }

    const allHardPassed = hardResults.every((r) => r.passed);
    const passed = allHardPassed && allSoftPassed && !error;

    // Cleanup temp workspace
    try {
      await rm(workspacePath, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }

    return {
      case: testCase,
      passed,
      duration: Date.now() - caseStart,
      hardResults,
      softResults,
      error,
      output,
    };
  }

  private prepareWorkspace(_targetPath: string): string {
    const tempDir = mkdtempSync(join(tmpdir(), 'wrangler-test-'));
    return tempDir;
  }

  private async applyFixtures(
    testCase: TestCase,
    targetPath: string,
    workspacePath: string
  ): Promise<void> {
    if (!testCase.context?.files) return;

    for (const fixture of testCase.context.files) {
      const sourcePath = resolve(targetPath, fixture.source);
      const targetFilePath = resolve(workspacePath, fixture.target);
      await mkdir(dirname(targetFilePath), { recursive: true });
      await copyFile(sourcePath, targetFilePath);
    }
  }

  private applyEnv(testCase: TestCase): void {
    if (!testCase.context?.env) return;
    for (const [key, value] of Object.entries(testCase.context.env)) {
      process.env[key] = value;
    }
  }

  private cleanupEnv(testCase: TestCase): void {
    if (!testCase.context?.env) return;
    for (const key of Object.keys(testCase.context.env)) {
      delete process.env[key];
    }
  }

  private async runAgent(
    testCase: TestCase,
    targetPath: string,
    workspacePath: string,
    options: TestCliOptions
  ): Promise<AgentRunOutput> {
    const agentDef = await AgentLoader.loadFrom(targetPath);

    const runnerFactory = this.deps.runnerFactory ?? defaultRunnerFactory;
    const runner = await runnerFactory({
      llmClient: this.deps.llmClient as ILLMProvider,
      model: agentDef.model ?? 'gpt-4',
      workspacePath,
      skillDirectories: agentDef.skillDirectories,
      mcpConfigPaths: agentDef.mcpPaths,
    });

    let state = createAgentState({
      name: agentDef.name,
      instructions: agentDef.instructions,
      tools: [],
    });

    // Apply multi-turn history if present
    if (testCase.input.history) {
      for (const msg of testCase.input.history) {
        if (msg.role === 'user') {
          state = addUserMessage(state, msg.content);
        } else {
          state = addAssistantMessage(state, msg.content);
        }
      }
    }

    // Add the final user message
    if (testCase.input.message) {
      state = addUserMessage(state, testCase.input.message);
    }

    const toolCalls: ToolCallRecord[] = [];

    runner.on('tool:start', (e: unknown) => {
      const event = e as {
        action: { id: string; tool: string; arguments: Record<string, unknown> };
      };
      toolCalls.push({
        name: event.action.tool,
        args: event.action.arguments,
      });
    });

    const timeoutMs = options.timeout ?? 120000;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const runResult = await runner.run(state, { signal: controller.signal });
      clearTimeout(timeoutId);

      return {
        answer:
          runResult.result.type === 'success'
            ? (runResult.result as { answer: string }).answer
            : '',
        toolCalls,
        resultType: runResult.result.type as 'success' | 'max_steps' | 'error',
        totalSteps: runResult.result.totalSteps,
        error:
          runResult.result.type === 'error'
            ? (runResult.result as { error: Error }).error
            : undefined,
      };
    } catch (err) {
      clearTimeout(timeoutId);
      if (controller.signal.aborted) {
        throw new Error(`Test case timed out after ${timeoutMs}ms`);
      }
      throw err;
    }
  }

  private async runCrew(
    testCase: TestCase,
    targetPath: string,
    workspacePath: string,
    options: TestCliOptions
  ): Promise<AgentRunOutput> {
    const loader = new CrewLoader(targetPath);
    const config = await loader.load();

    const crewFactory = this.deps.crewFactory ?? defaultCrewFactory;
    const crew = crewFactory(config, {
      llmClient: this.deps.llmClient as ILLMProvider,
      defaultModel: 'gpt-4',
      workspaceDeps: { workspacePath },
    });

    const toolCalls: ToolCallRecord[] = [];
    let userResponse = '';
    let hadError = false;
    let errorMsg = '';

    crew.on('user_response', (event: unknown) => {
      userResponse = (event as { content: string }).content;
    });

    crew.on('error', (event: unknown) => {
      hadError = true;
      errorMsg = (event as { error: Error }).error.message;
    });

    crew.on('tool_invoked', (event: unknown) => {
      const ev = event as { toolName: string; args: unknown };
      toolCalls.push({
        name: ev.toolName,
        args: ev.args as Record<string, unknown>,
      });
    });

    // Apply multi-turn history if present (crew only supports final message for now)
    const message = this.buildCrewMessage(testCase);

    const timeoutMs = options.timeout ?? 120000;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
      controller.abort();
      crew.pushInput({ type: 'stop' });
    }, timeoutMs);

    return new Promise<AgentRunOutput>((resolve, _reject) => {
      crew.on('user_response', () => {
        clearTimeout(timeoutId);
        resolve({
          answer: userResponse,
          toolCalls,
          resultType: hadError ? 'error' : 'success',
          totalSteps: 0,
          error: hadError ? new Error(errorMsg) : undefined,
        });
      });

      crew.pushInput({ type: 'user_message', content: message });

      // Fallback: if crew goes idle without user_response, resolve
      const checkInterval = setInterval(() => {
        if (crew.state.status === 'idle') {
          clearInterval(checkInterval);
          clearTimeout(timeoutId);
          resolve({
            answer: userResponse,
            toolCalls,
            resultType: hadError ? 'error' : 'success',
            totalSteps: 0,
            error: hadError ? new Error(errorMsg) : undefined,
          });
        }
      }, 100);

      // Cleanup interval after timeout
      setTimeout(() => clearInterval(checkInterval), timeoutMs + 1000);
    });
  }

  private buildCrewMessage(testCase: TestCase): string {
    if (testCase.input.history && testCase.input.history.length > 0) {
      const parts = testCase.input.history.map((h) => `${h.role}: ${h.content}`);
      if (testCase.input.message) {
        parts.push(`user: ${testCase.input.message}`);
      }
      return parts.join('\n');
    }
    return testCase.input.message ?? '';
  }
}

export async function runTests(
  targetPath: string,
  options: TestCliOptions = {},
  deps: RunTestsDeps = {}
): Promise<TestReport> {
  const runner = new TestRunner(deps as TestRunnerDeps);
  return runner.run(targetPath, options);
}
