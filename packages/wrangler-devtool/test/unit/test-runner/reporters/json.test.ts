import { describe, it, expect } from 'vitest';
import { formatJsonReport } from '../../../../src/test-runner/reporters/json.js';
import type { TestReport, TestCaseResult } from '../../../../src/test-runner/types.js';

function makeReport(cases: TestCaseResult[]): TestReport {
  return {
    suites: [
      {
        file: '/path/to/tests',
        cases,
        passed: cases.every((c) => c.passed),
      },
    ],
    summary: {
      total: cases.length,
      passed: cases.filter((c) => c.passed).length,
      failed: cases.filter((c) => !c.passed).length,
      duration: 150,
      hardPassed: cases.reduce((sum, c) => sum + c.hardResults.filter((r) => r.passed).length, 0),
      hardFailed: cases.reduce((sum, c) => sum + c.hardResults.filter((r) => !r.passed).length, 0),
    },
  };
}

function makeCaseResult(name: string, passed: boolean): TestCaseResult {
  return {
    case: {
      name,
      input: { message: 'test' },
      expected: { hard: [{ type: 'output_contains', value: 'test' }] },
      sourceFile: '/path/to/test.yaml',
    },
    passed,
    duration: 50,
    hardResults: [
      {
        passed,
        message: passed ? 'Output contains "test"' : 'Expected output to contain "test"',
      },
    ],
    output: {
      answer: 'test output',
      toolCalls: [],
      resultType: 'success',
      totalSteps: 1,
    },
  };
}

describe('formatJsonReport', () => {
  it('should produce valid JSON for empty report', () => {
    const report: TestReport = {
      suites: [],
      summary: { total: 0, passed: 0, failed: 0, duration: 0, hardPassed: 0, hardFailed: 0 },
    };

    const result = formatJsonReport(report);

    expect(() => JSON.parse(result)).not.toThrow();
    const parsed = JSON.parse(result);
    expect(parsed.summary.total).toBe(0);
    expect(parsed.suites).toEqual([]);
  });

  it('should include hard assertion counts and details', () => {
    const report = makeReport([
      {
        ...makeCaseResult('Case 1', false),
        hardResults: [
          { passed: true, message: 'output_contains: found hello' },
          { passed: false, message: 'output_contains: missing goodbye' },
        ],
      },
    ]);

    const result = formatJsonReport(report);
    const parsed = JSON.parse(result);
    const c = parsed.suites[0].cases[0];

    expect(c.hardAssertions.passed).toBe(1);
    expect(c.hardAssertions.failed).toBe(1);
    expect(c.hardAssertions.details).toHaveLength(2);
    expect(c.hardAssertions.details[0].type).toBe('output_contains');
    expect(c.hardAssertions.details[1].type).toBe('output_contains');
  });

  it('should include soft evaluations when present', () => {
    const report = makeReport([
      {
        ...makeCaseResult('Case 1', true),
        softResults: [{ name: 'quality', score: 4, passed: true, reasoning: 'Good output' }],
      },
    ]);

    const result = formatJsonReport(report);
    const parsed = JSON.parse(result);
    const c = parsed.suites[0].cases[0];

    expect(c.softEvaluations).toHaveLength(1);
    expect(c.softEvaluations[0].name).toBe('quality');
    expect(c.softEvaluations[0].score).toBe(4);
    expect(c.softEvaluations[0].passed).toBe(true);
  });

  it('should omit softEvaluations when not present', () => {
    const report = makeReport([makeCaseResult('Case 1', true)]);

    const result = formatJsonReport(report);
    const parsed = JSON.parse(result);

    expect(parsed.suites[0].cases[0].softEvaluations).toBeUndefined();
  });

  it('should include error when present', () => {
    const report = makeReport([
      {
        ...makeCaseResult('Case 1', false),
        error: 'Agent timed out after 30s',
      },
    ]);

    const result = formatJsonReport(report);
    const parsed = JSON.parse(result);

    expect(parsed.suites[0].cases[0].error).toBe('Agent timed out after 30s');
  });

  it('should handle assertion message without colon', () => {
    const report = makeReport([
      {
        ...makeCaseResult('Case 1', false),
        hardResults: [{ passed: false, message: 'simple assertion message' }],
      },
    ]);

    const result = formatJsonReport(report);
    const parsed = JSON.parse(result);

    expect(parsed.suites[0].cases[0].hardAssertions.details[0].type).toBe(
      'simple assertion message'
    );
  });

  it('should format multi-suite report', () => {
    const report: TestReport = {
      suites: [
        {
          file: '/tests/suite-a',
          cases: [makeCaseResult('A1', true)],
          passed: true,
        },
        {
          file: '/tests/suite-b',
          cases: [makeCaseResult('B1', false)],
          passed: false,
        },
      ],
      summary: { total: 2, passed: 1, failed: 1, duration: 300, hardPassed: 1, hardFailed: 1 },
    };

    const result = formatJsonReport(report);
    const parsed = JSON.parse(result);

    expect(parsed.suites).toHaveLength(2);
    expect(parsed.suites[0].file).toBe('/tests/suite-a');
    expect(parsed.suites[1].file).toBe('/tests/suite-b');
    expect(parsed.summary.passed).toBe(1);
    expect(parsed.summary.failed).toBe(1);
  });
});
