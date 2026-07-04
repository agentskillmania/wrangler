import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { TestRunner } from '../../../src/test-runner/runner.js';
import type { TestCase, AgentRunOutput } from '../../../src/test-runner/types.js';

function createMockRunner(runResult: AgentRunOutput) {
  return {
    run: vi.fn().mockResolvedValue({
      state: {},
      result: {
        type: runResult.resultType,
        answer: runResult.answer,
        totalSteps: runResult.totalSteps,
        error: runResult.error,
      },
    }),
    on: vi.fn(),
  };
}

describe('TestRunner', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'wrangler-runner-test-'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('should run a single test case with mocked runner', async () => {
    // Create agent workspace
    mkdirSync(join(tempDir, 'agent-workspace'));
    writeFileSync(
      join(tempDir, 'agent-workspace', 'AGENT.md'),
      '---\nname: test-agent\ndescription: test\n---\nYou are a test agent.',
      'utf-8'
    );
    mkdirSync(join(tempDir, 'agent-workspace', 'test'));
    writeFileSync(
      join(tempDir, 'agent-workspace', 'test', 'basic.yaml'),
      `
name: Basic test
input:
  message: Hello
expected:
  hard:
    - type: output_contains
      value: "Hello"
`,
      'utf-8'
    );

    const mockRunner = createMockRunner({
      answer: 'Hello back',
      toolCalls: [],
      resultType: 'success',
      totalSteps: 1,
    });

    const runner = new TestRunner({
      runnerFactory: vi.fn().mockResolvedValue(
        mockRunner as unknown as ReturnType<typeof createMockRunner> & {
          run: () => Promise<unknown>;
        }
      ),
    });

    const report = await runner.run(join(tempDir, 'agent-workspace'));

    expect(report.summary.total).toBe(1);
    expect(report.summary.passed).toBe(1);
    expect(report.summary.failed).toBe(0);
    expect(report.suites[0].cases[0].hardResults[0].passed).toBe(true);
  });

  it('should fail when assertion does not match', async () => {
    mkdirSync(join(tempDir, 'agent-workspace'));
    writeFileSync(
      join(tempDir, 'agent-workspace', 'AGENT.md'),
      '---\nname: test-agent\ndescription: test\n---\nYou are a test agent.',
      'utf-8'
    );
    mkdirSync(join(tempDir, 'agent-workspace', 'test'));
    writeFileSync(
      join(tempDir, 'agent-workspace', 'test', 'fail.yaml'),
      `
name: Failing test
input:
  message: Hello
expected:
  hard:
    - type: output_contains
      value: "goodbye"
`,
      'utf-8'
    );

    const mockRunner = createMockRunner({
      answer: 'Hello back',
      toolCalls: [],
      resultType: 'success',
      totalSteps: 1,
    });

    const runner = new TestRunner({
      runnerFactory: vi.fn().mockResolvedValue(
        mockRunner as unknown as ReturnType<typeof createMockRunner> & {
          run: () => Promise<unknown>;
        }
      ),
    });

    const report = await runner.run(join(tempDir, 'agent-workspace'));

    expect(report.summary.total).toBe(1);
    expect(report.summary.passed).toBe(0);
    expect(report.summary.failed).toBe(1);
    expect(report.suites[0].cases[0].hardResults[0].passed).toBe(false);
  });

  it('should run only the specified case with --case option', async () => {
    mkdirSync(join(tempDir, 'agent-workspace'));
    writeFileSync(
      join(tempDir, 'agent-workspace', 'AGENT.md'),
      '---\nname: test-agent\ndescription: test\n---\nYou are a test agent.',
      'utf-8'
    );
    mkdirSync(join(tempDir, 'agent-workspace', 'test'));
    writeFileSync(
      join(tempDir, 'agent-workspace', 'test', 'multi.yaml'),
      `
- name: Case A
  input:
    message: Hello A
  expected:
    hard:
      - type: output_contains
        value: "A"
- name: Case B
  input:
    message: Hello B
  expected:
    hard:
      - type: output_contains
        value: "B"
`,
      'utf-8'
    );

    const mockRunner = createMockRunner({
      answer: 'Response A',
      toolCalls: [],
      resultType: 'success',
      totalSteps: 1,
    });

    const runner = new TestRunner({
      runnerFactory: vi.fn().mockResolvedValue(
        mockRunner as unknown as ReturnType<typeof createMockRunner> & {
          run: () => Promise<unknown>;
        }
      ),
    });

    const report = await runner.run(join(tempDir, 'agent-workspace'), { case: 'Case B' });

    expect(report.summary.total).toBe(1);
    expect(report.suites[0].cases[0].case.name).toBe('Case B');
  });

  it('should copy fixtures to temp workspace', async () => {
    mkdirSync(join(tempDir, 'agent-workspace'));
    writeFileSync(
      join(tempDir, 'agent-workspace', 'AGENT.md'),
      '---\nname: test-agent\ndescription: test\n---\nYou are a test agent.',
      'utf-8'
    );
    mkdirSync(join(tempDir, 'agent-workspace', 'test'));
    mkdirSync(join(tempDir, 'agent-workspace', 'fixtures'));
    writeFileSync(
      join(tempDir, 'agent-workspace', 'fixtures', 'data.json'),
      '{"key": "value"}',
      'utf-8'
    );
    writeFileSync(
      join(tempDir, 'agent-workspace', 'test', 'fixture.yaml'),
      `
name: Fixture test
input:
  message: Hello
context:
  files:
    - source: fixtures/data.json
      target: data.json
expected:
  hard:
    - type: file_exists
      path: data.json
`,
      'utf-8'
    );

    const mockRunner = createMockRunner({
      answer: 'Hello',
      toolCalls: [],
      resultType: 'success',
      totalSteps: 1,
    });

    const runner = new TestRunner({
      runnerFactory: vi.fn().mockResolvedValue(
        mockRunner as unknown as ReturnType<typeof createMockRunner> & {
          run: () => Promise<unknown>;
        }
      ),
    });

    const report = await runner.run(join(tempDir, 'agent-workspace'));

    expect(report.summary.total).toBe(1);
    expect(report.summary.passed).toBe(1);
    expect(report.suites[0].cases[0].hardResults[0].passed).toBe(true);
  });

  it('should apply and cleanup env vars', async () => {
    mkdirSync(join(tempDir, 'agent-workspace'));
    writeFileSync(
      join(tempDir, 'agent-workspace', 'AGENT.md'),
      '---\nname: test-agent\ndescription: test\n---\nYou are a test agent.',
      'utf-8'
    );
    mkdirSync(join(tempDir, 'agent-workspace', 'test'));
    writeFileSync(
      join(tempDir, 'agent-workspace', 'test', 'env.yaml'),
      `
name: Env test
input:
  message: Hello
context:
  env:
    TEST_VAR: test_value
expected:
  hard:
    - type: output_contains
      value: "Hello"
`,
      'utf-8'
    );

    const mockRunner = createMockRunner({
      answer: 'Hello',
      toolCalls: [],
      resultType: 'success',
      totalSteps: 1,
    });

    const runner = new TestRunner({
      runnerFactory: vi.fn().mockResolvedValue(
        mockRunner as unknown as ReturnType<typeof createMockRunner> & {
          run: () => Promise<unknown>;
        }
      ),
    });

    expect(process.env.TEST_VAR).toBeUndefined();

    await runner.run(join(tempDir, 'agent-workspace'));

    expect(process.env.TEST_VAR).toBeUndefined();
  });

  it('should restore pre-existing env vars on cleanup instead of deleting them', async () => {
    mkdirSync(join(tempDir, 'agent-workspace'));
    writeFileSync(
      join(tempDir, 'agent-workspace', 'AGENT.md'),
      '---\nname: test-agent\ndescription: test\n---\nYou are a test agent.',
      'utf-8'
    );
    mkdirSync(join(tempDir, 'agent-workspace', 'test'));
    writeFileSync(
      join(tempDir, 'agent-workspace', 'test', 'env-override.yaml'),
      `
name: Env override test
input:
  message: Hello
context:
  env:
    TEST_RESTORE_VAR: overridden_value
expected:
  hard:
    - type: output_contains
      value: "Hello"
`,
      'utf-8'
    );

    const mockRunner = createMockRunner({
      answer: 'Hello',
      toolCalls: [],
      resultType: 'success',
      totalSteps: 1,
    });

    const runner = new TestRunner({
      runnerFactory: vi.fn().mockResolvedValue(
        mockRunner as unknown as ReturnType<typeof createMockRunner> & {
          run: () => Promise<unknown>;
        }
      ),
    });

    // Simulate a pre-existing env var that the test case will override.
    const previousValue = process.env.TEST_RESTORE_VAR;
    process.env.TEST_RESTORE_VAR = 'original_value';

    try {
      await runner.run(join(tempDir, 'agent-workspace'));

      // CONC8: cleanup must restore the original value, not delete the key.
      expect(process.env.TEST_RESTORE_VAR).toBe('original_value');
    } finally {
      // Leave the environment as we found it.
      if (previousValue === undefined) delete process.env.TEST_RESTORE_VAR;
      else process.env.TEST_RESTORE_VAR = previousValue;
    }
  });

  it('should track tool calls from runner events', async () => {
    mkdirSync(join(tempDir, 'agent-workspace'));
    writeFileSync(
      join(tempDir, 'agent-workspace', 'AGENT.md'),
      '---\nname: test-agent\ndescription: test\n---\nYou are a test agent.',
      'utf-8'
    );
    mkdirSync(join(tempDir, 'agent-workspace', 'test'));
    writeFileSync(
      join(tempDir, 'agent-workspace', 'test', 'tools.yaml'),
      `
name: Tool test
input:
  message: Run shell
expected:
  hard:
    - type: tool_called
      tool: shell
`,
      'utf-8'
    );

    const mockRunner = {
      run: vi.fn().mockResolvedValue({
        state: {},
        result: { type: 'success', answer: 'done', totalSteps: 1 },
      }),
      on: vi.fn().mockImplementation((event: string, handler: (e: unknown) => void) => {
        if (event === 'tool:start') {
          handler({ action: { id: '1', tool: 'shell', arguments: { command: 'ls' } } });
        }
      }),
    };

    const runner = new TestRunner({
      runnerFactory: vi.fn().mockResolvedValue(
        mockRunner as unknown as ReturnType<typeof createMockRunner> & {
          run: () => Promise<unknown>;
        }
      ),
    });

    const report = await runner.run(join(tempDir, 'agent-workspace'));

    expect(report.summary.passed).toBe(1);
    expect(report.suites[0].cases[0].output?.toolCalls).toHaveLength(1);
    expect(report.suites[0].cases[0].output?.toolCalls[0].name).toBe('shell');
  });

  it('should return empty report when no test cases match --case filter', async () => {
    mkdirSync(join(tempDir, 'agent-workspace'));
    writeFileSync(
      join(tempDir, 'agent-workspace', 'AGENT.md'),
      '---\nname: test-agent\ndescription: test\n---\nYou are a test agent.',
      'utf-8'
    );
    mkdirSync(join(tempDir, 'agent-workspace', 'test'));
    writeFileSync(
      join(tempDir, 'agent-workspace', 'test', 'basic.yaml'),
      `
name: Basic test
input:
  message: Hello
expected:
  hard:
    - type: output_contains
      value: "Hello"
`,
      'utf-8'
    );

    const runner = new TestRunner({
      runnerFactory: vi
        .fn()
        .mockResolvedValue(
          createMockRunner({ answer: 'Hello', toolCalls: [], resultType: 'success', totalSteps: 1 })
        ),
    });

    const report = await runner.run(join(tempDir, 'agent-workspace'), { case: 'NonExistent' });

    expect(report.summary.total).toBe(0);
    expect(report.suites).toHaveLength(0);
  });
});
