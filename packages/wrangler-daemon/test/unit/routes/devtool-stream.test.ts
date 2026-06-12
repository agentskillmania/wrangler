import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import Fastify, { type FastifyInstance } from 'fastify';
import { ConfigManager } from '../../../src/core/config-manager.js';
import { devtoolStreamRoutes } from '../../../src/routes/devtool-stream.js';
import { mapDevtoolStreamEvent, getRunner } from '../../../src/routes/devtool-stream.js';
import type { RunStreamEvent } from '@agentskillmania/colts';

// ─── Mock setup ───

const {
  mockCreateArchitectRunner,
  mockCreateSkillDesignerRunner,
  mockCreateReviewerRunner,
  mockParseAgentOutput,
  mockParseReviewReport,
} = vi.hoisted(() => ({
  mockCreateArchitectRunner: vi.fn(),
  mockCreateSkillDesignerRunner: vi.fn(),
  mockCreateReviewerRunner: vi.fn(),
  mockParseAgentOutput: vi.fn(),
  mockParseReviewReport: vi.fn(),
}));

/** Create a mock runner that yields events then returns a final state. */
function makeMockRunner(events: RunStreamEvent[], finalContent = 'generated output') {
  return {
    runStream: vi.fn().mockImplementation(async function* () {
      for (const event of events) {
        yield event;
      }
      return {
        state: {
          id: 'test-state',
          context: {
            messages: [{ role: 'assistant', content: finalContent }],
          },
        },
      };
    }),
  };
}

const mockState = { id: 'init-state', context: { messages: [] } } as any;

vi.mock('@agentskillmania/wrangler-devtool', () => ({
  DevTool: vi.fn().mockImplementation(() => ({
    createArchitectRunner: mockCreateArchitectRunner,
    createSkillDesignerRunner: mockCreateSkillDesignerRunner,
    createCrewComposerRunner: mockCreateArchitectRunner,
    createReviewerRunner: mockCreateReviewerRunner,
  })),
  parseAgentOutput: mockParseAgentOutput,
  parseReviewReport: mockParseReviewReport,
}));

// ─── SSE parsing helper ───

interface ParsedSSE {
  event: string;
  data: unknown;
}

function parseSSE(raw: string): ParsedSSE[] {
  const results: ParsedSSE[] = [];
  const chunks = raw.split('\n\n').filter((c) => c.trim());
  for (const chunk of chunks) {
    const lines = chunk.split('\n');
    let event = '';
    let data = '';
    for (const line of lines) {
      if (line.startsWith('event: ')) event = line.slice(7);
      else if (line.startsWith('data: ')) data = line.slice(6);
    }
    if (event) {
      results.push({ event, data: data ? JSON.parse(data) : {} });
    }
  }
  return results;
}

// ─── Tests ───

