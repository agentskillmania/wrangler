import { describe, it, expect } from 'vitest';
import { mkdtemp, readFile, writeFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initWorkspace } from '../../src/tools/init-workspace.js';
import { runAgentArchitect } from '../../src/agents/architect.js';
import { runSkillDesigner } from '../../src/agents/skill-designer.js';
import { runReviewer } from '../../src/agents/reviewer.js';
import { runTests } from '../../src/test-runner/runner.js';
import { applyChanges } from '../../src/utils/file-change.js';

describe('US8: End-to-end project lifecycle', () => {
  it('AC8.1-AC8.6: init, write, skill, test, review, iterate', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'devtool-lifecycle-'));

    // ── Step 1: Init workspace ──
    await initWorkspace(tempDir, { mode: 'agent' });

    const entries = await readdir(tempDir);
    expect(entries).toContain('AGENT.md');
    expect(entries).toContain('mcp.json');
    expect(entries).toContain('mcp.json.example');
    expect(entries).toContain('skills');
    expect(entries).toContain('test');
    expect(entries).toContain('.git');

    // ── Step 2: AI generates agent ──
    const agentResult = await runAgentArchitect(
      '你是一个文档整理助手。帮用户把杂乱的笔记整理成结构化文档，提取关键信息并生成摘要。',
      undefined,
      { cwd: tempDir }
    );
    expect(agentResult.changes.length).toBeGreaterThan(0);
    expect(agentResult.changes[0].file).toBe('AGENT.md');
    expect(agentResult.summary).toBeTruthy();

    await applyChanges(agentResult.changes, { cwd: tempDir });
    const agentContent = await readFile(join(tempDir, 'AGENT.md'), 'utf-8');
    expect(agentContent).toContain('name:');
    expect(agentContent).toContain('description:');

    // ── Step 3: AI generates skill ──
    const skillResult = await runSkillDesigner(
      '创建一个 skill，用于把用户的零散笔记按照主题分类整理成结构化文档',
      undefined,
      { cwd: tempDir }
    );
    expect(skillResult.changes.length).toBeGreaterThan(0);
    expect(skillResult.changes[0].file).toMatch(/skills\/.*\.md$/);
    expect(skillResult.summary).toBeTruthy();

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

    const report = await runTests(tempDir, { hardOnly: true });
    expect(report.summary.total).toBeGreaterThan(0);
    expect(report.suites.length).toBeGreaterThan(0);
    expect(report.summary.duration).toBeGreaterThan(0);

    // ── Step 5: Review agent quality ──
    const reviewResult = await runReviewer('AGENT.md', agentContent);
    expect(reviewResult.dimensions).toHaveProperty('clarity');
    expect(reviewResult.dimensions).toHaveProperty('completeness');
    expect(reviewResult.dimensions).toHaveProperty('focus');
    expect(reviewResult.dimensions).toHaveProperty('safety');
    expect(reviewResult.dimensions).toHaveProperty('efficiency');
    expect(Array.isArray(reviewResult.issues)).toBe(true);
    expect(reviewResult.summary).toBeTruthy();
    expect(reviewResult).not.toHaveProperty('changes');

    // ── Step 6: Iterate based on review ──
    const updateResult = await runAgentArchitect(
      '根据审查反馈，增加一个约束：回答必须简洁，不超过200字',
      agentContent,
      { cwd: tempDir }
    );
    expect(updateResult.changes[0].type).toBe('edit');
    expect(updateResult.changes[0].old).toBeTruthy();
    expect(updateResult.summary).toBeTruthy();
  }, 300000);
});
