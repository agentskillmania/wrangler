import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// Mock EnhancedRunner.create — we test the adapter's orchestration logic,
// not wrangler's actual execution.
const { mockRun, mockOn } = vi.hoisted(() => ({
  mockRun: vi.fn(),
  mockOn: vi.fn(),
}));

vi.mock('@agentskillmania/wrangler', () => ({
  EnhancedRunner: {
    create: vi.fn().mockResolvedValue({
      run: mockRun,
      on: mockOn,
    }),
  },
}));

import { AgentAdapter } from '../../../src/eval/adapters/agent-adapter.js';
import { SkillAdapter } from '../../../src/eval/adapters/skill-adapter.js';
import type { EvalSuite, EvalCase } from '../../../src/eval/types.js';

// ─── Helpers ────────────────────────────────────────────────

function makeSuite(overrides: Partial<EvalSuite> = {}): EvalSuite {
  return {
    name: 'test',
    target: { type: 'agent', path: './', skill: null },
    sampling: { runs: 1, passThreshold: 1 },
    cases: [],
    ...overrides,
  };
}

function makeCase(overrides: Partial<EvalCase> = {}): EvalCase {
  return {
    name: 'test-case',
    input: { message: 'do something' },
    evaluators: [{ type: 'output_contains', value: 'ok' }],
    ...overrides,
  };
}

function mockSuccessResult(answer: string) {
  return {
    state: {},
    result: {
      type: 'success' as const,
      answer,
      totalSteps: 2,
      tokens: { input: 10, output: 5 },
    },
  };
}

