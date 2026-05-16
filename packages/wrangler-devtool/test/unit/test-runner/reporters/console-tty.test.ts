import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { formatReport } from '../../../../src/test-runner/reporters/console.js';
import type { TestCaseResult } from '../../../../src/test-runner/types.js';

function makeReport(cases: TestCaseResult[]) {
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

describe('console reporter TTY', () => {
  let originalTTY: boolean | undefined;

  beforeEach(() => {
    originalTTY = process.stdout.isTTY;
  });

  afterEach(() => {
    Object.defineProperty(process.stdout, 'isTTY', {
      value: originalTTY,
      writable: true,
      configurable: true,
    });
  });

  it('should include ANSI colors when TTY', () => {
    Object.defineProperty(process.stdout, 'isTTY', {
      value: true,
      writable: true,
      configurable: true,
    });

    const report = makeReport([makeCaseResult('Case 1', true)]);
    const output = formatReport(report);
    expect(output).toContain('\x1b[');
  });

  it('should not include ANSI colors when not TTY', () => {
    Object.defineProperty(process.stdout, 'isTTY', {
      value: false,
      writable: true,
      configurable: true,
    });

    const report = makeReport([makeCaseResult('Case 1', true)]);
    const output = formatReport(report);
    expect(output).not.toContain('\x1b[');
  });
});
