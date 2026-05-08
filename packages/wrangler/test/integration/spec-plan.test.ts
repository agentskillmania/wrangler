/**
 * Spec/Plan 集成测试 — 覆盖 US1-US8
 *
 * US1: 创建和存储 Spec 文档
 * US2: 创建和存储 Plan 文档
 * US3: Skill 生成 Spec
 * US4: 审查 Spec
 * US5: Skill 生成 Plan
 * US6: 审查 Plan
 * US7: Spec/Plan 完整工作流
 * US8: 执行 Plan
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { SpecStore } from '../../src/spec-plan/spec-store.js';
import { PlanStore } from '../../src/spec-plan/plan-store.js';
import {
  WRITING_SPEC_CONTENT,
  REVIEW_SPEC_CONTENT,
  WRITING_PLAN_CONTENT,
  REVIEW_PLAN_CONTENT,
  EXECUTE_PLAN_CONTENT,
} from '../../src/spec-plan/index.js';
import type { SpecDocument, PlanDocument } from '../../src/spec-plan/types.js';

describe('Spec/Plan Integration', () => {
  let testDir: string;
  let specStore: SpecStore;
  let planStore: PlanStore;
  const workspacePath = '/test/project';

  beforeEach(async () => {
    testDir = join(tmpdir(), `spec-plan-intg-${Date.now()}`);
    await mkdir(testDir, { recursive: true });
    specStore = new SpecStore(join(testDir, 'specs'), workspacePath);
    planStore = new PlanStore(join(testDir, 'plans'), workspacePath);
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  // --- US1: 创建和存储 Spec 文档 ---

  describe('US1: 创建和存储 Spec 文档', () => {
    const makeSpec = (v = 1): SpecDocument => ({
      meta: {
        name: 'user-login',
        version: v,
        status: 'draft',
        workspacePath,
        createdAt: `2026-04-23T14:30:0${v}.000Z`,
        updatedAt: `2026-04-23T14:30:0${v}.000Z`,
      },
      body: '# User Login\n\n## Goal\nImplement authentication.',
    });

    it('saves and retrieves spec', async () => {
      await specStore.save(makeSpec());
      const doc = await specStore.get('user-login', 1);
      expect(doc).not.toBeNull();
      expect(doc!.meta.name).toBe('user-login');
      expect(doc!.body).toContain('User Login');
    });

    it('lists specs', async () => {
      await specStore.save(makeSpec(1));
      await specStore.save(makeSpec(2));
      const list = await specStore.list();
      expect(list).toHaveLength(2);
    });

    it('getLatest returns highest version', async () => {
      await specStore.save(makeSpec(1));
      await specStore.save(makeSpec(3));
      await specStore.save(makeSpec(2));
      const latest = await specStore.getLatest('user-login');
      expect(latest!.meta.version).toBe(3);
    });

    it('updateStatus transitions draft → approved → superseded', async () => {
      await specStore.save(makeSpec());
      await specStore.updateStatus('user-login', 1, 'approved');
      expect((await specStore.get('user-login', 1))!.meta.status).toBe('approved');

      await specStore.updateStatus('user-login', 1, 'superseded');
      expect((await specStore.get('user-login', 1))!.meta.status).toBe('superseded');
    });

    it('updateStatus rejects invalid transition', async () => {
      await specStore.save(makeSpec());
      await expect(specStore.updateStatus('user-login', 1, 'superseded')).rejects.toThrow();
    });
  });

  // --- US2: 创建和存储 Plan 文档 ---

  describe('US2: 创建和存储 Plan 文档', () => {
    const makePlan = (sv = 1, pv = 1): PlanDocument => ({
      meta: {
        name: 'user-login',
        specName: 'user-login',
        specVersion: sv,
        version: pv,
        status: 'draft',
        workspacePath,
        createdAt: `2026-04-23T15:00:0${pv}.000Z`,
        updatedAt: `2026-04-23T15:00:0${pv}.000Z`,
      },
      body: '# Implementation Plan\n\n## Task 1\n- [ ] Step 1',
    });

    it('saves and retrieves plan', async () => {
      await planStore.save(makePlan());
      const doc = await planStore.get('user-login', 1, 1);
      expect(doc).not.toBeNull();
      expect(doc!.meta.specVersion).toBe(1);
    });

    it('getLatestForSpec returns latest plan for a spec', async () => {
      await planStore.save(makePlan(1, 1));
      await planStore.save(makePlan(1, 3));
      await planStore.save(makePlan(1, 2));
      const latest = await planStore.getLatestForSpec('user-login');
      expect(latest!.meta.version).toBe(3);
    });

    it('updateStatus transitions draft → approved → executing → completed', async () => {
      await planStore.save(makePlan());
      await planStore.updateStatus('user-login', 1, 1, 'approved');
      expect((await planStore.get('user-login', 1, 1))!.meta.status).toBe('approved');

      await planStore.updateStatus('user-login', 1, 1, 'executing');
      expect((await planStore.get('user-login', 1, 1))!.meta.status).toBe('executing');

      await planStore.updateStatus('user-login', 1, 1, 'completed');
      expect((await planStore.get('user-login', 1, 1))!.meta.status).toBe('completed');
    });

    it('different specs do not interfere', async () => {
      await planStore.save(makePlan(1, 1) /* name=user-login, specName=user-login */);
      const otherPlan: PlanDocument = {
        meta: {
          name: 'auth-v2',
          specName: 'auth-v2',
          specVersion: 1,
          version: 1,
          status: 'draft',
          workspacePath,
          createdAt: '2026-04-23T16:00:00.000Z',
          updatedAt: '2026-04-23T16:00:00.000Z',
        },
        body: '# Auth V2',
      };
      await planStore.save(otherPlan);

      const latestA = await planStore.getLatestForSpec('user-login');
      const latestB = await planStore.getLatestForSpec('auth-v2');
      expect(latestA!.meta.specName).toBe('user-login');
      expect(latestB!.meta.specName).toBe('auth-v2');
    });
  });

  // --- US3: Skill 生成 Spec ---

  describe('US3: Skill 生成 Spec', () => {
    it('WRITING_SPEC_CONTENT contains interview strategy', () => {
      expect(WRITING_SPEC_CONTENT).toContain('先自己找答案');
      expect(WRITING_SPEC_CONTENT).toContain('给出你的推荐');
      expect(WRITING_SPEC_CONTENT).toContain('一次只问一个问题');
    });

    it('WRITING_SPEC_CONTENT contains document format', () => {
      expect(WRITING_SPEC_CONTENT).toContain('status: draft');
      expect(WRITING_SPEC_CONTENT).toContain('spec-v1');
    });

    it('WRITING_SPEC_CONTENT contains hard gate', () => {
      expect(WRITING_SPEC_CONTENT).toContain('禁止执行任何操作');
    });

    it('WRITING_SPEC_CONTENT contains review-spec call', () => {
      expect(WRITING_SPEC_CONTENT).toContain('review-spec');
    });

    it('WRITING_SPEC_CONTENT is in Chinese', () => {
      expect(WRITING_SPEC_CONTENT).toContain('访谈');
      expect(WRITING_SPEC_CONTENT).toContain('验收标准');
    });
  });

  // --- US4: 审查 Spec ---

  describe('US4: 审查 Spec', () => {
    it('REVIEW_SPEC_CONTENT contains 4 dimensions', () => {
      expect(REVIEW_SPEC_CONTENT).toContain('覆盖度');
      expect(REVIEW_SPEC_CONTENT).toContain('清晰度');
      expect(REVIEW_SPEC_CONTENT).toContain('可行性');
      expect(REVIEW_SPEC_CONTENT).toContain('完整性');
    });

    it('REVIEW_SPEC_CONTENT produces visible report', () => {
      expect(REVIEW_SPEC_CONTENT).toContain('审查报告');
      expect(REVIEW_SPEC_CONTENT).toContain('不通过');
      expect(REVIEW_SPEC_CONTENT).toContain('建议');
    });
  });

  // --- US5: Skill 生成 Plan ---

  describe('US5: Skill 生成 Plan', () => {
    it('WRITING_PLAN_CONTENT contains acceptance criteria', () => {
      expect(WRITING_PLAN_CONTENT).toContain('验收');
      expect(WRITING_PLAN_CONTENT).toContain('验收条件');
    });

    it('WRITING_PLAN_CONTENT contains phase templates', () => {
      expect(WRITING_PLAN_CONTENT).toContain('构建类任务');
      expect(WRITING_PLAN_CONTENT).toContain('分析/调研类任务');
      expect(WRITING_PLAN_CONTENT).toContain('配置/运维类任务');
    });

    it('WRITING_PLAN_CONTENT calls review-plan', () => {
      expect(WRITING_PLAN_CONTENT).toContain('review-plan');
    });

    it('WRITING_PLAN_CONTENT hands off to execute-plan', () => {
      expect(WRITING_PLAN_CONTENT).toContain('execute-plan');
    });
  });

  // --- US6: 审查 Plan ---

  describe('US6: 审查 Plan', () => {
    it('REVIEW_PLAN_CONTENT contains 6 dimensions', () => {
      expect(REVIEW_PLAN_CONTENT).toContain('覆盖度');
      expect(REVIEW_PLAN_CONTENT).toContain('一致性');
      expect(REVIEW_PLAN_CONTENT).toContain('顺序');
      expect(REVIEW_PLAN_CONTENT).toContain('无占位符');
      expect(REVIEW_PLAN_CONTENT).toContain('可验证');
      expect(REVIEW_PLAN_CONTENT).toContain('粒度');
    });

    it('REVIEW_PLAN_CONTENT loads associated spec', () => {
      expect(REVIEW_PLAN_CONTENT).toContain('specName');
      expect(REVIEW_PLAN_CONTENT).toContain('specVersion');
    });
  });

  // --- US7: Spec/Plan 完整工作流 ---

  describe('US7: Spec/Plan 完整工作流', () => {
    it('full lifecycle: create spec → approve → create plan → approve', async () => {
      // 1. Create spec
      const spec: SpecDocument = {
        meta: {
          name: 'feature-x',
          version: 1,
          status: 'draft',
          workspacePath,
          createdAt: '2026-04-23T10:00:00.000Z',
          updatedAt: '2026-04-23T10:00:00.000Z',
        },
        body: '# Feature X\n\n## Goal\nBuild feature X.\n\n## Requirements\n- FR-001: Must do A\n- FR-002: Should do B',
      };
      await specStore.save(spec);

      // 2. Approve spec
      await specStore.updateStatus('feature-x', 1, 'approved');
      const approvedSpec = await specStore.get('feature-x', 1);
      expect(approvedSpec!.meta.status).toBe('approved');

      // 3. Create plan from spec
      const plan: PlanDocument = {
        meta: {
          name: 'feature-x',
          specName: 'feature-x',
          specVersion: 1,
          version: 1,
          status: 'draft',
          workspacePath,
          createdAt: '2026-04-23T11:00:00.000Z',
          updatedAt: '2026-04-23T11:00:00.000Z',
        },
        body: '# Implementation Plan\n\n## Task 1\n- [ ] Implement FR-001\n## Task 2\n- [ ] Implement FR-002',
      };
      await planStore.save(plan);

      // 4. Approve plan
      await planStore.updateStatus('feature-x', 1, 1, 'approved');
      const approvedPlan = await planStore.get('feature-x', 1, 1);
      expect(approvedPlan!.meta.status).toBe('approved');
    });

    it('spec review loop: draft → revise → pass', async () => {
      const spec: SpecDocument = {
        meta: {
          name: 'feature-y',
          version: 1,
          status: 'draft',
          workspacePath,
          createdAt: '2026-04-23T10:00:00.000Z',
          updatedAt: '2026-04-23T10:00:00.000Z',
        },
        body: '# Feature Y (initial)',
      };
      await specStore.save(spec);

      // Simulate revision: update body and re-save
      spec.body = '# Feature Y (revised after review)';
      await specStore.save(spec);

      const doc = await specStore.get('feature-y', 1);
      expect(doc!.body).toContain('revised after review');

      // Now approve
      await specStore.updateStatus('feature-y', 1, 'approved');
      expect((await specStore.get('feature-y', 1))!.meta.status).toBe('approved');
    });
  });

  // --- US8: 执行 Plan ---

  describe('US8: 执行 Plan', () => {
    it('EXECUTE_PLAN_CONTENT contains todolist creation', () => {
      expect(EXECUTE_PLAN_CONTENT).toContain('todolist');
      expect(EXECUTE_PLAN_CONTENT).toContain('reset');
    });

    it('EXECUTE_PLAN_CONTENT contains step-by-step execution', () => {
      expect(EXECUTE_PLAN_CONTENT).toContain('逐任务执行');
      expect(EXECUTE_PLAN_CONTENT).toContain('in_progress');
      expect(EXECUTE_PLAN_CONTENT).toContain('completed');
    });

    it('EXECUTE_PLAN_CONTENT contains verification', () => {
      expect(EXECUTE_PLAN_CONTENT).toContain('验证验收条件');
    });

    it('EXECUTE_PLAN_CONTENT contains exception handling', () => {
      expect(EXECUTE_PLAN_CONTENT).toContain('阻塞');
      expect(EXECUTE_PLAN_CONTENT).toContain('不要自己悄悄绕过问题');
    });

    it('EXECUTE_PLAN_CONTENT updates plan status on completion', () => {
      expect(EXECUTE_PLAN_CONTENT).toContain('completed');
      expect(EXECUTE_PLAN_CONTENT).toContain('收尾');
    });

    it('plan status transitions through full lifecycle', async () => {
      const plan: PlanDocument = {
        meta: {
          name: 'feature-z',
          specName: 'feature-z',
          specVersion: 1,
          version: 1,
          status: 'draft',
          workspacePath,
          createdAt: '2026-04-23T12:00:00.000Z',
          updatedAt: '2026-04-23T12:00:00.000Z',
        },
        body: '# Plan Z',
      };
      await planStore.save(plan);

      // draft → approved → executing → completed
      await planStore.updateStatus('feature-z', 1, 1, 'approved');
      await planStore.updateStatus('feature-z', 1, 1, 'executing');
      await planStore.updateStatus('feature-z', 1, 1, 'completed');

      const doc = await planStore.get('feature-z', 1, 1);
      expect(doc!.meta.status).toBe('completed');
    });
  });
});
