import { describe, expect } from 'vitest';
import { runReviewer } from '../../src/agents/reviewer.js';
import { testConfig, itif } from './config.js';
import { validateReviewReport, validateIssues } from './helpers.js';

function runnerConfig() {
  return {
    llmClient: testConfig.llmClient!,
    workspacePath: testConfig.baseUrl ?? 'unused',
    model: testConfig.testModel,
  };
}

describe('US4: Review agent quality', () => {
  itif(testConfig.enabled)(
    'AC4.1: review produces valid report for minimal content',
    async () => {
      const content = `---
name: bad-agent
description: No instructions
---
`;
      const result = await runReviewer('AGENT.md', content, undefined, runnerConfig());

      validateReviewReport(result);
    },
    60000
  );

  itif(testConfig.enabled)(
    'AC4.3-AC4.5: review output is read-only with valid issues',
    async () => {
      const content = `---
name: test-agent
description: A helpful assistant
---
You are a helpful assistant. Answer user questions clearly and concisely.
`;
      const result = await runReviewer('AGENT.md', content, undefined, runnerConfig());

      validateReviewReport(result);

      // Review must not produce file changes
      expect(result).not.toHaveProperty('changes');

      // Issues must have valid structure when present
      validateIssues(result.issues);
    },
    120000
  );
});
