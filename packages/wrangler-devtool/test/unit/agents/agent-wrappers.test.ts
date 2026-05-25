import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createAgentState, addUserMessage, addAssistantMessage } from '@agentskillmania/colts';

// Mock EnhancedRunner — shared with orchestrator test pattern
const mocks = vi.hoisted(() => ({
  run: vi.fn(),
  create: vi.fn(),
}));

vi.mock('@agentskillmania/wrangler', () => ({
  EnhancedRunner: {
    create: mocks.create,
  },
}));

import { runAgentArchitect } from '../../../src/agents/architect.js';
import { runSkillDesigner } from '../../../src/agents/skill-designer.js';
import { runCrewComposer } from '../../../src/agents/crew-composer.js';
import { runReviewer } from '../../../src/agents/reviewer.js';
import { runSessionCurator } from '../../../src/agents/session-curator.js';

/** Build a mock runner return value with a real AgentState */
function makeRunnerReturn(content: string) {
  const state = createAgentState({ name: 'test', instructions: '', tools: [] });
  const withUser = addUserMessage(state, 'test input');
  const withAssistant = addAssistantMessage(withUser, content);
  return {
    state: withAssistant,
    result: { type: 'success' as const, answer: content, totalSteps: 1 },
  };
}

function makeAgentOutputJson(summary: string) {
  return JSON.stringify({
    changes: [{ file: 'AGENT.md', type: 'create', new: `name: test\n${summary}` }],
    summary,
  });
}

function makeReviewReportJson(score: number) {
  return JSON.stringify({
    overallScore: score,
    dimensions: {
      clarity: { score, reasoning: 'test' },
      completeness: { score, reasoning: 'test' },
      focus: { score, reasoning: 'test' },
      safety: { score, reasoning: 'test' },
      efficiency: { score, reasoning: 'test' },
    },
    issues: [],
    summary: 'test review',
  });
}

describe('agent wrappers', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'devtool-wrapper-test-'));
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

  const baseConfig = {
    llmClient: {} as never,
    workspacePath: tempDir,
  };

  // ── Generation wrappers ────────────────────────────────

  describe('runAgentArchitect', () => {
    it('should return agent output via generation loop', async () => {
      const outputJson = makeAgentOutputJson('architect output');
      const reviewJson = makeReviewReportJson(5);

      mocks.run
        .mockResolvedValueOnce(makeRunnerReturn(outputJson))
        .mockResolvedValueOnce(makeRunnerReturn(reviewJson));

      const result = await runAgentArchitect('create an agent', undefined, {
        ...baseConfig,
        maxRounds: 3,
      });

      expect(result.summary).toBe('architect output');
      expect(result.changes).toHaveLength(1);
    });

    it('should pass existingContent through', async () => {
      mocks.run.mockResolvedValueOnce(makeRunnerReturn(outputJson('test')));

      const result = await runAgentArchitect('update', 'existing content', {
        ...baseConfig,
        maxRounds: 1,
      });

      // Verify the runner was called with a state containing existing content
      const callState = mocks.run.mock.calls[0][0];
      const userMsg = callState.context.messages.find((m: { role: string }) => m.role === 'user');
      expect(userMsg.content).toContain('existing content');
      expect(result.summary).toBe('test');
    });
  });

  describe('runSkillDesigner', () => {
    it('should return skill output via generation loop', async () => {
      mocks.run.mockResolvedValueOnce(makeRunnerReturn(makeAgentOutputJson('skill output')));

      const result = await runSkillDesigner('create a skill', undefined, {
        ...baseConfig,
        maxRounds: 1,
      });

      expect(result.summary).toBe('skill output');
    });
  });

  describe('runCrewComposer', () => {
    it('should return crew output via generation loop', async () => {
      mocks.run.mockResolvedValueOnce(makeRunnerReturn(makeAgentOutputJson('crew output')));

      const result = await runCrewComposer('create a crew', undefined, {
        ...baseConfig,
        maxRounds: 1,
      });

      expect(result.summary).toBe('crew output');
    });
  });

  // ── Reviewer wrapper ───────────────────────────────────

  describe('runReviewer', () => {
    it('should return review report', async () => {
      mocks.run.mockResolvedValueOnce(makeRunnerReturn(makeReviewReportJson(4)));

      const result = await runReviewer('AGENT.md', 'agent content', 'check safety', baseConfig);

      expect(result.overallScore).toBe(4);
    });

    it('should include target path in review prompt', async () => {
      mocks.run.mockResolvedValueOnce(makeRunnerReturn(makeReviewReportJson(3)));

      await runReviewer('CREW.md', 'crew content', undefined, baseConfig);

      // The runner was called with a state containing the review prompt
      const callState = mocks.run.mock.calls[0][0];
      const userMsg = callState.context.messages.find((m: { role: string }) => m.role === 'user');
      expect(userMsg.content).toContain('CREW.md');
    });
  });

  // ── Session curator wrapper ────────────────────────────

  describe('runSessionCurator', () => {
    it('should return session summary', async () => {
      const summaryJson = JSON.stringify({ title: 'Bug Fix', description: 'Fixed null pointer' });
      mocks.run.mockResolvedValueOnce(makeRunnerReturn(summaryJson));

      const result = await runSessionCurator('conversation text', baseConfig);

      expect(result.title).toBe('Bug Fix');
      expect(result.description).toBe('Fixed null pointer');
    });
  });
});

/** Shorthand to make a single agent output JSON string */
function outputJson(summary: string) {
  return makeAgentOutputJson(summary);
}
