import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createAgentState, addUserMessage, addAssistantMessage } from '@agentskillmania/colts';

// Mock EnhancedRunner — the key external dependency
const mocks = vi.hoisted(() => ({
  run: vi.fn(),
  create: vi.fn(),
}));

vi.mock('@agentskillmania/wrangler', () => ({
  EnhancedRunner: {
    create: mocks.create,
  },
}));

import {
  loadPromptTemplate,
  parseAgentOutput,
  parseReviewReport,
  parseSessionSummary,
  createGenerationRunner,
  createReviewRunner,
  createCuratorRunner,
  runGenerationWithLoop,
  runReview,
  runCurator,
} from '../../../src/agents/orchestrator.js';
import type { AgentOutput, ReviewReport, AgentRunOptions } from '../../../src/agents/types.js';

// ── Helpers ──────────────────────────────────────────────

function makeAgentOutput(summary: string): AgentOutput {
  return {
    changes: [{ file: 'AGENT.md', type: 'create', new: `name: test\n${summary}` }],
    summary,
  };
}

function makeReviewReport(score: number): ReviewReport {
  return {
    overallScore: score,
    dimensions: {
      clarity: { score, reasoning: 'test reasoning' },
      completeness: { score, reasoning: 'test reasoning' },
      focus: { score, reasoning: 'test reasoning' },
      safety: { score, reasoning: 'test reasoning' },
      efficiency: { score, reasoning: 'test reasoning' },
    },
    issues: [],
    summary: 'test review',
  };
}

/** Build a mock return value for runner.run() with a real AgentState containing an assistant message. */
function makeRunnerReturn(content: string) {
  const state = createAgentState({ name: 'test', instructions: '', tools: [] });
  const withUser = addUserMessage(state, 'test input');
  const withAssistant = addAssistantMessage(withUser, content);
  return {
    state: withAssistant,
    result: { type: 'success' as const, answer: content, totalSteps: 1 },
  };
}

// ── Tests ────────────────────────────────────────────────

