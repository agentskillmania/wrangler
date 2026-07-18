import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { EvalRunner } from '../../../src/eval/runner.js';
import type { ExecutionAdapter } from '../../../src/eval/adapters/types.js';
import type { EvalSuite, EvalTrace, EvaluatorSpec } from '../../../src/eval/types.js';

// ─── Helpers ────────────────────────────────────────────────

const outputContains: EvaluatorSpec = { type: 'output_contains', value: 'hello' };

function makeSuite(overrides: Partial<EvalSuite> = {}): EvalSuite {
  return {
    name: 'test-suite',
    target: { type: 'agent', path: './', skill: null },
    sampling: { runs: 1, passThreshold: 1 },
    cases: [
      {
        name: 'say-hello',
        input: { message: 'Say hello' },
        evaluators: [outputContains],
      },
    ],
    ...overrides,
  };
}

function makeTrace(caseName: string, sampleIndex: number, answer: string): EvalTrace {
  return {
    caseName,
    sampleIndex,
    input: 'test',
    answer,
    result: { type: 'success', answer, totalSteps: 1, tokens: { input: 5, output: 3 } },
    toolCalls: [],
    steps: 1,
    duration: 100,
    workspacePath: '/tmp/fake',
  };
}

function makeTraceWithTools(caseName: string, sampleIndex: number): EvalTrace {
  return {
    ...makeTrace(caseName, sampleIndex, 'hello'),
    toolCalls: [
      { name: 'file_read', arguments: { path: 'a.txt' }, result: 'content', isError: false },
      { name: 'shell', arguments: { cmd: 'ls' }, result: undefined, isError: true },
    ],
  };
}

/** Create a mock adapter that returns scripted traces per call. */
function createMockAdapter(traces: EvalTrace[]): ExecutionAdapter {
  let callIndex = 0;
  return {
    execute: async (_caseData, options) => {
      const trace = traces[callIndex] ?? traces[traces.length - 1];
      callIndex++;
      return { ...trace, caseName: options.suite.cases[0].name, sampleIndex: options.sampleIndex };
    },
  };
}

// ─── Tests ──────────────────────────────────────────────────

