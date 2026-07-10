/**
 * @fileoverview EvalRunner — orchestrates sampling, execution, and aggregation.
 *
 * For each case:
 *   1. Run `sampling.runs` times via the adapter
 *   2. Evaluate each trace with all evaluators
 *   3. A sample passes if ALL evaluators pass
 *   4. A case passes if pass_count/runs >= passThreshold
 */

import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import type {
  EvalSuite,
  EvalCase,
  EvalReport,
  CaseReport,
  SampleResult,
  EvalTrace,
} from './types.js';
import type { ExecutionAdapter } from './adapters/types.js';
import { AgentAdapter } from './adapters/agent-adapter.js';
import { SkillAdapter } from './adapters/skill-adapter.js';
import { EvaluatorRegistry, suiteUsesLlmJudge } from './evaluators/index.js';
import type { LlmJudgeOptions } from './evaluators/llm-judge.js';
import { loadEvalLlmConfig } from './config.js';

/** Options for running an eval suite. */
export interface EvalRunnerOptions {
  /** Override suite sampling.runs. */
  runs?: number;
  /** Directory for trace output (default: <cwd>/.eval/runs/<runId>). */
  outputDir?: string;
  /** LLM judge config (auto-loaded if suite uses llm-judge and this is omitted). */
  llmJudgeOptions?: LlmJudgeOptions;
  /** Project dir for auto-loading judge LLM config. */
  projectDir?: string;
  /** Keep temporary workspaces after run (default: false). */
  keepTraces?: boolean;
  /** Inject a custom adapter (testing). If omitted, agent/skill adapter is auto-selected. */
  adapter?: ExecutionAdapter;
}

/** Result of running a suite. */
export interface RunResult {
  report: EvalReport;
  /** Directory where traces and report were written. */
  outputDir: string;
}

/**
 * Run an evaluation suite end-to-end.
 *
 * @param suite - Loaded and validated EvalSuite
 * @param options - Run configuration
 * @returns Report and output directory
 */
export async function runEval(
  suite: EvalSuite,
  options: EvalRunnerOptions = {}
): Promise<RunResult> {
  const runner = new EvalRunner(suite, options);
  return runner.run();
}

/**
 * Stateful runner — useful when you need to inspect intermediate state.
 * Most callers should use the `runEval` function instead.
 */
export class EvalRunner {
  private adapter: ExecutionAdapter;
  private registry: EvaluatorRegistry;
  private suite: EvalSuite;
  private options: EvalRunnerOptions;

  constructor(suite: EvalSuite, options: EvalRunnerOptions = {}) {
    this.suite = suite;
    this.options = options;
    this.adapter = options.adapter ?? (suite.target.type === 'skill' ? new SkillAdapter() : new AgentAdapter());
    this.registry = new EvaluatorRegistry();
  }

  async run(): Promise<RunResult> {
    const startedAt = new Date();
    const runId = this.generateRunId();
    const outputDir = this.options.outputDir ?? join(process.cwd(), '.eval', 'runs', runId);

    await mkdir(outputDir, { recursive: true });
    await mkdir(join(outputDir, 'traces'), { recursive: true });

    // Configure LLM judge if the suite needs it
    const allSpecs = this.suite.cases.flatMap((c) => c.evaluators);
    if (suiteUsesLlmJudge(allSpecs)) {
      const judgeOpts = this.options.llmJudgeOptions ?? (await this.autoLoadJudgeConfig());
      this.registry.configureLlmJudge(judgeOpts);
    }

    const runs = this.options.runs ?? this.suite.sampling.runs;
    const caseReports: CaseReport[] = [];

    for (const caseData of this.suite.cases) {
      const caseReport = await this.runCase(caseData, runs, runId, outputDir);
      caseReports.push(caseReport);
    }

    const finishedAt = new Date();
    const passed = caseReports.filter((c) => c.passed).length;
    const total = caseReports.length;

    const report: EvalReport = {
      suite: this.suite.name,
      runId,
      target: this.suite.target,
      sampling: { ...this.suite.sampling, runs },
      startedAt: startedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
      cases: caseReports,
      totalCases: total,
      passed,
      failed: total - passed,
      passRate: total > 0 ? passed / total : 0,
    };

    // Write report.json
    await writeFile(join(outputDir, 'report.json'), JSON.stringify(report, null, 2), 'utf-8');

    return { report, outputDir };
  }

  /** Execute one case `runs` times and aggregate. */
  private async runCase(
    caseData: EvalCase,
    runs: number,
    runId: string,
    outputDir: string
  ): Promise<CaseReport> {
    const samples: SampleResult[] = [];

    for (let i = 0; i < runs; i++) {
      // Create a fresh temp workspace for each sample
      const workspacePath = await mkdtemp(join(tmpdir(), `eval-${runId}-${caseData.name}-`));

      let trace: EvalTrace;
      try {
        trace = await this.adapter.execute(caseData, {
          suite: this.suite,
          sampleIndex: i,
          workspacePath,
        });
      } catch (err) {
        // Execution failure → record as failed sample with error info
        const errorMsg = err instanceof Error ? err.message : String(err);
        trace = {
          caseName: caseData.name,
          sampleIndex: i,
          input: caseData.input.message,
          answer: '',
          result: { type: 'error', error: err instanceof Error ? err : new Error(errorMsg), totalSteps: 0, tokens: { input: 0, output: 0 } },
          toolCalls: [],
          steps: 0,
          duration: 0,
          workspacePath,
        };
      }

      // Write trace as JSONL
      await this.writeTrace(trace, runId, outputDir);

      // Evaluate
      const results = await this.registry.evaluateAll(trace, caseData.evaluators);
      const passed = results.every((r) => r.passed);
      samples.push({ sampleIndex: i, results, passed });

      // Clean up workspace unless --keep-traces
      if (!this.options.keepTraces) {
        const { rm } = await import('node:fs/promises');
        await rm(workspacePath, { recursive: true, force: true }).catch(() => {});
      }
    }

    const passCount = samples.filter((s) => s.passed).length;
    const passed = runs > 0 && passCount / runs >= this.suite.sampling.passThreshold;

    return {
      name: caseData.name,
      samples,
      passCount,
      passed,
    };
  }

  /** Write a trace as JSONL (one JSON object per line). */
  private async writeTrace(trace: EvalTrace, runId: string, outputDir: string): Promise<void> {
    const filename = `${trace.caseName}.sample-${trace.sampleIndex}.jsonl`;
    const filepath = join(outputDir, 'traces', filename);

    const lines = [
      JSON.stringify({ kind: 'meta', caseName: trace.caseName, sampleIndex: trace.sampleIndex, runId }),
      JSON.stringify({ kind: 'input', message: trace.input }),
    ];

    for (const tc of trace.toolCalls) {
      lines.push(JSON.stringify({ kind: 'tool_call', name: tc.name, arguments: tc.arguments }));
      lines.push(JSON.stringify({ kind: 'tool_result', name: tc.name, result: tc.result, isError: tc.isError }));
    }

    lines.push(JSON.stringify({ kind: 'final', answer: trace.answer, resultType: trace.result.type }));
    lines.push(JSON.stringify({ kind: 'stats', steps: trace.steps, duration: trace.duration, tokens: trace.tokens }));

    await writeFile(filepath, lines.join('\n') + '\n', 'utf-8');
  }

  private generateRunId(): string {
    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    return `${ts}-${this.suite.name}`;
  }

  private async autoLoadJudgeConfig(): Promise<LlmJudgeOptions> {
    const config = await loadEvalLlmConfig(this.options.projectDir);
    return { config };
  }
}
