import { describe, expect } from 'vitest';
import { mkdtemp, readFile, writeFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initProject } from '../../src/tools/init-workspace.js';
import { runAgentArchitect } from '../../src/agents/architect.js';
import { runSkillDesigner } from '../../src/agents/skill-designer.js';
import { runReviewer } from '../../src/agents/reviewer.js';
import { runTests } from '../../src/test-runner/runner.js';
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

describe('US8: End-to-end project lifecycle', () => {
  itif(testConfig.enabled)(
    'AC8.1-AC8.6: init, write, skill, test, review, iterate',
    async () => {
      const tempDir = await mkdtemp(join(tmpdir(), 'devtool-lifecycle-'));

      // ── Step 1: Init workspace ──
      await initProject(tempDir, { type: 'agent' });

      const entries = await readdir(tempDir);
      expect(entries).toContain('AGENT.md');
      expect(entries).toContain('skills');
      expect(entries).toContain('test');

      // ── Step 2: AI generates agent ──
      const agentResult = await runAgentArchitect(
        '你是一个文档整理助手。帮用户把杂乱的笔记整理成结构化文档，提取关键信息并生成摘要。',
        undefined,
        runnerConfig(tempDir)
      );
      validateAgentOutput(agentResult, 'create');

      await applyChanges(agentResult.changes, { cwd: tempDir });
      const agentContent = await readFile(join(tempDir, 'AGENT.md'), 'utf-8');
      validateAgentMarkdown(agentContent);

      // ── Step 3: AI generates skill ──
      const skillResult = await runSkillDesigner(
        '创建一个 skill，用于把用户的零散笔记按照主题分类整理成结构化文档',
        undefined,
        runnerConfig(tempDir)
      );
      validateAgentOutput(skillResult, 'create');
      expect(skillResult.changes[0].file).toMatch(/skills\/.*\.md$/);

      await applyChanges(skillResult.changes, { cwd: tempDir });

      // ── Step 4: Run tests ──
      await writeFile(
        join(tempDir, 'test', '001-greeting.yaml'),
        `name: greeting-test
description: Agent should respond to a simple request
input:
  message: "请帮我整理这段笔记：今天开会讨论了三个要点"

context:
  mode: agent

expected:
  hard:
    - type: output_contains
      value: "要点"
`,
        'utf-8'
      );

      const report = await runTests(
        tempDir,
        { hardOnly: true },
        { llmClient: testConfig.llmClient }
      );
      expect(report.summary.total).toBeGreaterThan(0);
      expect(report.suites.length).toBeGreaterThan(0);
      expect(report.summary.duration).toBeGreaterThan(0);

      // ── Step 5: Review agent quality ──
      const reviewResult = await runReviewer(
        'AGENT.md',
        agentContent,
        undefined,
        runnerConfig(tempDir)
      );
      validateReviewReport(reviewResult);

      // ── Step 6: Iterate based on review ──
      const updateResult = await runAgentArchitect(
        '根据审查反馈，增加一个约束：回答必须简洁，不超过200字',
        agentContent,
        runnerConfig(tempDir)
      );
      validateAgentOutput(updateResult, 'edit');
    },
    600000
  );
});