describe('mapDevtoolStreamEvent', () => {
  it('maps token to devtool:token', () => {
    const result = mapDevtoolStreamEvent({ type: 'token', token: 'hello' } as RunStreamEvent);
    expect(result).toEqual({ event: 'devtool:token', data: { delta: 'hello' } });
  });

  it('maps thinking to devtool:thinking', () => {
    const result = mapDevtoolStreamEvent({
      type: 'thinking',
      content: 'reasoning text',
    } as RunStreamEvent);
    expect(result).toEqual({ event: 'devtool:thinking', data: { content: 'reasoning text' } });
  });

  it('maps tool:start to devtool:tool-start', () => {
    const result = mapDevtoolStreamEvent({
      type: 'tool:start',
      action: { id: 'c1', tool: 'file_read', arguments: { path: '/a' } },
    } as RunStreamEvent);
    expect(result).toEqual({
      event: 'devtool:tool-start',
      data: { id: 'c1', name: 'file_read', args: { path: '/a' } },
    });
  });

  it('maps tool:end with string result', () => {
    const result = mapDevtoolStreamEvent({
      type: 'tool:end',
      callId: 'c1',
      result: 'content',
    } as RunStreamEvent);
    expect(result).toEqual({
      event: 'devtool:tool-end',
      data: { callId: 'c1', result: 'content' },
    });
  });

  it('maps tool:end with object result as JSON string', () => {
    const result = mapDevtoolStreamEvent({
      type: 'tool:end',
      callId: 'c1',
      result: { error: 'fail' },
    } as RunStreamEvent);
    expect(result!.event).toBe('devtool:tool-end');
    expect((result!.data as { result: string }).result).toContain('"error"');
  });

  it('maps error event', () => {
    const result = mapDevtoolStreamEvent({
      type: 'error',
      error: new Error('boom'),
    } as RunStreamEvent);
    expect(result).toEqual({ event: 'devtool:error', data: { message: 'boom' } });
  });

  it('returns null for complete event', () => {
    const result = mapDevtoolStreamEvent({ type: 'complete' } as RunStreamEvent);
    expect(result).toBeNull();
  });

  it('returns null for step:start event', () => {
    const result = mapDevtoolStreamEvent({ type: 'step:start' } as RunStreamEvent);
    expect(result).toBeNull();
  });

  it('returns null for unknown event types', () => {
    const result = mapDevtoolStreamEvent({
      type: 'skill:start',
      name: 'x',
      task: 'y',
    } as RunStreamEvent);
    expect(result).toBeNull();
  });

  it('returns null for phase-change event', () => {
    const result = mapDevtoolStreamEvent({ type: 'phase-change' } as RunStreamEvent);
    expect(result).toBeNull();
  });
});

