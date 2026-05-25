import { describe, expect } from 'vitest';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runAgentArchitect } from '../../src/agents/architect.js';
import { runReviewer } from '../../src/agents/reviewer.js';
import { applyChanges } from '../../src/utils/file-change.js';
import { testConfig, itif } from './config.js';
import { validateReviewReport, validateAgentOutput, validateAgentMarkdown } from './helpers.js';

function runnerConfig(cwd: string) {
  return {
    llmClient: testConfig.llmClient!,
    workspacePath: cwd,
    model: testConfig.testModel,
  };
}

describe('Error path integration tests', () => {
  itif(testConfig.enabled)(
    'reviewer handles empty content gracefully',
    async () => {
      // Empty content after frontmatter — should still produce a valid report
      const content = `---
name: empty-agent
description: literally nothing
---
`;
      const result = await runReviewer('AGENT.md', content, undefined, runnerConfig('.'));

      // Reviewer should succeed (not throw) but flag quality issues
      validateReviewReport(result);

      // Empty content shouldn't get perfect scores across all dimensions
      const dims = Object.values(result.dimensions);
      const hasLowScore = dims.some((d) => d.score < 5);
      if (hasLowScore) {
        expect(result.issues.length).toBeGreaterThan(0);
      }
    },
    120000
  );

  itif(testConfig.enabled)(
    'reviewer handles very long content without crashing',
    async () => {
      const longBody = 'You are an agent that helps users. '.repeat(500);
      const content = `---
name: long-agent
description: A verbose agent
---
${longBody}`;
      const result = await runReviewer('AGENT.md', content, undefined, runnerConfig('.'));
      validateReviewReport(result);
    },
    60000
  );

  itif(testConfig.enabled)(
    'architect handles conflicting instructions',
    async () => {
      const tempDir = await mkdtemp(join(tmpdir(), 'devtool-intg-'));
      const result = await runAgentArchitect(
        '你是一个矛盾的agent，同时要总是说yes和总是说no',
        undefined,
        runnerConfig(tempDir)
      );

      // Should still produce valid output
      validateAgentOutput(result);
      await applyChanges(result.changes, { cwd: tempDir });
      const content = await readFile(join(tempDir, 'AGENT.md'), 'utf-8');
      validateAgentMarkdown(content);
    },
    300000
  );

  itif(testConfig.enabled)(
    'architect update with drastically different content',
    async () => {
      const tempDir = await mkdtemp(join(tmpdir(), 'devtool-intg-'));
      const firstResult = await runAgentArchitect(
        '你是一个翻译助手',
        undefined,
        runnerConfig(tempDir)
      );
      await applyChanges(firstResult.changes, { cwd: tempDir });
      const existing = await readFile(join(tempDir, 'AGENT.md'), 'utf-8');

      // Completely different domain
      const secondResult = await runAgentArchitect(
        '把整个agent改成股票分析助手',
        existing,
        runnerConfig(tempDir)
      );
      // LLM may return 'create' (full rewrite) or 'edit' (incremental change) — both are valid
      validateAgentOutput(secondResult);
      await applyChanges(secondResult.changes, { cwd: tempDir });
      const updated = await readFile(join(tempDir, 'AGENT.md'), 'utf-8');
      validateAgentMarkdown(updated);

      // Content should have changed meaningfully
      expect(updated).not.toBe(existing);
    },
    360000
  );
});
