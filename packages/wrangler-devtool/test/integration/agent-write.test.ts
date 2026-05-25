import { describe, expect } from 'vitest';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runAgentArchitect } from '../../src/agents/architect.js';
import { applyChanges } from '../../src/utils/file-change.js';
import { testConfig, itif } from './config.js';
import { validateAgentOutput, validateAgentMarkdown } from './helpers.js';

function runnerConfig(cwd: string) {
  return {
    llmClient: testConfig.llmClient!,
    workspacePath: cwd,
    model: testConfig.testModel,
  };
}

describe('US2: Generate an agent with AI', () => {
  itif(testConfig.enabled)(
    'AC2.1: agent write generates valid AGENT.md with frontmatter',
    async () => {
      const tempDir = await mkdtemp(join(tmpdir(), 'devtool-intg-'));

      const result = await runAgentArchitect(
        '你是一个简单的echo agent，只重复用户说的话',
        undefined,
        runnerConfig(tempDir)
      );

      validateAgentOutput(result, 'create');

      // Apply changes and verify actual file content
      await applyChanges(result.changes, { cwd: tempDir });
      const content = await readFile(join(tempDir, 'AGENT.md'), 'utf-8');
      validateAgentMarkdown(content);
    },
    180000
  );

  itif(testConfig.enabled)(
    'AC2.4: agent write updates existing file with edit type',
    async () => {
      const tempDir = await mkdtemp(join(tmpdir(), 'devtool-intg-'));

      // First create an agent
      const firstResult = await runAgentArchitect(
        '你是一个简单的echo agent',
        undefined,
        runnerConfig(tempDir)
      );
      await applyChanges(firstResult.changes, { cwd: tempDir });

      // Then update it
      const existing = await readFile(join(tempDir, 'AGENT.md'), 'utf-8');
      const secondResult = await runAgentArchitect(
        '增加一个要求：回答要加上emoji',
        existing,
        runnerConfig(tempDir)
      );

      validateAgentOutput(secondResult, 'edit');
    },
    300000
  );
});
