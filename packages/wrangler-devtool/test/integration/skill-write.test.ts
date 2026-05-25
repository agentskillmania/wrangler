import { describe, expect } from 'vitest';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runSkillDesigner } from '../../src/agents/skill-designer.js';
import { testConfig, itif } from './config.js';
import { validateAgentOutput, validateSkillMarkdown } from './helpers.js';

function runnerConfig(cwd: string) {
  return {
    llmClient: testConfig.llmClient!,
    workspacePath: cwd,
    model: testConfig.testModel,
  };
}

describe('US7: Generate a skill with AI', () => {
  itif(testConfig.enabled)(
    'AC7.1-AC7.2: skill write generates valid skill file',
    async () => {
      const tempDir = await mkdtemp(join(tmpdir(), 'devtool-intg-'));

      const result = await runSkillDesigner(
        '创建一个skill，用于处理用户的问候语，要友好热情',
        undefined,
        runnerConfig(tempDir)
      );

      validateAgentOutput(result, 'create');

      const change = result.changes[0];
      expect(change.file).toMatch(/skills\/.*\.md$/);
      validateSkillMarkdown(change.new!);
    },
    180000
  );
});
