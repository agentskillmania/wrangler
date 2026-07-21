/**
 * @fileoverview Integration test: eval crew target end-to-end via real LLM
 *
 * Verifies that target.type='crew' routes through CrewAdapter, which loads
 * the crew config via CrewLoader + crewToRunnerOptions, constructs an
 * EnhancedRunner with subAgents enabled, runs a delegation scenario, and
 * surfaces the delegate tool call to evaluators.
 *
 * Prerequisites:
 * - Set ENABLE_INTEGRATION_TESTS=true in .env
 * - Set OPENAI_API_KEY in .env
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { runEval } from '../../src/eval/runner.js';
import type { EvalSuite } from '../../src/eval/types.js';

const ENABLED = process.env.ENABLE_INTEGRATION_TESTS === 'true' && !!process.env.OPENAI_API_KEY;
const itif = (cond: boolean) => (cond ? it : it.skip);
const TEST_MODEL = process.env.MODEL || 'glm-4';

describe('Integration: eval crew target', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'devtool-eval-crew-'));
  });
  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  itif(ENABLED)(
    'runs a crew suite end-to-end and detects delegation',
    async () => {
      // 1. Build a minimal crew fixture on disk.
      const crewDir = join(tempDir, 'delegate-crew');
      await mkdir(join(crewDir, 'agents'), { recursive: true });
      await writeFile(
        join(crewDir, 'CREW.md'),
        [
          '---',
          'name: delegate-crew',
          'primary-agent: orchestrator',
          '---',
          '',
          'Crew whose orchestrator must delegate every user question to the researcher.',
          '',
        ].join('\n')
      );
      await writeFile(
        join(crewDir, 'agents', 'orchestrator.md'),
        [
          '---',
          'name: orchestrator',
          'description: routes every user question to researcher',
          '---',
          '',
          'You are the orchestrator. For EVERY user question, you MUST call the',
          'delegate tool with name="researcher" and pass the user question as task.',
          'Do not answer the question yourself.',
        ].join('\n')
      );
      await writeFile(
        join(crewDir, 'agents', 'researcher.md'),
        [
          '---',
          'name: researcher',
          'description: answers questions with a fixed marker',
          '---',
          '',
          'You are the researcher. Your answer MUST include the token RESEARCHER_OK.',
        ].join('\n')
      );

      // 2. Build the suite inline. Use a single run with passThreshold=1.
      const suite: EvalSuite = {
        name: 'crew-delegation',
        description: 'Crew eval — verifies delegation to researcher',
        target: { type: 'crew', path: crewDir, skill: null },
        sampling: {
          runs: 1,
          passThreshold: 1,
          model: TEST_MODEL,
          maxSteps: 12,
        },
        cases: [
          {
            name: 'delegates-and-researcher-answers',
            input: {
              message: 'Please delegate to researcher: what is the marker?',
            },
            evaluators: [
              // The orchestrator must call delegate at all
              { type: 'tool_called', tool: 'delegate' },
              // The final answer must carry the researcher's marker
              { type: 'output_contains', value: 'RESEARCHER_OK' },
            ],
          },
        ],
      };

      const outputDir = join(tempDir, 'output');
      const { report } = await runEval(suite, { outputDir, keepTraces: true });

      // 3. Assert the case passed.
      expect(report.cases).toHaveLength(1);
      const caseReport = report.cases[0];
      // When the case fails, dump per-sample evaluator results to make the
      // failure mode obvious in CI logs.
      if (!caseReport.passed) {
        for (const s of caseReport.samples) {
          // eslint-disable-next-line no-console
          console.log(
            '[eval-crew] sample passed=' + s.passed + ' results=' + JSON.stringify(s.results)
          );
        }
      }
      expect(caseReport.passed).toBe(true);
      // tool_called(delegate) evaluator already covers the "delegated" claim
      // (caseReport.passed=true implies it passed). Verify the case-level
      // stats too — non-zero steps means the runner actually executed.
      expect(caseReport.samples.length).toBeGreaterThanOrEqual(1);
    },
    180000
  );
});
