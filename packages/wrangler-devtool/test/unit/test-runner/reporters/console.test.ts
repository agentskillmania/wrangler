import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { formatReport, printReport } from '../../../../src/test-runner/reporters/console.js';
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

describe('formatReport', () => {
  it('should format empty report', () => {
    const report: TestReport = {
      suites: [],
      summary: { total: 0, passed: 0, failed: 0, duration: 0, hardPassed: 0, hardFailed: 0 },
    };
    const output = formatReport(report);
    expect(output).toContain('No test cases found');
  });

  it('should format all-passing report', () => {
    const report = makeReport([makeCaseResult('Case 1', true), makeCaseResult('Case 2', true)]);
    const output = formatReport(report);
    expect(output).toContain('Case 1');
    expect(output).toContain('Case 2');
    expect(output).toContain('2/2 passed');
    expect(output).toContain('All tests passed');
  });

  it('should format report with failures', () => {
    const report = makeReport([makeCaseResult('Case 1', true), makeCaseResult('Case 2', false)]);
    const output = formatReport(report);
    expect(output).toContain('Case 1');
    expect(output).toContain('Case 2');
    expect(output).toContain('1/2 passed');
    expect(output).toContain('1 test(s) failed');
  });

  it('should include duration formatting', () => {
    const report = makeReport([makeCaseResult('Case 1', true)]);
    const output = formatReport(report);
    expect(output).toContain('150ms');
  });

  it('should include assertion details', () => {
    const report = makeReport([
      {
        ...makeCaseResult('Case 1', false),
        hardResults: [
          { passed: true, message: 'Contains hello' },
          { passed: false, message: 'Missing goodbye' },
        ],
      },
    ]);
    const output = formatReport(report);
    expect(output).toContain('Contains hello');
    expect(output).toContain('Missing goodbye');
  });

  it('should format case duration', () => {
    const report = makeReport([
      {
        ...makeCaseResult('Case 1', true),
        duration: 2500,
      },
    ]);
    const output = formatReport(report);
    expect(output).toContain('2.50s');
  });
});

describe('printReport', () => {
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  it('should print report to console', () => {
    const report = makeReport([makeCaseResult('Case 1', true)]);
    printReport(report);
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Case 1'));
    const output = logSpy.mock.calls[0][0] as string;
    expect(output).toContain('Case 1');
  });
});