describe('AgentAdapter', () => {
  let workspaceDir: string;
  let projectDir: string;

  beforeEach(() => {
    workspaceDir = mkdtempSync(join(tmpdir(), 'eval-adapter-ws-'));
    projectDir = mkdtempSync(join(tmpdir(), 'eval-adapter-proj-'));
    mockRun.mockReset();
    mockOn.mockReset().mockReturnValue(undefined);
  });

  afterEach(() => {
    rmSync(workspaceDir, { recursive: true, force: true });
    rmSync(projectDir, { recursive: true, force: true });
  });

  it('produces a trace with the agent answer', async () => {
    mockRun.mockResolvedValue(mockSuccessResult('Hello World'));
    const adapter = new AgentAdapter();
    const suite = makeSuite({ target: { type: 'agent', path: projectDir, skill: null } });

    const trace = await adapter.execute(makeCase(), {
      suite,
      sampleIndex: 0,
      workspacePath: workspaceDir,
    });

    expect(trace.answer).toBe('Hello World');
    expect(trace.result.type).toBe('success');
    expect(trace.caseName).toBe('test-case');
    expect(trace.sampleIndex).toBe(0);
    expect(trace.input).toBe('do something');
    expect(trace.steps).toBe(2);
    expect(trace.duration).toBeGreaterThanOrEqual(0);
  });

  it('returns empty answer for non-success result', async () => {
    mockRun.mockResolvedValue({
      state: {},
      result: { type: 'max_steps', totalSteps: 50, tokens: { input: 0, output: 0 } },
    });
    const adapter = new AgentAdapter();

    const trace = await adapter.execute(makeCase(), {
      suite: makeSuite({ target: { type: 'agent', path: projectDir, skill: null } }),
      sampleIndex: 0,
      workspacePath: workspaceDir,
    });

    expect(trace.answer).toBe('');
    expect(trace.result.type).toBe('max_steps');
  });

  it('copies fixture files into workspace', async () => {
    // Create a fixture file in the project dir
    const { mkdirSync } = await import('node:fs');
    mkdirSync(join(projectDir, 'fixtures'), { recursive: true });
    writeFileSync(join(projectDir, 'fixtures', 'input.txt'), 'test content');

    mockRun.mockResolvedValue(mockSuccessResult('ok'));
    const adapter = new AgentAdapter();
    const caseData = makeCase({
      context: {
        files: [{ source: 'fixtures/input.txt', target: 'src/input.txt' }],
      },
    });

    await adapter.execute(caseData, {
      suite: makeSuite({ target: { type: 'agent', path: projectDir, skill: null } }),
      sampleIndex: 0,
      workspacePath: workspaceDir,
    });

    const copied = readFileSync(join(workspaceDir, 'src', 'input.txt'), 'utf-8');
    expect(copied).toBe('test content');
  });

  it('sets and restores env vars', async () => {
    const originalValue = process.env.EVAL_TEST_VAR;
    mockRun.mockImplementation(async () => {
      // During execution, the env var should be set
      expect(process.env.EVAL_TEST_VAR).toBe('test-value');
      return mockSuccessResult('ok');
    });

    const adapter = new AgentAdapter();
    const caseData = makeCase({
      context: { env: { EVAL_TEST_VAR: 'test-value' } },
    });

    await adapter.execute(caseData, {
      suite: makeSuite({ target: { type: 'agent', path: projectDir, skill: null } }),
      sampleIndex: 0,
      workspacePath: workspaceDir,
    });

    // After execution, the env var should be restored
    expect(process.env.EVAL_TEST_VAR).toBe(originalValue);
  });

  it('passes sampling temperature and maxSteps to runner.run', async () => {
    mockRun.mockResolvedValue(mockSuccessResult('ok'));
    const adapter = new AgentAdapter();
    const suite = makeSuite({
      sampling: { runs: 1, passThreshold: 1, temperature: 0.5, maxSteps: 10 },
    });

    await adapter.execute(makeCase(), {
      suite,
      sampleIndex: 0,
      workspacePath: workspaceDir,
    });

    expect(mockRun).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ maxSteps: 10, temperature: 0.5 })
    );
  });

  it('collects tool calls from runner events', async () => {
    // Simulate tool:start and tool:end events being emitted during run
    mockRun.mockImplementation(async () => {
      // The adapter registers 'tool:start'/'tool:end' handlers via runner.on()
      // We can't easily trigger them in this mock — but we can verify
      // on() was called with the right event names.
      return mockSuccessResult('ok');
    });

    const adapter = new AgentAdapter();
    await adapter.execute(makeCase(), {
      suite: makeSuite({ target: { type: 'agent', path: projectDir, skill: null } }),
      sampleIndex: 0,
      workspacePath: workspaceDir,
    });

    // Verify on() was called to register tool:start and tool:end listeners
    const eventNames = mockOn.mock.calls.map((c) => c[0]);
    expect(eventNames).toContain('tool:start');
    expect(eventNames).toContain('tool:end');
  });
});

describe('SkillAdapter', () => {
  let workspaceDir: string;

  beforeEach(() => {
    workspaceDir = mkdtempSync(join(tmpdir(), 'eval-skill-ws-'));
    mockRun.mockReset();
    mockOn.mockReset().mockReturnValue(undefined);
  });

  afterEach(() => {
    rmSync(workspaceDir, { recursive: true, force: true });
  });

  it('throws if target.skill is null', async () => {
    const adapter = new SkillAdapter();
    const suite = makeSuite({ target: { type: 'skill', path: './skills', skill: null } });

    await expect(
      adapter.execute(makeCase(), { suite, sampleIndex: 0, workspacePath: workspaceDir })
    ).rejects.toThrow('target.skill');
  });

  it('injects load_skill instruction into initial state', async () => {
    mockRun.mockImplementation(async (state: { context: { messages: Array<{ content: string }> } }) => {
      // Verify the load_skill instruction is in the conversation
      const messages = state.context?.messages ?? [];
      const hasLoadInstruction = messages.some((m) =>
        typeof m.content === 'string' && m.content.includes('load_skill') && m.content.includes('my-skill')
      );
      expect(hasLoadInstruction).toBe(true);
      return mockSuccessResult('ok');
    });

    const adapter = new SkillAdapter();
    const suite = makeSuite({
      target: { type: 'skill', path: './skills', skill: 'my-skill' },
    });

    await adapter.execute(makeCase(), {
      suite,
      sampleIndex: 0,
      workspacePath: workspaceDir,
    });
  });
});
