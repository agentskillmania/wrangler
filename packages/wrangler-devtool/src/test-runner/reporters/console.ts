// packages/wrangler-devtool/src/test-runner/reporters/console.ts
// Format test results for human reading

import type { TestReport, TestSuite, TestCaseResult, AssertionResult } from '../types.js';

function isTTY(): boolean {
  return typeof process !== 'undefined' && process.stdout?.isTTY === true;
}

const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  dim: '\x1b[2m',
  bold: '\x1b[1m',
};

function color(code: string, text: string): string {
  if (!isTTY()) return text;
  return `${code}${text}${colors.reset}`;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

function formatAssertion(result: AssertionResult, index: number): string {
  const icon = result.passed ? color(colors.green, '✓') : color(colors.red, '✗');
  const msg = result.passed ? color(colors.dim, result.message) : color(colors.red, result.message);
  return `    ${icon} Assertion ${index + 1}: ${msg}`;
}

function formatCaseResult(result: TestCaseResult, _index: number): string {
  const icon = result.passed ? color(colors.green, '✓ PASS') : color(colors.red, '✗ FAIL');

  const lines: string[] = [];
  lines.push(`  ${icon} ${result.case.name} (${formatDuration(result.duration)})`);

  if (result.error) {
    lines.push(`    ${color(colors.red, `Error: ${result.error}`)}`);
  }

  for (let i = 0; i < result.hardResults.length; i++) {
    lines.push(formatAssertion(result.hardResults[i], i));
  }

  return lines.join('\n');
}

function formatSuite(suite: TestSuite): string {
  const lines: string[] = [];
  lines.push(color(colors.bold, `Suite: ${suite.file}`));

  for (let i = 0; i < suite.cases.length; i++) {
    lines.push(formatCaseResult(suite.cases[i], i));
  }

  return lines.join('\n');
}

export function formatReport(report: TestReport): string {
  const lines: string[] = [];

  if (report.suites.length === 0) {
    lines.push(color(colors.yellow, 'No test cases found.'));
    return lines.join('\n');
  }

  for (const suite of report.suites) {
    lines.push(formatSuite(suite));
    lines.push('');
  }

  const { summary } = report;
  const passRate = summary.total > 0 ? Math.round((summary.passed / summary.total) * 100) : 0;
  const hardTotal = summary.hardPassed + summary.hardFailed;
  const hardPassRate = hardTotal > 0 ? Math.round((summary.hardPassed / hardTotal) * 100) : 0;

  lines.push(color(colors.bold, 'Summary:'));
  lines.push(`  Cases:     ${summary.passed}/${summary.total} passed (${passRate}%)`);
  lines.push(`  Hard:      ${summary.hardPassed}/${hardTotal} passed (${hardPassRate}%)`);
  lines.push(`  Failed:    ${summary.failed}`);
  lines.push(`  Duration:  ${formatDuration(summary.duration)}`);
  lines.push('');
  lines.push(
    summary.failed === 0
      ? color(colors.green, 'All tests passed.')
      : color(colors.red, `${summary.failed} test(s) failed.`)
  );

  return lines.join('\n');
}

export function printReport(report: TestReport): void {
  console.log(formatReport(report));
}
