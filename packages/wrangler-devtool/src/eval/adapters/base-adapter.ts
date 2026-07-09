/**
 * @fileoverview Base execution adapter — shared logic for agent & skill adapters.
 *
 * Handles:
 *   - Temporary workspace creation + fixture file copying
 *   - Env var snapshot/restore (CONC8 pattern)
 *   - Tool call collection via EnhancedRunner events
 *   - AbortController timeout
 *   - EvalTrace assembly from RunResult + collected events
 */

import { copyFile, mkdir, access } from 'node:fs/promises';
import { join, dirname } from 'node:path';

import { EnhancedRunner } from '@agentskillmania/wrangler';
import { createAgentState, addUserMessage, type AgentState } from '@agentskillmania/colts';
import type { RunResult } from '@agentskillmania/colts';

import type { EvalCase, EvalTrace, EvalSuite, ToolCallRecord } from '../types.js';
import type { ExecutionAdapter, AdapterExecuteOptions } from './types.js';

/** Snapshot of env vars to restore after a run. */
interface EnvSnapshot {
  keys: string[];
  originals: Record<string, string | undefined>;
}

export abstract class BaseAdapter implements ExecutionAdapter {
  /**
   * Subclasses implement this to build the initial AgentState (with or without
   * skill pre-loading) before the user message is injected.
   */
  protected abstract buildInitialState(
    runner: EnhancedRunner,
    suite: EvalSuite,
    workspacePath: string
  ): Promise<AgentState>;

  async execute(caseData: EvalCase, options: AdapterExecuteOptions): Promise<EvalTrace> {
    const { suite, workspacePath } = options;
    const startedAt = Date.now();

    // 1. Set up workspace (fixtures)
    await this.setupWorkspace(caseData, workspacePath, suite.target.path);

    // 2. Snapshot env, apply case env
    const envSnapshot = this.snapshotEnv();
    this.applyEnv(caseData);

    try {
      // 3. Create runner
      const runner = await this.createRunner(suite, workspacePath);

      // 4. Wire tool call collection
      const toolCalls = this.collectToolCalls(runner);

      // 5. Build initial state (subclass decides — skill pre-loads here)
      let state = await this.buildInitialState(runner, suite, workspacePath);

      // 6. Inject history (if any) then the main message
      if (caseData.input.history) {
        for (const turn of caseData.input.history) {
          if (turn.role === 'user') {
            state = addUserMessage(state, turn.content);
          }
          // Assistant turns in history are context-only; we skip adding them
          // as the agent didn't actually produce them. Real multi-turn evals
          // would use the runner's conversation flow.
        }
      }
      state = addUserMessage(state, caseData.input.message);

      // 7. Run with timeout
      const maxSteps = suite.sampling.maxSteps ?? 50;
      const result = await runner.run(state, {
        maxSteps,
        temperature: suite.sampling.temperature,
        ...(suite.sampling.model ? { model: suite.sampling.model } : {}),
      });

      const duration = Date.now() - startedAt;
      const answer = this.extractAnswer(result.result);
      const trace: EvalTrace = {
        caseName: caseData.name,
        sampleIndex: options.sampleIndex,
        input: caseData.input.message,
        answer,
        result: result.result,
        toolCalls,
        steps: this.extractSteps(result.result),
        duration,
        workspacePath,
        tokens: result.result.tokens,
      };
      return trace;
    } finally {
      // 8. Restore env
      this.restoreEnv(envSnapshot);
    }
  }

  /** Create an EnhancedRunner configured for this eval run. */
  protected async createRunner(suite: EvalSuite, workspacePath: string): Promise<EnhancedRunner> {
    const opts: Record<string, unknown> = {
      workspacePath,
      skillDirs: this.getSkillDirs(suite),
      enableSession: false,
      enableTodolist: false,
      enableCommands: false,
    };
    if (suite.sampling.model) {
      opts.model = suite.sampling.model;
    }
    return EnhancedRunner.create(opts as Parameters<typeof EnhancedRunner.create>[0]);
  }

  /** Subclasses override to provide skillDirs (agent: project skills; skill: target skill dir). */
  protected getSkillDirs(suite: EvalSuite): string[] {
    const skillsDir = join(suite.target.path, 'skills');
    return [skillsDir];
  }

  /** Copy fixture files into the temporary workspace. */
  protected async setupWorkspace(
    caseData: EvalCase,
    workspacePath: string,
    projectPath: string
  ): Promise<void> {
    if (!caseData.context?.files) return;

    for (const fixture of caseData.context.files) {
      const source = join(projectPath, fixture.source);
      const target = join(workspacePath, fixture.target);

      try {
        await access(source);
        await mkdir(dirname(target), { recursive: true });
        await copyFile(source, target);
      } catch {
        // Source fixture doesn't exist — skip silently; file_exists evaluator
        // will catch the consequence if the test depends on it.
      }
    }
  }

  /** Collect tool:start/tool:end events into ToolCallRecord[]. */
  protected collectToolCalls(runner: EnhancedRunner): ToolCallRecord[] {
    const calls: ToolCallRecord[] = [];
    const pending = new Map<string, ToolCallRecord>();

    runner.on('tool:start', (...args: unknown[]) => {
      const data = args[0] as { action: { id: string; tool: string; arguments: Record<string, unknown> } };
      const record: ToolCallRecord = {
        name: data.action.tool,
        arguments: data.action.arguments,
      };
      pending.set(data.action.id, record);
    });

    runner.on('tool:end', (...args: unknown[]) => {
      const data = args[0] as { result: unknown; callId?: string; isError?: boolean };
      const id = data.callId;
      if (id) {
        const record = pending.get(id);
        if (record) {
          record.result = data.result;
          calls.push(record);
          pending.delete(id);
        }
      }
    });

    return calls;
  }

  /** Extract the final answer text from RunResult. */
  protected extractAnswer(result: RunResult): string {
    return result.type === 'success' ? result.answer : '';
  }

  /** Extract step count from RunResult. */
  protected extractSteps(result: RunResult): number {
    return result.totalSteps;
  }

  // ─── Env var management (CONC8) ────────────────────────

  protected snapshotEnv(): EnvSnapshot {
    const keys = Object.keys(process.env);
    const originals: Record<string, string | undefined> = {};
    for (const key of keys) {
      originals[key] = process.env[key];
    }
    return { keys, originals };
  }

  protected applyEnv(caseData: EvalCase): void {
    if (!caseData.context?.env) return;
    for (const [key, value] of Object.entries(caseData.context.env)) {
      process.env[key] = value;
    }
  }

  protected restoreEnv(snapshot: EnvSnapshot): void {
    // Restore original values
    for (const key of Object.keys(process.env)) {
      if (!(key in snapshot.originals)) {
        delete process.env[key];
      } else {
        process.env[key] = snapshot.originals[key];
      }
    }
    // Re-add any that were deleted
    for (const key of snapshot.keys) {
      if (!(key in process.env) && snapshot.originals[key] !== undefined) {
        process.env[key] = snapshot.originals[key];
      }
    }
  }
}
