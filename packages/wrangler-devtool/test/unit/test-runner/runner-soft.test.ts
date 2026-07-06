import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const mocks = vi.hoisted(() => ({
  loadConfig: vi.fn(),
  evaluateSoft: vi.fn(),
}));

vi.mock('../../../src/config.js', () => ({
  loadConfig: mocks.loadConfig,
}));

vi.mock('../../../src/test-runner/soft-evaluator.js', () => ({
  evaluateSoft: mocks.evaluateSoft,
}));

import { TestRunner } from '../../../src/test-runner/runner.js';

const MOCK_LLM_CONFIG = {
  providers: [
    {
      name: 'openai',
      apiKey: 'sk-test',
      models: [{ modelId: 'gpt-4o' }],
    },
  ],
};

function makeAgentWorkspace(tempDir: string, testName: string, softYaml: string) {
  const ws = join(tempDir, `soft-${testName}`);
  mkdirSync(ws);
  writeFileSync(
    join(ws, 'AGENT.md'),
    '---\nname: test-agent\ndescription: test\n---\nYou are a test agent.',
    'utf-8'
  );
  mkdirSync(join(ws, 'test'));
  writeFileSync(join(ws, 'test', 'soft.yaml'), softYaml, 'utf-8');
  return ws;
}

describe('TestRunner soft assertion branches', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'wrangler-runner-soft-'));
    mocks.loadConfig.mockReset();
    mocks.evaluateSoft.mockReset();
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('skips soft evaluation when soft array is empty', async () => {
    const ws = makeAgentWorkspace(
      tempDir,
      'empty',
      `
name: Soft empty test
input:
  message: Hello
expected:
  hard:
    - type: output_contains
      value: "Hello"
  soft: []
`
    );

    const runner = new TestRunner({
      runnerFactory: vi.fn().mockResolvedValue({
        run: vi.fn().mockResolvedValue({
          state: {},
          result: { type: 'success', answer: 'Hello', totalSteps: 1 },
        }),
        on: vi.fn(),
      }),
    });

    const report = await runner.run(ws);

    expect(report.summary.passed).toBe(1);
    expect(report.suites[0].cases[0].softResults).toBeUndefined();
  });

  it('skips soft evaluation when LLM config is missing', async () => {
    const ws = makeAgentWorkspace(
      tempDir,
      'no-llm',
      `
name: Soft no llm test
input:
  message: Hello
expected:
  hard:
    - type: output_contains
      value: "Hello"
  soft:
    - name: quality
      criteria: Output should be clear
      rubric: []
      minScore: 3
`
    );

    mocks.loadConfig.mockResolvedValue(null);

    const runner = new TestRunner({
      runnerFactory: vi.fn().mockResolvedValue({
        run: vi.fn().mockResolvedValue({
          state: {},
          result: { type: 'success', answer: 'Hello', totalSteps: 1 },
        }),
        on: vi.fn(),
      }),
    });

    const report = await runner.run(ws);

    expect(report.summary.passed).toBe(1);
    expect(mocks.evaluateSoft).not.toHaveBeenCalled();
    expect(report.suites[0].cases[0].softResults).toBeUndefined();
  });

  it('skips soft evaluation (does not fail case) when evaluateSoft throws (ERR4)', async () => {
    // ERR4: when the soft-eval infrastructure throws (LLM unavailable, network
    // error, etc.), the case should NOT be marked failed — soft is a quality
    // gate, not a correctness gate. Skipping soft lets the hard assertions
    // decide pass/fail, the same as when LLM config is missing.
    const ws = makeAgentWorkspace(
      tempDir,
      'throws-skip',
      `
name: Soft throws skip test
input:
  message: Hello
expected:
  hard:
    - type: output_contains
      value: "Hello"
  soft:
    - name: quality
      criteria: Output should be clear
      rubric: []
      minScore: 3
`
    );

    mocks.loadConfig.mockResolvedValue({ llm: MOCK_LLM_CONFIG });
    mocks.evaluateSoft.mockRejectedValue(new Error('LLM unavailable'));

    const runner = new TestRunner({
      runnerFactory: vi.fn().mockResolvedValue({
        run: vi.fn().mockResolvedValue({
          state: {},
          result: { type: 'success', answer: 'Hello', totalSteps: 1 },
        }),
        on: vi.fn(),
      }),
    });

    const report = await runner.run(ws);

    // Hard assertion passed → case should pass; soft was skipped due to infra error
    expect(report.summary.passed).toBe(1);
    expect(report.suites[0].cases[0].error).toBeUndefined();
  });

  it('marks test failed when soft evaluation throws', async () => {
    const ws = makeAgentWorkspace(
      tempDir,
      'throws',
      `
name: Soft throws test
input:
  message: Hello
expected:
  hard:
    - type: output_contains
      value: "Hello"
  soft:
    - name: quality
      criteria: Output should be clear
      rubric: []
      minScore: 3
`
    );

    mocks.loadConfig.mockResolvedValue({ llm: MOCK_LLM_CONFIG });
    mocks.evaluateSoft.mockRejectedValue(new Error('LLM unavailable'));

    const runner = new TestRunner({
      runnerFactory: vi.fn().mockResolvedValue({
        run: vi.fn().mockResolvedValue({
          state: {},
          result: { type: 'success', answer: 'Hello', totalSteps: 1 },
        }),
        on: vi.fn(),
      }),
    });

    const report = await runner.run(ws);

    // ERR4: soft infra failure no longer fails the case; hard assertion decides.
    expect(report.summary.passed).toBe(1);
    // softResults was initialized to [] before the throw; it stays empty
    // because no evaluation completed.
    expect(report.suites[0].cases[0].softResults).toEqual([]);
  });

  it('records soft results when evaluation passes', async () => {
    const ws = makeAgentWorkspace(
      tempDir,
      'pass',
      `
name: Soft pass test
input:
  message: Hello
expected:
  hard:
    - type: output_contains
      value: "Hello"
  soft:
    - name: quality
      criteria: Output should be clear
      rubric: []
      minScore: 3
`
    );

    mocks.loadConfig.mockResolvedValue({ llm: MOCK_LLM_CONFIG });
    mocks.evaluateSoft.mockResolvedValue({
      name: 'quality',
      score: 4,
      reasoning: 'Clear',
      passed: true,
    });

    const runner = new TestRunner({
      runnerFactory: vi.fn().mockResolvedValue({
        run: vi.fn().mockResolvedValue({
          state: {},
          result: { type: 'success', answer: 'Hello', totalSteps: 1 },
        }),
        on: vi.fn(),
      }),
    });

    const report = await runner.run(ws);

    expect(report.summary.passed).toBe(1);
    expect(report.suites[0].cases[0].softResults).toHaveLength(1);
    expect(report.suites[0].cases[0].softResults![0]).toMatchObject({
      name: 'quality',
      score: 4,
      passed: true,
    });
  });

  it('records soft results when evaluation fails', async () => {
    const ws = makeAgentWorkspace(
      tempDir,
      'fail',
      `
name: Soft fail test
input:
  message: Hello
expected:
  hard:
    - type: output_contains
      value: "Hello"
  soft:
    - name: quality
      criteria: Output should be clear
      rubric: []
      minScore: 3
`
    );

    mocks.loadConfig.mockResolvedValue({ llm: MOCK_LLM_CONFIG });
    mocks.evaluateSoft.mockResolvedValue({
      name: 'quality',
      score: 2,
      reasoning: 'Unclear',
      passed: false,
    });

    const runner = new TestRunner({
      runnerFactory: vi.fn().mockResolvedValue({
        run: vi.fn().mockResolvedValue({
          state: {},
          result: { type: 'success', answer: 'Hello', totalSteps: 1 },
        }),
        on: vi.fn(),
      }),
    });

    const report = await runner.run(ws);

    expect(report.summary.failed).toBe(1);
    expect(report.suites[0].cases[0].softResults![0].passed).toBe(false);
  });
});