describe('Devtool Stream API', () => {
  let fastify: FastifyInstance;
  let tempDir: string;
  let configManager: ConfigManager;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'daemon-devtool-stream-'));
    const configPath = join(tempDir, 'config.yaml');
    await writeFile(
      configPath,
      `llm:\n  baseUrl: 'https://api.example.com'\n  apiKey: sk-test\n  model: deepseek-chat\nserver:\n  port: 3100\n  host: localhost\n`
    );

    configManager = new ConfigManager(configPath);
    await configManager.init();

    fastify = Fastify();
    fastify.decorate('configManager', configManager);
    await fastify.register(devtoolStreamRoutes);
    await fastify.listen({ port: 0, host: '127.0.0.1' });

    mockCreateArchitectRunner.mockReset();
    mockCreateReviewerRunner.mockReset();
    mockParseAgentOutput.mockReset();
    mockParseReviewReport.mockReset();
  });

  afterEach(async () => {
    await fastify.close();
    await rm(tempDir, { recursive: true, force: true });
  });

  function getUrl(): string {
    const addr = fastify.addresses()[0];
    return typeof addr === 'string' ? addr : `http://127.0.0.1:${addr.port}`;
  }

  describe('POST /api/devtool/agent/generate/stream', () => {
    it('returns 400 when prompt is missing', async () => {
      const res = await fetch(`${getUrl()}/api/devtool/agent/generate/stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe('prompt is required');
    });

    it('single round streams generation-done and complete events', async () => {
      const runner = makeMockRunner([{ type: 'token', token: 'hello' } as any]);
      mockCreateArchitectRunner.mockResolvedValue({ runner, state: mockState });
      mockParseAgentOutput.mockReturnValue({ changes: [], summary: 'done' });

      const res = await fetch(`${getUrl()}/api/devtool/agent/generate/stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: 'Create agent', maxRounds: 1 }),
      });

      expect(res.status).toBe(200);
      const raw = await res.text();
      const events = parseSSE(raw);
      const eventTypes = events.map((e) => e.event);

      expect(eventTypes).toContain('devtool:round-start');
      expect(eventTypes).toContain('devtool:generation-done');
      expect(eventTypes).toContain('devtool:complete');
      expect(eventTypes).not.toContain('devtool:review-start');

      const completeEvent = events.find((e) => e.event === 'devtool:complete');
      expect(completeEvent!.data).toHaveProperty('output');
    });

    it('streams devtool:error on DevTool exception', async () => {
      mockCreateArchitectRunner.mockRejectedValue(new Error('LLM unavailable'));

      const res = await fetch(`${getUrl()}/api/devtool/agent/generate/stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: 'Create agent' }),
      });

      expect(res.status).toBe(200);
      const raw = await res.text();
      const events = parseSSE(raw);
      const errorEvent = events.find((e) => e.event === 'devtool:error');
      expect(errorEvent).toBeDefined();
      expect((errorEvent!.data as { message: string }).message).toBe('LLM unavailable');
    });

    it('streams token events during generation', async () => {
      const runner = makeMockRunner([
        { type: 'token', token: 'hello' } as any,
        { type: 'token', token: ' world' } as any,
      ]);
      mockCreateArchitectRunner.mockResolvedValue({ runner, state: mockState });
      mockParseAgentOutput.mockReturnValue({ changes: [], summary: 'done' });

      const res = await fetch(`${getUrl()}/api/devtool/agent/generate/stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: 'Create agent', maxRounds: 1 }),
      });

      const raw = await res.text();
      const events = parseSSE(raw);
      const tokenEvents = events.filter((e) => e.event === 'devtool:token');
      expect(tokenEvents).toHaveLength(2);
      expect((tokenEvents[0].data as { delta: string }).delta).toBe('hello');
    });

    it('multi-round with passing review stops after first pass', async () => {
      const genRunner = makeMockRunner([{ type: 'token', token: 'gen' } as any]);
      mockCreateArchitectRunner.mockResolvedValue({ runner: genRunner, state: mockState });
      mockParseAgentOutput.mockReturnValue({ changes: [], summary: 'generated' });

      // Review passes on first attempt
      const reviewRunner = makeMockRunner([{ type: 'token', token: 'review' } as any]);
      mockCreateReviewerRunner.mockResolvedValue({ runner: reviewRunner, state: mockState });
      mockParseReviewReport.mockReturnValue({
        overallScore: 5,
        dimensions: {
          clarity: { score: 5, reasoning: 'clear' },
          completeness: { score: 5, reasoning: 'complete' },
          focus: { score: 5, reasoning: 'focused' },
          safety: { score: 5, reasoning: 'safe' },
          efficiency: { score: 5, reasoning: 'efficient' },
        },
        issues: [],
        summary: 'passed',
      });

      const res = await fetch(`${getUrl()}/api/devtool/agent/generate/stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: 'Create agent', maxRounds: 3 }),
      });

      const raw = await res.text();
      const events = parseSSE(raw);

      // Should have review-start and review-done (review was triggered)
      expect(events.some((e) => e.event === 'devtool:review-start')).toBe(true);
      expect(events.some((e) => e.event === 'devtool:review-done')).toBe(true);

      // review-done should indicate passed
      const reviewDone = events.find((e) => e.event === 'devtool:review-done');
      expect((reviewDone!.data as { passed: boolean }).passed).toBe(true);

      // Only 1 round-start (stopped after first pass)
      const roundStarts = events.filter((e) => e.event === 'devtool:round-start');
      expect(roundStarts).toHaveLength(1);
    });

    it('multi-round with failing review retries', async () => {
      const genRunner = makeMockRunner([{ type: 'token', token: 'gen' } as any]);
      mockCreateArchitectRunner.mockResolvedValue({ runner: genRunner, state: mockState });
      mockParseAgentOutput.mockReturnValue({ changes: [], summary: 'generated' });

      // Review fails first, passes second
      const reviewRunner = makeMockRunner([{ type: 'token', token: 'review' } as any]);
      mockCreateReviewerRunner.mockResolvedValue({ runner: reviewRunner, state: mockState });

      const failReport = {
        overallScore: 2,
        dimensions: {
          clarity: { score: 2, reasoning: 'unclear' },
          completeness: { score: 2, reasoning: 'incomplete' },
          focus: { score: 2, reasoning: 'unfocused' },
          safety: { score: 2, reasoning: 'unsafe' },
          efficiency: { score: 2, reasoning: 'inefficient' },
        },
        issues: [],
        summary: 'failed',
      };
      const passReport = {
        overallScore: 5,
        dimensions: {
          clarity: { score: 5, reasoning: 'clear' },
          completeness: { score: 5, reasoning: 'complete' },
          focus: { score: 5, reasoning: 'focused' },
          safety: { score: 5, reasoning: 'safe' },
          efficiency: { score: 5, reasoning: 'efficient' },
        },
        issues: [],
        summary: 'passed',
      };
      mockParseReviewReport.mockReturnValueOnce(failReport).mockReturnValueOnce(passReport);

      const res = await fetch(`${getUrl()}/api/devtool/agent/generate/stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: 'Create agent', maxRounds: 3 }),
      });

      const raw = await res.text();
      const events = parseSSE(raw);

      // Should have 2 round-starts (2 rounds of generation)
      const roundStarts = events.filter((e) => e.event === 'devtool:round-start');
      expect(roundStarts).toHaveLength(2);

      // Should have 2 generation-done events
      const genDone = events.filter((e) => e.event === 'devtool:generation-done');
      expect(genDone).toHaveLength(2);
    });

    it('falls back to raw output when parseAgentOutput throws', async () => {
      const rawOutput = 'unparseable agent content';
      const runner = makeMockRunner([{ type: 'token', token: 'gen' } as any], rawOutput);
      mockCreateArchitectRunner.mockResolvedValue({ runner, state: mockState });
      mockParseAgentOutput.mockImplementation(() => {
        throw new Error('parse failed');
      });

      const res = await fetch(`${getUrl()}/api/devtool/agent/generate/stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: 'Create agent', maxRounds: 1 }),
      });

      expect(res.status).toBe(200);
      const raw = await res.text();
      const events = parseSSE(raw);
      const completeEvent = events.find((e) => e.event === 'devtool:complete');
      expect(completeEvent).toBeDefined();
      expect((completeEvent!.data as { output: { summary: string } }).output.summary).toBe(
        rawOutput
      );
    });

    it('treats unparseable review report as passed and stops', async () => {
      const genRunner = makeMockRunner([{ type: 'token', token: 'gen' } as any]);
      mockCreateArchitectRunner.mockResolvedValue({ runner: genRunner, state: mockState });
      mockParseAgentOutput.mockReturnValue({ changes: [], summary: 'generated' });

      const reviewRunner = makeMockRunner([{ type: 'token', token: 'review' } as any]);
      mockCreateReviewerRunner.mockResolvedValue({ runner: reviewRunner, state: mockState });
      mockParseReviewReport.mockImplementation(() => {
        throw new Error('bad report');
      });

      const res = await fetch(`${getUrl()}/api/devtool/agent/generate/stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: 'Create agent', maxRounds: 3 }),
      });

      const raw = await res.text();
      const events = parseSSE(raw);

      const reviewDone = events.find((e) => e.event === 'devtool:review-done');
      expect(reviewDone).toBeDefined();
      expect((reviewDone!.data as { passed: boolean }).passed).toBe(true);

      const roundStarts = events.filter((e) => e.event === 'devtool:round-start');
      expect(roundStarts).toHaveLength(1);
    });

    it('getRunner throws for unknown prompt name', async () => {
      const fakeDevTool = {
        createArchitectRunner: vi.fn(),
        createSkillDesignerRunner: vi.fn(),
        createCrewComposerRunner: vi.fn(),
      } as any;

      await expect(getRunner(fakeDevTool, 'unknown-prompt')).rejects.toThrow(
        'Unknown prompt: unknown-prompt'
      );
    });

    it('streams skill generation via /api/devtool/skill/generate/stream', async () => {
      const runner = makeMockRunner([{ type: 'token', token: 'skill' } as any]);
      mockCreateSkillDesignerRunner.mockResolvedValue({ runner, state: mockState });
      mockParseAgentOutput.mockReturnValue({ changes: [], summary: 'skill done' });

      const res = await fetch(`${getUrl()}/api/devtool/skill/generate/stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: 'Create skill', maxRounds: 1 }),
      });

      expect(res.status).toBe(200);
      const raw = await res.text();
      const events = parseSSE(raw);
      expect(events.some((e) => e.event === 'devtool:generation-done')).toBe(true);
      expect(events.some((e) => e.event === 'devtool:complete')).toBe(true);
    });

    it('streams crew generation via /api/devtool/crew/generate/stream', async () => {
      const runner = makeMockRunner([{ type: 'token', token: 'crew' } as any]);
      mockCreateArchitectRunner.mockResolvedValue({ runner, state: mockState });
      mockParseAgentOutput.mockReturnValue({ changes: [], summary: 'crew done' });

      const res = await fetch(`${getUrl()}/api/devtool/crew/generate/stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: 'Create crew', maxRounds: 1 }),
      });

      expect(res.status).toBe(200);
      const raw = await res.text();
      const events = parseSSE(raw);
      expect(events.some((e) => e.event === 'devtool:generation-done')).toBe(true);
      expect(events.some((e) => e.event === 'devtool:complete')).toBe(true);
    });
  });

  describe('POST /api/devtool/review/stream', () => {
    it('returns 400 when content is missing', async () => {
      const res = await fetch(`${getUrl()}/api/devtool/review/stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe('content is required');
    });

    it('streams review complete with parsed report', async () => {
      const reviewRunner = makeMockRunner([{ type: 'token', token: 'reviewing' } as any]);
      mockCreateReviewerRunner.mockResolvedValue({ runner: reviewRunner, state: mockState });
      mockParseReviewReport.mockReturnValue({
        overallScore: 4,
        dimensions: {
          clarity: { score: 4, reasoning: 'clear' },
          completeness: { score: 4, reasoning: 'mostly complete' },
          focus: { score: 4, reasoning: 'focused' },
          safety: { score: 4, reasoning: 'safe' },
          efficiency: { score: 4, reasoning: 'efficient' },
        },
        issues: [],
        summary: 'good',
      });

      const res = await fetch(`${getUrl()}/api/devtool/review/stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: 'agent definition content' }),
      });

      expect(res.status).toBe(200);
      const raw = await res.text();
      const events = parseSSE(raw);

      expect(events.some((e) => e.event === 'devtool:token')).toBe(true);
      expect(events.some((e) => e.event === 'devtool:complete')).toBe(true);

      const completeEvent = events.find((e) => e.event === 'devtool:complete');
      expect((completeEvent!.data as { report: unknown }).report).toBeDefined();
    });

    it('streams devtool:error on exception', async () => {
      mockCreateReviewerRunner.mockRejectedValue(new Error('review crash'));

      const res = await fetch(`${getUrl()}/api/devtool/review/stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: 'test content' }),
      });

      expect(res.status).toBe(200);
      const raw = await res.text();
      const events = parseSSE(raw);
      const errorEvent = events.find((e) => e.event === 'devtool:error');
      expect(errorEvent).toBeDefined();
      expect((errorEvent!.data as { message: string }).message).toBe('review crash');
    });

    it('streams complete with undefined report when parseReviewReport throws', async () => {
      const reviewRunner = makeMockRunner([{ type: 'token', token: 'reviewing' } as any]);
      mockCreateReviewerRunner.mockResolvedValue({ runner: reviewRunner, state: mockState });
      mockParseReviewReport.mockImplementation(() => {
        throw new Error('unparseable report');
      });

      const res = await fetch(`${getUrl()}/api/devtool/review/stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: 'agent definition content' }),
      });

      expect(res.status).toBe(200);
      const raw = await res.text();
      const events = parseSSE(raw);

      const completeEvent = events.find((e) => e.event === 'devtool:complete');
      expect(completeEvent).toBeDefined();
      expect((completeEvent!.data as { report: unknown }).report).toBeUndefined();
    });
  });
});
