import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { TestRunner } from '../../../src/test-runner/runner.js';

describe('TestRunner branch coverage', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'wrangler-runner-branch-'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('should handle crew timeout by pushing stop', async () => {
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
      join(tempDir, 'crew-workspace', 'test', 'crew-timeout.yaml'),
      `
name: Crew timeout test
input:
  message: Hello
expected:
  hard:
    - type: output_contains
      value: "Hello"
`,
      'utf-8'
    );

    let crewStatus = 'running';
    const mockCrew = {
      on: vi.fn(),
      pushInput: vi.fn().mockImplementation((input: { type: string }) => {
        if (input.type === 'stop') {
          crewStatus = 'idle';
        }
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

    const report = await runner.run(join(tempDir, 'crew-workspace'), { timeout: 10 });

    expect(report.summary.total).toBe(1);
    // The timeout should have triggered pushInput with stop
    expect(mockCrew.pushInput).toHaveBeenCalledWith(expect.objectContaining({ type: 'stop' }));
  });

  it('should build crew message with history and final message', async () => {
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
      join(tempDir, 'crew-workspace', 'test', 'crew-msg.yaml'),
      `
name: Crew message test
input:
  history:
    - role: user
      content: First
  message: Final
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
    expect(receivedMessage).toContain('user: Final');
  });

  it('should return empty answer and error for agent error result', async () => {
    mkdirSync(join(tempDir, 'agent-workspace'));
    writeFileSync(
      join(tempDir, 'agent-workspace', 'AGENT.md'),
      '---\nname: test-agent\ndescription: test\n---\nYou are a test agent.',
      'utf-8'
    );
    mkdirSync(join(tempDir, 'agent-workspace', 'test'));
    writeFileSync(
      join(tempDir, 'agent-workspace', 'test', 'agent-error.yaml'),
      `
name: Agent error result test
input:
  message: Hello
expected:
  hard:
    - type: output_contains
      value: "Hello"
`,
      'utf-8'
    );

    const runError = new Error('LLM request failed');
    const mockRunner = {
      run: vi.fn().mockResolvedValue({
        state: {},
        result: {
          type: 'error',
          answer: '',
          totalSteps: 1,
          error: runError,
        },
      }),
      on: vi.fn(),
    };

    const runner = new TestRunner({
      runnerFactory: vi.fn().mockResolvedValue(mockRunner),
    });

    const report = await runner.run(join(tempDir, 'agent-workspace'));

    expect(report.summary.total).toBe(1);
    expect(report.suites[0].cases[0].output?.answer).toBe('');
    expect(report.suites[0].cases[0].output?.error).toBe(runError);
    expect(report.suites[0].cases[0].output?.resultType).toBe('error');
  });

  it('should return empty answer for max_steps result', async () => {
    mkdirSync(join(tempDir, 'agent-workspace'));
    writeFileSync(
      join(tempDir, 'agent-workspace', 'AGENT.md'),
      '---\nname: test-agent\ndescription: test\n---\nYou are a test agent.',
      'utf-8'
    );
    mkdirSync(join(tempDir, 'agent-workspace', 'test'));
    writeFileSync(
      join(tempDir, 'agent-workspace', 'test', 'agent-max-steps.yaml'),
      `
name: Agent max steps test
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
        result: {
          type: 'max_steps',
          answer: '',
          totalSteps: 10,
        },
      }),
      on: vi.fn(),
    };

    const runner = new TestRunner({
      runnerFactory: vi.fn().mockResolvedValue(mockRunner),
    });

    const report = await runner.run(join(tempDir, 'agent-workspace'));

    expect(report.summary.total).toBe(1);
    expect(report.suites[0].cases[0].output?.answer).toBe('');
    expect(report.suites[0].cases[0].output?.resultType).toBe('max_steps');
    expect(report.suites[0].cases[0].output?.totalSteps).toBe(10);
  });

  it('should capture crew tool_invoked events', async () => {
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
      join(tempDir, 'crew-workspace', 'test', 'crew-tools.yaml'),
      `
name: Crew tool test
input:
  message: Run a tool
expected:
  hard:
    - type: output_contains
      value: "tool result"
`,
      'utf-8'
    );

    const mockCrew = {
      on: vi.fn().mockImplementation((event: string, handler: (e: unknown) => void) => {
        if (event === 'user_response') {
          setTimeout(() => handler({ content: 'tool result' }), 10);
        }
        if (event === 'tool_invoked') {
          setTimeout(
            () =>
              handler({
                toolName: 'shell',
                args: { command: 'ls' },
              }),
            5
          );
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
    expect(report.suites[0].cases[0].output?.toolCalls).toHaveLength(1);
    expect(report.suites[0].cases[0].output?.toolCalls[0]).toEqual({
      name: 'shell',
      args: { command: 'ls' },
    });
  });
});