describe('orchestrator', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'devtool-orch-test-'));
    mocks.run.mockReset();
    mocks.create.mockReset();
    mocks.create.mockResolvedValue({
      run: mocks.run,
      runStream: vi.fn(),
      on: vi.fn().mockReturnThis(),
    });
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  // ── Retained: loadPromptTemplate ───────────────────────

  describe('loadPromptTemplate', () => {
    it('should load architect prompt with domain knowledge', async () => {
      const prompt = await loadPromptTemplate('architect');
      expect(prompt).toContain('Agent Architect');
      expect(prompt).toContain('AGENT.md');
    });

    it('should load skill-designer prompt', async () => {
      const prompt = await loadPromptTemplate('skill-designer');
      expect(prompt).toContain('Skill Designer');
    });

    it('should load crew-composer prompt', async () => {
      const prompt = await loadPromptTemplate('crew-composer');
      expect(prompt).toContain('Crew Composer');
    });

    it('should load reviewer prompt with quantitative criteria', async () => {
      const prompt = await loadPromptTemplate('reviewer');
      expect(prompt).toContain('Definition Reviewer');
      expect(prompt).toContain('Clarity');
    });

    it('should load session-curator prompt', async () => {
      const prompt = await loadPromptTemplate('session-curator');
      expect(prompt).toContain('Session Curator');
    });

    it('should throw for missing template', async () => {
      await expect(loadPromptTemplate('nonexistent')).rejects.toThrow();
    });
  });

  // ── Retained: parseAgentOutput ─────────────────────────

  describe('parseAgentOutput', () => {
    it('should parse raw JSON', () => {
      const raw = JSON.stringify({
        changes: [{ file: 'AGENT.md', type: 'create', new: 'content' }],
        summary: 'Created agent',
      });
      const output = parseAgentOutput(raw);
      expect(output.changes).toHaveLength(1);
      expect(output.summary).toBe('Created agent');
    });

    it('should parse JSON inside markdown code block', () => {
      const raw =
        '```json\n' +
        JSON.stringify({
          changes: [{ file: 'AGENT.md', type: 'create', new: 'content' }],
          summary: 'Created agent',
        }) +
        '\n```';
      const output = parseAgentOutput(raw);
      expect(output.changes).toHaveLength(1);
    });

    it('should throw when no JSON object found', () => {
      expect(() => parseAgentOutput('just some text')).toThrow('No JSON object found');
    });

    it('should throw when changes is missing', () => {
      expect(() => parseAgentOutput('{"summary": "test"}')).toThrow('Missing or invalid "changes"');
    });

    it('should throw when summary is missing', () => {
      expect(() => parseAgentOutput('{"changes": []}')).toThrow('Missing or invalid "summary"');
    });

    it('should parse JSON with nested code blocks inside values', () => {
      const raw =
        '```json\n' +
        JSON.stringify({
          changes: [
            {
              file: 'test.md',
              type: 'create',
              new: '```typescript\nconst x = 1;\n```',
            },
          ],
          summary: 'Created file with code',
        }) +
        '\n```';
      const output = parseAgentOutput(raw);
      expect(output.changes[0].new).toContain('const x = 1;');
    });

    it('should extract JSON from text with no closing brace', () => {
      expect(() => parseAgentOutput('some text without braces')).toThrow('No JSON object found');
    });

    it('should extract deeply nested JSON', () => {
      const raw = JSON.stringify({
        changes: [
          {
            file: 'test.md',
            type: 'create',
            new: '{"nested": {"deep": true}}',
          },
        ],
        summary: 'Nested test',
      });
      const output = parseAgentOutput(raw);
      expect(output.changes).toHaveLength(1);
      expect(output.summary).toBe('Nested test');
    });

    it('should handle JSON with escaped quotes in values', () => {
      const raw = JSON.stringify({
        changes: [{ file: 'test.md', type: 'create', new: 'He said "hello" to me' }],
        summary: 'Escaped quotes test',
      });
      const output = parseAgentOutput(raw);
      expect(output.changes[0].new).toBe('He said "hello" to me');
    });
  });

  // ── Retained: parseReviewReport ────────────────────────

  describe('parseReviewReport', () => {
    it('should parse valid review report', () => {
      const raw = JSON.stringify({
        overallScore: 4,
        dimensions: {
          clarity: { score: 4, reasoning: 'Clear' },
          completeness: { score: 3, reasoning: 'Missing' },
          focus: { score: 5, reasoning: 'Focused' },
          safety: { score: 4, reasoning: 'Safe' },
          efficiency: { score: 4, reasoning: 'Efficient' },
        },
        issues: [],
        summary: 'Good overall',
      });
      const report = parseReviewReport(raw);
      expect(report.overallScore).toBe(4);
    });

    it('should throw when overallScore is missing', () => {
      expect(() => parseReviewReport('{"dimensions": {}, "issues": [], "summary": ""}')).toThrow(
        'overallScore'
      );
    });

    it('should throw when no JSON found', () => {
      expect(() => parseReviewReport('just text no json')).toThrow('No JSON object found');
    });
  });

  // ── Retained: parseSessionSummary ──────────────────────

  describe('parseSessionSummary', () => {
    it('should parse valid session summary', () => {
      const raw = JSON.stringify({
        title: 'Code Review',
        description: 'Reviewed auth module',
      });
      const summary = parseSessionSummary(raw);
      expect(summary.title).toBe('Code Review');
    });

    it('should throw when title is missing', () => {
      expect(() => parseSessionSummary('{"description":"no title"}')).toThrow('title');
    });

    it('should throw when no JSON found', () => {
      expect(() => parseSessionSummary('just text')).toThrow('No JSON object found');
    });
  });

  // ── New: createGenerationRunner ────────────────────────

  describe('createGenerationRunner', () => {
    it('should create EnhancedRunner with file tools and disabled features', async () => {
      await createGenerationRunner('architect', {
        llmClient: {} as never,
        workspacePath: tempDir,
      });

      expect(mocks.create).toHaveBeenCalledWith(
        expect.objectContaining({
          builtinTools: {
            fileRead: true,
            fileWrite: true,
            fileEdit: true,
            glob: true,
            grep: true,
          },
          enableSession: false,
          enableTodolist: false,
          enableCommands: false,
        })
      );
    });

    it('should return runner and state with prompt template as instructions', async () => {
      const { runner, state } = await createGenerationRunner('architect', {
        llmClient: {} as never,
        workspacePath: tempDir,
      });

      expect(runner).toBeDefined();
      expect(state).toBeDefined();
      expect(state.config.instructions).toContain('Agent Architect');
    });

    it('should pass model and workspacePath to EnhancedRunner', async () => {
      await createGenerationRunner('skill-designer', {
        llmClient: {} as never,
        workspacePath: tempDir,
        model: 'gpt-4o',
      });

      expect(mocks.create).toHaveBeenCalledWith(
        expect.objectContaining({
          model: 'gpt-4o',
          workspacePath: tempDir,
        })
      );
    });
  });

  // ── New: createReviewRunner ────────────────────────────

  describe('createReviewRunner', () => {
    it('should create EnhancedRunner with no builtin tools', async () => {
      await createReviewRunner({ llmClient: {} as never, workspacePath: tempDir });

      expect(mocks.create).toHaveBeenCalledWith(
        expect.objectContaining({
          builtinTools: {},
          enableSession: false,
          enableTodolist: false,
          enableCommands: false,
        })
      );
    });

    it('should return state with reviewer instructions', async () => {
      const { state } = await createReviewRunner({
        llmClient: {} as never,
        workspacePath: tempDir,
      });

      expect(state.config.instructions).toContain('Definition Reviewer');
    });
  });

  // ── New: createCuratorRunner ───────────────────────────

  describe('createCuratorRunner', () => {
    it('should create EnhancedRunner with no builtin tools', async () => {
      await createCuratorRunner({ llmClient: {} as never, workspacePath: tempDir });

      expect(mocks.create).toHaveBeenCalledWith(
        expect.objectContaining({
          builtinTools: {},
          enableSession: false,
          enableTodolist: false,
          enableCommands: false,
        })
      );
    });

    it('should return state with curator instructions', async () => {
      const { state } = await createCuratorRunner({
        llmClient: {} as never,
        workspacePath: tempDir,
      });

      expect(state.config.instructions).toContain('Session Curator');
    });
  });

  // ── New: runGenerationWithLoop (iterative loop) ────────

  describe('runGenerationWithLoop', () => {
    it('should return after first round when review passes', async () => {
      const output = makeAgentOutput('good output');
      const passReport = makeReviewReport(5);

      mocks.run
        .mockResolvedValueOnce(makeRunnerReturn(JSON.stringify(output)))
        .mockResolvedValueOnce(makeRunnerReturn(JSON.stringify(passReport)));

      const result = await runGenerationWithLoop(
        'architect',
        'test user input',
        { llmClient: {} as never, workspacePath: tempDir },
        undefined,
        { maxRounds: 3, scoreThreshold: 4 }
      );

      expect(mocks.run).toHaveBeenCalledTimes(2);
      expect(result.output.summary).toBe('good output');
      expect(result.review?.overallScore).toBe(5);
    });

    it('should iterate when review fails then pass on round 2', async () => {
      const failReport = makeReviewReport(2);
      const passReport = makeReviewReport(5);
      const output1 = makeAgentOutput('round 1');
      const output2 = makeAgentOutput('round 2');

      mocks.run
        .mockResolvedValueOnce(makeRunnerReturn(JSON.stringify(output1)))
        .mockResolvedValueOnce(makeRunnerReturn(JSON.stringify(failReport)))
        .mockResolvedValueOnce(makeRunnerReturn(JSON.stringify(output2)))
        .mockResolvedValueOnce(makeRunnerReturn(JSON.stringify(passReport)));

      const result = await runGenerationWithLoop(
        'architect',
        'test user input',
        { llmClient: {} as never, workspacePath: tempDir },
        undefined,
        { maxRounds: 3, scoreThreshold: 4 }
      );

      expect(mocks.run).toHaveBeenCalledTimes(4);
      expect(result.output.summary).toBe('round 2');
      expect(result.review?.overallScore).toBe(5);
    });

    it('should return last result after maxRounds exhausted', async () => {
      const failReport = makeReviewReport(2);
      const output1 = makeAgentOutput('round 1');
      const output2 = makeAgentOutput('round 2');
      const output3 = makeAgentOutput('round 3');

      mocks.run
        .mockResolvedValueOnce(makeRunnerReturn(JSON.stringify(output1)))
        .mockResolvedValueOnce(makeRunnerReturn(JSON.stringify(failReport)))
        .mockResolvedValueOnce(makeRunnerReturn(JSON.stringify(output2)))
        .mockResolvedValueOnce(makeRunnerReturn(JSON.stringify(failReport)))
        .mockResolvedValueOnce(makeRunnerReturn(JSON.stringify(output3)));

      const result = await runGenerationWithLoop(
        'architect',
        'test user input',
        { llmClient: {} as never, workspacePath: tempDir },
        undefined,
        { maxRounds: 3, scoreThreshold: 4 }
      );

      // 5 calls: 2 full rounds (gen+review) + 1 last gen (no review on final round)
      expect(mocks.run).toHaveBeenCalledTimes(5);
      expect(result.output.summary).toBe('round 3');
      expect(result.review?.overallScore).toBe(2);
    });

    it('should skip review when maxRounds is 1', async () => {
      const output = makeAgentOutput('single round');

      mocks.run.mockResolvedValueOnce(makeRunnerReturn(JSON.stringify(output)));

      const result = await runGenerationWithLoop(
        'architect',
        'test user input',
        { llmClient: {} as never, workspacePath: tempDir },
        undefined,
        { maxRounds: 1 }
      );

      expect(mocks.run).toHaveBeenCalledTimes(1);
      expect(result.output.summary).toBe('single round');
      expect(result.review).toBeUndefined();
    });

    it('should return raw text as summary when generation output is unparseable', async () => {
      mocks.run.mockResolvedValueOnce(makeRunnerReturn('not valid json'));

      const result = await runGenerationWithLoop(
        'architect',
        'test input',
        { llmClient: {} as never, workspacePath: tempDir },
        undefined,
        { maxRounds: 1 }
      );

      expect(result.output.summary).toBe('not valid json');
      expect(result.output.changes).toEqual([]);
    });

    it('should return undefined review when review output is unparseable', async () => {
      const output = makeAgentOutput('test');

      mocks.run
        .mockResolvedValueOnce(makeRunnerReturn(JSON.stringify(output)))
        .mockResolvedValueOnce(makeRunnerReturn('bad review json'));

      const result = await runGenerationWithLoop(
        'architect',
        'test input',
        { llmClient: {} as never, workspacePath: tempDir },
        undefined,
        { maxRounds: 3, scoreThreshold: 4 }
      );

      expect(result.output.summary).toBe('test');
      expect(result.review).toBeUndefined();
    });

    it('should pass existingContent in user message', async () => {
      const output = makeAgentOutput('updated');
      mocks.run.mockResolvedValueOnce(makeRunnerReturn(JSON.stringify(output)));

      await runGenerationWithLoop(
        'architect',
        'update the agent',
        { llmClient: {} as never, workspacePath: tempDir },
        'existing agent content',
        { maxRounds: 1 }
      );

      const callState = mocks.run.mock.calls[0][0];
      const userMsg = callState.context.messages.find((m: { role: string }) => m.role === 'user');
      expect(userMsg.content).toContain('existing agent content');
    });

    it('should inject review feedback in subsequent rounds', async () => {
      const failReport: ReviewReport = {
        overallScore: 2,
        dimensions: {
          clarity: { score: 2, reasoning: 'Unclear' },
          completeness: { score: 2, reasoning: 'Incomplete' },
          focus: { score: 2, reasoning: 'Unfocused' },
          safety: { score: 3, reasoning: 'OK' },
          efficiency: { score: 3, reasoning: 'OK' },
        },
        issues: [
          {
            severity: 'major',
            location: 'AGENT.md:1',
            description: 'Missing description',
            suggestion: 'Add description field',
          },
        ],
        summary: 'Needs improvement',
      };
      const passReport = makeReviewReport(5);
      const output1 = makeAgentOutput('round 1');
      const output2 = makeAgentOutput('round 2');

      mocks.run
        .mockResolvedValueOnce(makeRunnerReturn(JSON.stringify(output1)))
        .mockResolvedValueOnce(makeRunnerReturn(JSON.stringify(failReport)))
        .mockResolvedValueOnce(makeRunnerReturn(JSON.stringify(output2)))
        .mockResolvedValueOnce(makeRunnerReturn(JSON.stringify(passReport)));

      await runGenerationWithLoop(
        'architect',
        'test input',
        { llmClient: {} as never, workspacePath: tempDir },
        undefined,
        { maxRounds: 3, scoreThreshold: 4 }
      );

      // Round 2's generation call (3rd mocks.run call) should have review feedback
      const round2State = mocks.run.mock.calls[2][0];
      const userMsgs = round2State.context.messages.filter(
        (m: { role: string }) => m.role === 'user'
      );
      const feedbackMsg = userMsgs[userMsgs.length - 1];
      expect(feedbackMsg.content).toContain('Review Feedback');
      expect(feedbackMsg.content).toContain('Unclear');
      expect(feedbackMsg.content).toContain('Missing description');
    });

    it('should pass when all dimensions equal threshold exactly', async () => {
      const output = makeAgentOutput('boundary test');
      const boundaryReport: ReviewReport = {
        overallScore: 4,
        dimensions: {
          clarity: { score: 4, reasoning: 'OK' },
          completeness: { score: 4, reasoning: 'OK' },
          focus: { score: 4, reasoning: 'OK' },
          safety: { score: 4, reasoning: 'OK' },
          efficiency: { score: 4, reasoning: 'OK' },
        },
        issues: [],
        summary: 'All at threshold',
      };

      mocks.run
        .mockResolvedValueOnce(makeRunnerReturn(JSON.stringify(output)))
        .mockResolvedValueOnce(makeRunnerReturn(JSON.stringify(boundaryReport)));

      const result = await runGenerationWithLoop(
        'architect',
        'test input',
        { llmClient: {} as never, workspacePath: tempDir },
        undefined,
        { maxRounds: 3, scoreThreshold: 4 }
      );

      // Should pass and stop after round 1 (2 calls total)
      expect(mocks.run).toHaveBeenCalledTimes(2);
      expect(result.review?.overallScore).toBe(4);
    });

    it('should stop iteration after unparseable review instead of continuing', async () => {
      const output = makeAgentOutput('round 1');
      const passReport = makeReviewReport(5);
      const output2 = makeAgentOutput('round 2');

      mocks.run
        .mockResolvedValueOnce(makeRunnerReturn(JSON.stringify(output)))
        .mockResolvedValueOnce(makeRunnerReturn('not valid review json'))
        .mockResolvedValueOnce(makeRunnerReturn(JSON.stringify(output2)))
        .mockResolvedValueOnce(makeRunnerReturn(JSON.stringify(passReport)));

      const result = await runGenerationWithLoop(
        'architect',
        'test input',
        { llmClient: {} as never, workspacePath: tempDir },
        undefined,
        { maxRounds: 3, scoreThreshold: 4 }
      );

      // Should stop at 2 calls (gen + failed review), not continue to 4
      expect(mocks.run).toHaveBeenCalledTimes(2);
      expect(result.output.summary).toBe('round 1');
      expect(result.review).toBeUndefined();
    });
  });

  // ── New: runReview ─────────────────────────────────────

  describe('runReview', () => {
    it('should run reviewer and parse report', async () => {
      const report = makeReviewReport(4);
      mocks.run.mockResolvedValueOnce(makeRunnerReturn(JSON.stringify(report)));

      const result = await runReview('review this content', {
        llmClient: {} as never,
        workspacePath: tempDir,
      });

      expect(result.overallScore).toBe(4);
      expect(result.summary).toBe('test review');
    });

    it('should throw when review output is unparseable', async () => {
      mocks.run.mockResolvedValueOnce(makeRunnerReturn('not json'));

      await expect(
        runReview('review this', { llmClient: {} as never, workspacePath: tempDir })
      ).rejects.toThrow('No JSON object found');
    });
  });

  // ── New: runCurator ────────────────────────────────────

  describe('runCurator', () => {
    it('should run curator and parse summary', async () => {
      const summary = { title: 'Bug Fix', description: 'Fixed null pointer in parser' };
      mocks.run.mockResolvedValueOnce(makeRunnerReturn(JSON.stringify(summary)));

      const result = await runCurator('some conversation text', {
        llmClient: {} as never,
        workspacePath: tempDir,
      });

      expect(result.title).toBe('Bug Fix');
      expect(result.description).toBe('Fixed null pointer in parser');
    });

    it('should throw when curator output is unparseable', async () => {
      mocks.run.mockResolvedValueOnce(makeRunnerReturn('not json'));

      await expect(
        runCurator('some text', { llmClient: {} as never, workspacePath: tempDir })
      ).rejects.toThrow('No JSON object found');
    });
  });
});
