import { describe, expect } from 'vitest';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runReviewer } from '../../src/agents/reviewer.js';
import { testConfig, itif } from './config.js';

describe('US4: Review agent quality', () => {
  itif(testConfig.enabled)(
    'AC4.1: static review without LLM works',
    async () => {
      const content = `---
name: bad-agent
description: No instructions
---
`;
      const result = await runReviewer('AGENT.md', content);

      // Validate review report structure — not just property existence
      expect(result.overallScore).toBeGreaterThanOrEqual(1);
      expect(result.overallScore).toBeLessThanOrEqual(5);
      expect(result.dimensions).toMatchObject({
        clarity: expect.objectContaining({
          score: expect.any(Number),
          reasoning: expect.any(String),
        }),
        completeness: expect.objectContaining({
          score: expect.any(Number),
          reasoning: expect.any(String),
        }),
        focus: expect.objectContaining({
          score: expect.any(Number),
          reasoning: expect.any(String),
        }),
        safety: expect.objectContaining({
          score: expect.any(Number),
          reasoning: expect.any(String),
        }),
        efficiency: expect.objectContaining({
          score: expect.any(Number),
          reasoning: expect.any(String),
        }),
      });
      expect(Array.isArray(result.issues)).toBe(true);
      expect(typeof result.summary).toBe('string');
      expect(result.summary.length).toBeGreaterThan(0);
    },
    60000
  );

  itif(testConfig.enabled)(
    'AC4.3-AC4.5: review output includes scores and is read-only',
    async () => {
      const content = `---
name: test-agent
description: A helpful assistant
---
You are a helpful assistant. Answer user questions clearly and concisely.
`;
      const result = await runReviewer('AGENT.md', content);

      expect(result.overallScore).toBeGreaterThanOrEqual(1);
      expect(result.overallScore).toBeLessThanOrEqual(5);
      expect(result.dimensions).toMatchObject({
        clarity: expect.objectContaining({
          score: expect.any(Number),
          reasoning: expect.any(String),
        }),
        completeness: expect.objectContaining({
          score: expect.any(Number),
          reasoning: expect.any(String),
        }),
        focus: expect.objectContaining({
          score: expect.any(Number),
          reasoning: expect.any(String),
        }),
        safety: expect.objectContaining({
          score: expect.any(Number),
          reasoning: expect.any(String),
        }),
        efficiency: expect.objectContaining({
          score: expect.any(Number),
          reasoning: expect.any(String),
        }),
      });
      expect(Array.isArray(result.issues)).toBe(true);
      // Each issue must have required fields if any exist
      for (const issue of result.issues) {
        expect(issue).toMatchObject({
          severity: expect.any(String),
          description: expect.any(String),
        });
      }
      expect(typeof result.summary).toBe('string');
      expect(result.summary.length).toBeGreaterThan(0);
      // Review should never return file changes
      expect(result).not.toHaveProperty('changes');
    },
    120000
  );
});