describe('EvalRunner', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'eval-runner-'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  // ── Single run, all pass ───────────────────────────────
  it('passes when all evaluators pass on single run', async () => {
    const suite = makeSuite();
    const adapter = createMockAdapter([makeTrace('say-hello', 0, 'hello world')]);
    const runner = new EvalRunner(suite, { outputDir: tempDir, adapter });

    const { report } = await runner.run();

    expect(report.totalCases).toBe(1);
    expect(report.passed).toBe(1);
    expect(report.failed).toBe(0);
    expect(report.passRate).toBe(1);
    expect(report.cases[0].passed).toBe(true);
    expect(report.cases[0].passCount).toBe(1);
    expect(report.cases[0].samples[0].passed).toBe(true);
  });

  // ── Single run, evaluator fails ────────────────────────
  it('fails case when evaluator does not match', async () => {
    const suite = makeSuite();
    const adapter = createMockAdapter([makeTrace('say-hello', 0, 'goodbye world')]);
    const runner = new EvalRunner(suite, { outputDir: tempDir, adapter });

    const { report } = await runner.run();

    expect(report.cases[0].passed).toBe(false);
    expect(report.cases[0].samples[0].passed).toBe(false);
    expect(report.passed).toBe(0);
    expect(report.failed).toBe(1);
  });

  // ── Multi-run with passThreshold ───────────────────────
  it('passes case when passCount meets threshold (2/3, threshold 0.66)', async () => {
    const suite = makeSuite({
      sampling: { runs: 3, passThreshold: 0.66 },
    });
    // 2 pass, 1 fail → 2/3 = 0.667 >= 0.66 ✓
    const adapter = createMockAdapter([
      makeTrace('say-hello', 0, 'hello'),
      makeTrace('say-hello', 1, 'hello'),
      makeTrace('say-hello', 2, 'nope'),
    ]);
    const runner = new EvalRunner(suite, { outputDir: tempDir, adapter });

    const { report } = await runner.run();

    expect(report.cases[0].passCount).toBe(2);
    expect(report.cases[0].passed).toBe(true);
  });

  it('fails case when passCount below threshold (1/3, threshold 0.66)', async () => {
    const suite = makeSuite({
      sampling: { runs: 3, passThreshold: 0.66 },
    });
    // 1 pass, 2 fail → 1/3 = 0.333 < 0.66 ✗
    const adapter = createMockAdapter([
      makeTrace('say-hello', 0, 'hello'),
      makeTrace('say-hello', 1, 'nope'),
      makeTrace('say-hello', 2, 'nope'),
    ]);
    const runner = new EvalRunner(suite, { outputDir: tempDir, adapter });

    const { report } = await runner.run();

    expect(report.cases[0].passCount).toBe(1);
    expect(report.cases[0].passed).toBe(false);
  });

  // ── Execution error → error trace ──────────────────────
  it('records error trace when adapter throws', async () => {
    const suite = makeSuite();
    const adapter: ExecutionAdapter = {
      execute: async () => {
        throw new Error('LLM timeout');
      },
    };
    const runner = new EvalRunner(suite, { outputDir: tempDir, adapter });

    const { report } = await runner.run();

    expect(report.cases[0].passed).toBe(false);
    expect(report.cases[0].samples[0].passed).toBe(false);
    // The error trace should have result.type === 'error'
    // We can verify via trace file
  });

  // ── Multiple cases ─────────────────────────────────────
  it('handles multiple cases independently', async () => {
    const suite = makeSuite({
      cases: [
        { name: 'case-a', input: { message: 'a' }, evaluators: [outputContains] },
        { name: 'case-b', input: { message: 'b' }, evaluators: [outputContains] },
      ],
    });
    const adapter = createMockAdapter([
      makeTrace('case-a', 0, 'hello'),
      makeTrace('case-b', 0, 'goodbye'),
    ]);
    const runner = new EvalRunner(suite, { outputDir: tempDir, adapter });

    const { report } = await runner.run();

    expect(report.totalCases).toBe(2);
    expect(report.cases[0].passed).toBe(true); // 'hello' contains 'hello'
    expect(report.cases[1].passed).toBe(false); // 'goodbye' does not
    expect(report.passRate).toBe(0.5);
  });

  // ── --runs override ────────────────────────────────────
  it('overrides suite runs with --runs option', async () => {
    const suite = makeSuite({
      sampling: { runs: 1, passThreshold: 1 },
    });
    let callCount = 0;
    const adapter: ExecutionAdapter = {
      execute: async (_caseData, options) => {
        callCount++;
        return makeTrace(options.suite.cases[0].name, options.sampleIndex, 'hello');
      },
    };
    const runner = new EvalRunner(suite, { outputDir: tempDir, adapter, runs: 3 });

    await runner.run();

    expect(callCount).toBe(3);
  });

  // ── report.json written ────────────────────────────────
  it('writes report.json to output dir', async () => {
    const suite = makeSuite();
    const adapter = createMockAdapter([makeTrace('say-hello', 0, 'hello')]);
    const runner = new EvalRunner(suite, { outputDir: tempDir, adapter });

    await runner.run();

    const reportPath = join(tempDir, 'report.json');
    expect(existsSync(reportPath)).toBe(true);
    const written = JSON.parse(readFileSync(reportPath, 'utf-8'));
    expect(written.suite).toBe('test-suite');
    expect(written.cases).toHaveLength(1);
    expect(written.cases[0].passed).toBe(true);
  });

  // ── trace JSONL files written ──────────────────────────
  it('writes JSONL trace files per case per sample', async () => {
    const suite = makeSuite({
      sampling: { runs: 2, passThreshold: 0.5 },
    });
    const adapter = createMockAdapter([
      makeTrace('say-hello', 0, 'hello'),
      makeTrace('say-hello', 1, 'hello'),
    ]);
    const runner = new EvalRunner(suite, { outputDir: tempDir, adapter });

    await runner.run();

    const tracesDir = join(tempDir, 'traces');
    expect(existsSync(tracesDir)).toBe(true);
    const files = readdirSync(tracesDir);
    expect(files).toContain('say-hello.sample-0.jsonl');
    expect(files).toContain('say-hello.sample-1.jsonl');

    // Verify JSONL structure
    const content = readFileSync(join(tracesDir, 'say-hello.sample-0.jsonl'), 'utf-8');
    const lines = content.trim().split('\n');
    const first = JSON.parse(lines[0]);
    expect(first.kind).toBe('meta');
    const inputLine = JSON.parse(lines[1]);
    expect(inputLine.kind).toBe('input');
    const finalLine = JSON.parse(lines[lines.length - 1]);
    expect(finalLine.kind).toBe('stats');
  });

  it('writes tool_call and tool_result lines when trace has tool calls', async () => {
    const suite = makeSuite();
    const adapter = createMockAdapter([makeTraceWithTools('say-hello', 0)]);
    const runner = new EvalRunner(suite, { outputDir: tempDir, adapter });

    await runner.run();

    const content = readFileSync(join(tempDir, 'traces', 'say-hello.sample-0.jsonl'), 'utf-8');
    const lines = content
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l));
    const kinds = lines.map((l) => l.kind);

    expect(kinds).toContain('tool_call');
    expect(kinds).toContain('tool_result');
    // 2 tool calls → 2 tool_call + 2 tool_result lines
    const toolCalls = lines.filter((l) => l.kind === 'tool_call');
    expect(toolCalls).toHaveLength(2);
    expect(toolCalls[0].name).toBe('file_read');
  });

  // ── startedAt/finishedAt set ───────────────────────────
  it('sets startedAt and finishedAt in report', async () => {
    const suite = makeSuite();
    const adapter = createMockAdapter([makeTrace('say-hello', 0, 'hello')]);
    const runner = new EvalRunner(suite, { outputDir: tempDir, adapter });

    const { report } = await runner.run();

    expect(report.startedAt).toBeDefined();
    expect(report.finishedAt).toBeDefined();
    expect(new Date(report.finishedAt).getTime()).toBeGreaterThanOrEqual(
      new Date(report.startedAt).getTime()
    );
  });
});
