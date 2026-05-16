import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  loadPromptTemplate,
  assemblePrompt,
  parseAgentOutput,
  parseReviewReport,
  callAgentLLM,
  runAgent,
  runReviewAgent,
} from '../../../src/agents/orchestrator.js';
import { resetLLMClient } from '../../../src/llm.js';
import type { LLMConfig } from '../../../src/config.js';

describe('loadPromptTemplate', () => {
  it('should load architect prompt', async () => {
    const prompt = await loadPromptTemplate('architect');
    expect(prompt).toContain('Agent Architect');
    expect(prompt).toContain('Output Format');
  });

  it('should load skill-designer prompt', async () => {
    const prompt = await loadPromptTemplate('skill-designer');
    expect(prompt).toContain('Skill Designer');
  });

  it('should load crew-composer prompt', async () => {
    const prompt = await loadPromptTemplate('crew-composer');
    expect(prompt).toContain('Crew Composer');
  });

  it('should load reviewer prompt', async () => {
    const prompt = await loadPromptTemplate('reviewer');
    expect(prompt).toContain('Code Reviewer');
  });

  it('should load session-curator prompt', async () => {
    const prompt = await loadPromptTemplate('session-curator');
    expect(prompt).toContain('Session Curator');
  });

  it('should throw for missing template', async () => {
    await expect(loadPromptTemplate('nonexistent')).rejects.toThrow();
  });
});

describe('assemblePrompt', () => {
  it('should inject user prompt', () => {
    const template = 'System: {{USER_PROMPT}}';
    const result = assemblePrompt(template, 'Hello');
    expect(result).toContain('System: Hello');
    expect(result).toContain('User Request');
  });

  it('should include existing content when provided', () => {
    const template = 'System prompt';
    const result = assemblePrompt(template, 'Update', 'old content');
    expect(result).toContain('old content');
    expect(result).toContain('Existing Content');
  });

  it('should not include existing content section when undefined', () => {
    const template = 'System prompt';
    const result = assemblePrompt(template, 'Create');
    expect(result).not.toContain('Existing Content');
  });
});

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
    const raw = '```json\n' + JSON.stringify({
      changes: [{ file: 'AGENT.md', type: 'create', new: 'content' }],
      summary: 'Created agent',
    }) + '\n```';
    const output = parseAgentOutput(raw);
    expect(output.changes).toHaveLength(1);
  });

  it('should parse JSON without language specifier', () => {
    const raw = '```\n' + JSON.stringify({
      changes: [{ file: 'AGENT.md', type: 'create', new: 'content' }],
      summary: 'Created agent',
    }) + '\n```';
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

  it('should throw when changes is not an array', () => {
    expect(() => parseAgentOutput('{"changes": "bad", "summary": "test"}')).toThrow('Missing or invalid "changes"');
  });
});

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
    expect(report.issues).toHaveLength(0);
  });

  it('should parse review report in code block', () => {
    const raw = '```json\n' + JSON.stringify({
      overallScore: 3,
      dimensions: { clarity: { score: 3, reasoning: 'OK' } },
      issues: [{ severity: 'minor', location: 'line 1', description: 'typo', suggestion: 'fix it' }],
      summary: 'OK',
    }) + '\n```';
    const report = parseReviewReport(raw);
    expect(report.overallScore).toBe(3);
    expect(report.issues).toHaveLength(1);
  });

  it('should throw when overallScore is missing', () => {
    expect(() => parseReviewReport('{"dimensions": {}, "issues": [], "summary": ""}')).toThrow('overallScore');
  });

  it('should throw when dimensions is missing', () => {
    expect(() => parseReviewReport('{"overallScore": 1, "issues": [], "summary": ""}')).toThrow('dimensions');
  });

  it('should throw when issues is missing', () => {
    expect(() => parseReviewReport('{"overallScore": 1, "dimensions": {}, "summary": ""}')).toThrow('issues');
  });

  it('should throw when summary is missing', () => {
    expect(() => parseReviewReport('{"overallScore": 1, "dimensions": {}, "issues": []}')).toThrow('summary');
  });

  it('should throw when no JSON braces in review report', () => {
    expect(() => parseReviewReport('just text no json')).toThrow('No JSON object found');
  });
});

describe('callAgentLLM', () => {
  beforeEach(() => {
    resetLLMClient();
  });

  it('should call LLM and return content', async () => {
    const { createLLMClient } = await import('../../../src/llm.js');
    const client = createLLMClient({
      provider: 'openai',
      apiKey: 'sk-test',
      model: 'gpt-4o',
    });

    const mockCall = vi.fn().mockResolvedValue({
      content: '{"changes":[],"summary":"test"}',
      tokens: { input: 10, output: 5 },
      stopReason: 'stop',
    });
    client.call = mockCall;

    const result = await callAgentLLM(client, 'gpt-4o', 'You are helpful', 'Do something');
    expect(result).toBe('{"changes":[],"summary":"test"}');
    expect(mockCall).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'gpt-4o',
        messages: expect.arrayContaining([
          expect.objectContaining({ role: 'user' }),
        ]),
      })
    );
  });
});

describe('runAgent', () => {
  beforeEach(() => {
    resetLLMClient();
  });

  it('should run agent and parse output', async () => {
    const { createLLMClient } = await import('../../../src/llm.js');
    const client = createLLMClient({
      provider: 'openai',
      apiKey: 'sk-test',
      model: 'gpt-4o',
    });

    client.call = vi.fn().mockResolvedValue({
      content: JSON.stringify({
        changes: [{ file: 'AGENT.md', type: 'create', new: '---\nname: test\n---' }],
        summary: 'Created test agent',
      }),
      tokens: { input: 50, output: 20 },
      stopReason: 'stop',
    });

    const output = await runAgent(client, 'gpt-4o', 'architect', 'Create a test agent');
    expect(output.changes).toHaveLength(1);
    expect(output.summary).toBe('Created test agent');
  });
});

describe('runReviewAgent', () => {
  beforeEach(() => {
    resetLLMClient();
  });

  it('should run reviewer and parse report', async () => {
    const { createLLMClient } = await import('../../../src/llm.js');
    const client = createLLMClient({
      provider: 'openai',
      apiKey: 'sk-test',
      model: 'gpt-4o',
    });

    client.call = vi.fn().mockResolvedValue({
      content: JSON.stringify({
        overallScore: 4,
        dimensions: {
          clarity: { score: 4, reasoning: 'Clear' },
          completeness: { score: 3, reasoning: 'Missing' },
          focus: { score: 5, reasoning: 'Focused' },
          safety: { score: 4, reasoning: 'Safe' },
          efficiency: { score: 4, reasoning: 'Efficient' },
        },
        issues: [],
        summary: 'Good quality',
      }),
      tokens: { input: 100, output: 50 },
      stopReason: 'stop',
    });

    const report = await runReviewAgent(client, 'gpt-4o', 'Review this file');
    expect(report.overallScore).toBe(4);
    expect(report.summary).toBe('Good quality');
  });
});
