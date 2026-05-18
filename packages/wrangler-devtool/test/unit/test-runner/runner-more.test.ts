import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { TestRunner, runTests } from '../../../src/test-runner/runner.js';
import type { AgentRunOutput } from '../../../src/test-runner/types.js';

describe('TestRunner additional scenarios', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'wrangler-runner-more-'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('should handle agent run timeout', async () => {
    mkdirSync(join(tempDir, 'agent-workspace'));
    writeFileSync(
      join(tempDir, 'agent-workspace', 'AGENT.md'),
      '---\nname: test-agent\ndescription: test\n---\nYou are a test agent.',
      'utf-8'
    );
    mkdirSync(join(tempDir, 'agent-workspace', 'test'));
    writeFileSync(
      join(tempDir, 'agent-workspace', 'test', 'timeout.yaml'),
      `
name: Timeout test
input:
  message: Hello
expected:
  hard:
    - type: output_contains
      value: "Hello"
`,
      'utf-8'
    );

    const mockRunner = {
      run: vi.fn().mockImplementation((_state: unknown, options: { signal?: AbortSignal }) => {
        return new Promise((_resolve, reject) => {
          const timer = setTimeout(() => reject(new Error('timeout')), 10000);
          options?.signal?.addEventListener('abort', () => {
            clearTimeout(timer);
            reject(new Error('Aborted'));
          });
        });
      }),
      on: vi.fn(),
    };

    const runner = new TestRunner({
      runnerFactory: vi.fn().mockResolvedValue(mockRunner),
    });

    const report = await runner.run(join(tempDir, 'agent-workspace'), { timeout: 50 });

    expect(report.summary.total).toBe(1);
    expect(report.summary.failed).toBe(1);
    expect(report.suites[0].cases[0].error).toContain('timed out');
  });

  it('should handle agent run error', async () => {
    mkdirSync(join(tempDir, 'agent-workspace'));
    writeFileSync(
      join(tempDir, 'agent-workspace', 'AGENT.md'),
      '---\nname: test-agent\ndescription: test\n---\nYou are a test agent.',
      'utf-8'
    );
    mkdirSync(join(tempDir, 'agent-workspace', 'test'));
    writeFileSync(
      join(tempDir, 'agent-workspace', 'test', 'error.yaml'),
      `
name: Error test
input:
  message: Hello
expected:
  hard:
    - type: output_contains
      value: "Hello"
`,
      'utf-8'
    );

    const mockRunner = {
      run: vi.fn().mockRejectedValue(new Error('Runner exploded')),
      on: vi.fn(),
    };

    const runner = new TestRunner({
      runnerFactory: vi.fn().mockResolvedValue(mockRunner),
    });

    const report = await runner.run(join(tempDir, 'agent-workspace'));

    expect(report.summary.total).toBe(1);
    expect(report.summary.failed).toBe(1);
    expect(report.suites[0].cases[0].error).toBe('Runner exploded');
  });

  it('should run crew tests with mocked crew', async () => {
    mkdirSync(join(tempDir, 'crew-workspace'));
    writeFileSync(
      join(tempDir, 'crew-workspace', 'CREW.md'),
      '---\nname: test-crew\nprimary-agent: primary\n---\nMemory',
      'utf-8'
    );
    mkdirSync(join(tempDir, 'crew-workspace', 'agents'));
    writeFileSync(
      join(tempDir, 'crew-workspace', 'agents', 'primary.md'),
      '---\nname: primary\ndescription: primary agent\n---\nYou are primary.',
      'utf-8'
    );
    mkdirSync(join(tempDir, 'crew-workspace', 'test'));
    writeFileSync(
      join(tempDir, 'crew-workspace', 'test', 'crew.yaml'),
      `
name: Crew test
input:
  message: Hello crew
expected:
  hard:
    - type: output_contains
      value: "crew"
`,
      'utf-8'
    );

    const mockCrew = {
      on: vi.fn().mockImplementation((event: string, handler: (e: unknown) => void) => {
        if (event === 'user_response') {
          setTimeout(() => handler({ content: 'Hello crew response' }), 10);
        }
      }),
      pushInput: vi.fn(),
      state: { status: 'running' },
    };

    const runner = new TestRunner({
      crewFactory: vi.fn().mockReturnValue(mockCrew),
    });

    const report = await runner.run(join(tempDir, 'crew-workspace'));

    expect(report.summary.total).toBe(1);
    expect(report.summary.passed).toBe(1);
    expect(mockCrew.pushInput).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'user_message' })
    );
  });

  it('should handle crew error event', async () => {
    mkdirSync(join(tempDir, 'crew-workspace'));
    writeFileSync(
      join(tempDir, 'crew-workspace', 'CREW.md'),
      '---\nname: test-crew\nprimary-agent: primary\n---\nMemory',
      'utf-8'
    );
    mkdirSync(join(tempDir, 'crew-workspace', 'agents'));
    writeFileSync(
      join(tempDir, 'crew-workspace', 'agents', 'primary.md'),
      '---\nname: primary\ndescription: primary agent\n---\nYou are primary.',
      'utf-8'
    );
    mkdirSync(join(tempDir, 'crew-workspace', 'test'));
    writeFileSync(
      join(tempDir, 'crew-workspace', 'test', 'crew-error.yaml'),
      `
name: Crew error test
input:
  message: Hello
expected:
  hard:
    - type: output_contains
      value: "error"
`,
      'utf-8'
    );

    let crewStatus = 'running';
    const errorHandlers: Array<(e: unknown) => void> = [];
    const userResponseHandlers: Array<(e: unknown) => void> = [];

    const mockCrew = {
      on: vi.fn().mockImplementation((event: string, handler: (e: unknown) => void) => {
        if (event === 'user_response') {
          userResponseHandlers.push(handler);
        }
        if (event === 'error') {
          errorHandlers.push(handler);
        }
      }),
      pushInput: vi.fn().mockImplementation(() => {
        // Fire error first, then user_response
        setTimeout(() => {
          errorHandlers.forEach((h) => h({ error: new Error('something broke') }));
        }, 5);
        setTimeout(() => {
          userResponseHandlers.forEach((h) => h({ content: 'Error: something broke' }));
        }, 10);
      }),
      state: {
        get status() {
          return crewStatus;
        },
      },
    };

    const runner = new TestRunner({
      crewFactory: vi.fn().mockReturnValue(mockCrew),
    });

    const report = await runner.run(join(tempDir, 'crew-workspace'));

    expect(report.summary.total).toBe(1);
    expect(report.suites[0].cases[0].output?.resultType).toBe('error');
  });

  it('should handle crew idle fallback', async () => {
    mkdirSync(join(tempDir, 'crew-workspace'));
    writeFileSync(
      join(tempDir, 'crew-workspace', 'CREW.md'),
      '---\nname: test-crew\nprimary-agent: primary\n---\nMemory',
      'utf-8'
    );
    mkdirSync(join(tempDir, 'crew-workspace', 'agents'));
    writeFileSync(
      join(tempDir, 'crew-workspace', 'agents', 'primary.md'),
      '---\nname: primary\ndescription: primary agent\n---\nYou are primary.',
      'utf-8'
    );
    mkdirSync(join(tempDir, 'crew-workspace', 'test'));
    writeFileSync(
      join(tempDir, 'crew-workspace', 'test', 'crew-idle.yaml'),
      `
name: Crew idle test
input:
  message: Hello
expected:
  hard:
    - type: output_contains
      value: "Hello"
`,
      'utf-8'
    );

    let status = 'running';
    const mockCrew = {
      on: vi.fn().mockImplementation((event: string, handler: (e: unknown) => void) => {
        if (event === 'user_response') {
          // Don't fire user_response, let idle fallback handle it
        }
      }),
      pushInput: vi.fn().mockImplementation(() => {
        setTimeout(() => {
          status = 'idle';
        }, 50);
      }),
      state: {
        get status() {
          return status;
        },
      },
    };

    const runner = new TestRunner({
      crewFactory: vi.fn().mockReturnValue(mockCrew),
    });

    const report = await runner.run(join(tempDir, 'crew-workspace'));

    expect(report.summary.total).toBe(1);
  });

  it('should build crew message with history', async () => {
    mkdirSync(join(tempDir, 'crew-workspace'));
    writeFileSync(
      join(tempDir, 'crew-workspace', 'CREW.md'),
      '---\nname: test-crew\nprimary-agent: primary\n---\nMemory',
      'utf-8'
    );
    mkdirSync(join(tempDir, 'crew-workspace', 'agents'));
    writeFileSync(
      join(tempDir, 'crew-workspace', 'agents', 'primary.md'),
      '---\nname: primary\ndescription: primary agent\n---\nYou are primary.',
      'utf-8'
    );
    mkdirSync(join(tempDir, 'crew-workspace', 'test'));
    writeFileSync(
      join(tempDir, 'crew-workspace', 'test', 'crew-history.yaml'),
      `
name: Crew history test
input:
  history:
    - role: user
      content: First
    - role: assistant
      content: Second
    - role: user
      content: Third
expected:
  hard:
    - type: output_contains
      value: "response"
`,
      'utf-8'
    );

    let receivedMessage = '';
    const mockCrew = {
      on: vi.fn().mockImplementation((event: string, handler: (e: unknown) => void) => {
        if (event === 'user_response') {
          setTimeout(() => handler({ content: 'response' }), 10);
        }
      }),
      pushInput: vi.fn().mockImplementation((input: { content: string }) => {
        receivedMessage = input.content;
      }),
      state: { status: 'running' },
    };

    const runner = new TestRunner({
      crewFactory: vi.fn().mockReturnValue(mockCrew),
    });

    await runner.run(join(tempDir, 'crew-workspace'));

    expect(receivedMessage).toContain('user: First');
    expect(receivedMessage).toContain('assistant: Second');
    expect(receivedMessage).toContain('user: Third');
  });

  it('should run agent with multi-turn history', async () => {
    mkdirSync(join(tempDir, 'agent-workspace'));
    writeFileSync(
      join(tempDir, 'agent-workspace', 'AGENT.md'),
      '---\nname: test-agent\ndescription: test\n---\nYou are a test agent.',
      'utf-8'
    );
    mkdirSync(join(tempDir, 'agent-workspace', 'test'));
    writeFileSync(
      join(tempDir, 'agent-workspace', 'test', 'history.yaml'),
      `
name: History test
input:
  history:
    - role: user
      content: First message
    - role: assistant
      content: First response
  message: Final message
expected:
  hard:
    - type: output_contains
      value: "Hello"
`,
      'utf-8'
    );

    const mockRunner = {
      run: vi.fn().mockResolvedValue({
        state: {},
        result: { type: 'success', answer: 'Hello back', totalSteps: 1 },
      }),
      on: vi.fn(),
    };

    const runner = new TestRunner({
      runnerFactory: vi.fn().mockResolvedValue(mockRunner),
    });

    const report = await runner.run(join(tempDir, 'agent-workspace'));

    expect(report.summary.passed).toBe(1);
    expect(mockRunner.run).toHaveBeenCalled();
  });

  it('should expose runTests function', async () => {
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

    const mockRunner = {
      run: vi.fn().mockResolvedValue({
        state: {},
        result: { type: 'success', answer: 'Hello back', totalSteps: 1 },
      }),
      on: vi.fn(),
    };

    const report = await runTests(
      join(tempDir, 'agent-workspace'),
      {},
      { runnerFactory: vi.fn().mockResolvedValue(mockRunner) }
    );

    expect(report.summary.total).toBe(1);
  });
});
