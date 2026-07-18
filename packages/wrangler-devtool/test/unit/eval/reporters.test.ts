import { describe, it, expect } from 'vitest';

import { formatReport } from '../../../src/eval/reporters/console.js';
import { formatJsonReport } from '../../../src/eval/reporters/json.js';
import type { EvalReport } from '../../../src/eval/types.js';

function makeReport(overrides: Partial<EvalReport> = {}): EvalReport {
  return {
    suite: 'test-suite',
    runId: '2026-01-01T00-00-00-test-suite',
    target: { type: 'agent', path: './', skill: null },
    sampling: { runs: 1, passThreshold: 1 },
    startedAt: '2026-01-01T00:00:00.000Z',
    finishedAt: '2026-01-01T00:00:05.000Z',
    cases: [
      {
        name: 'case-a',
        samples: [
          {
            sampleIndex: 0,
            passed: true,
            results: [{ name: 'output_contains', passed: true, message: 'ok' }],
          },
        ],
        passCount: 1,
        passed: true,
      },
    ],
    totalCases: 1,
    passed: 1,
    failed: 0,
    passRate: 1,
    ...overrides,
  };
}

describe('console reporter', () => {
  it('includes suite name and target', () => {
    const output = formatReport(makeReport());
    expect(output).toContain('test-suite');
    expect(output).toContain('agent');
  });

  it('shows case name and pass count', () => {
    const output = formatReport(makeReport());
    expect(output).toContain('case-a');
    expect(output).toContain('1/1');
  });

  it('shows PASS marker for passing case', () => {
    const output = formatReport(makeReport());
    expect(output).toContain('✓');
  });

  it('shows FAIL marker for failing case', () => {
    const report = makeReport({
      cases: [
        {
          name: 'case-fail',
          samples: [
            {
              sampleIndex: 0,
              passed: false,
              results: [{ name: 'output_contains', passed: false, message: 'no match' }],
            },
          ],
          passCount: 0,
          passed: false,
        },
      ],
      passed: 0,
      failed: 1,
      passRate: 0,
    });
    const output = formatReport(report);
    expect(output).toContain('✗');
    expect(output).toContain('FAIL');
  });

  it('shows overall pass rate', () => {
    const output = formatReport(makeReport());
    expect(output).toContain('1/1');
    expect(output).toContain('100%');
    expect(output).toContain('PASS');
  });

  it('shows skill name in target when evaluating skill', () => {
    const output = formatReport(
      makeReport({
        target: { type: 'skill', path: './skills', skill: 'my-skill' },
      })
    );
    expect(output).toContain('skill/my-skill');
  });

  it('shows llm-judge scores', () => {
    const report = makeReport({
      cases: [
        {
          name: 'judged',
          samples: [
            {
              sampleIndex: 0,
              passed: true,
              results: [{ name: 'thoroughness', passed: true, score: 4, message: 'good' }],
            },
          ],
          passCount: 1,
          passed: true,
        },
      ],
    });
    const output = formatReport(report);
    expect(output).toContain('thoroughness=4');
  });
});

describe('json reporter', () => {
  it('produces valid JSON with all fields', () => {
    const report = makeReport();
    const json = formatJsonReport(report);
    const parsed = JSON.parse(json);

    expect(parsed.suite).toBe('test-suite');
    expect(parsed.runId).toBeDefined();
    expect(parsed.totalCases).toBe(1);
    expect(parsed.passed).toBe(1);
    expect(parsed.failed).toBe(0);
    expect(parsed.passRate).toBe(1);
    expect(parsed.cases).toHaveLength(1);
    expect(parsed.cases[0].name).toBe('case-a');
    expect(parsed.cases[0].passed).toBe(true);
    expect(parsed.cases[0].samples).toHaveLength(1);
    expect(parsed.cases[0].samples[0].results).toHaveLength(1);
  });

  it('preserves score field for llm-judge results', () => {
    const report = makeReport({
      cases: [
        {
          name: 'judged',
          samples: [
            {
              sampleIndex: 0,
              passed: true,
              results: [{ name: 'quality', passed: true, score: 5, message: 'excellent' }],
            },
          ],
          passCount: 1,
          passed: true,
        },
      ],
    });
    const parsed = JSON.parse(formatJsonReport(report));
    expect(parsed.cases[0].samples[0].results[0].score).toBe(5);
  });
});
