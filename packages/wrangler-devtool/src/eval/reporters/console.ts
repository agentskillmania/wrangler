/**
 * @fileoverview Console reporter — human-readable table output.
 */

import type { EvalReport } from '../types.js';

/**
 * Format an eval report as a human-readable table.
 */
export function formatReport(report: EvalReport): string {
  const lines: string[] = [];

  const target = report.target.skill
    ? `skill/${report.target.skill}`
    : `agent (${report.target.path})`;

  lines.push(
    `Suite: ${report.suite}  Target: ${target}  Runs: ${report.sampling.runs}`
  );
  lines.push('─'.repeat(60));

  // Header
  const header = pad('CASE', 32) + pad('PASS', 8) + pad('SCORES', 24) + 'DURATION';
  lines.push(header);
  lines.push('─'.repeat(60));

  for (const caseReport of report.cases) {
    const passStr = `${caseReport.passCount}/${report.sampling.runs}`;
    const passMarker = caseReport.passed ? '✓' : '✗';
    const scores = formatScores(caseReport);
    const duration = formatDuration(caseReport);

    lines.push(
      pad(caseReport.name, 32) +
        pad(`${passStr} ${passMarker}`, 8) +
        pad(scores, 24) +
        duration
    );
  }

  lines.push('─'.repeat(60));
  const overall = report.passed >= report.failed ? 'PASS' : 'FAIL';
  lines.push(
    `${report.passed}/${report.totalCases} cases passed (${(report.passRate * 100).toFixed(0)}%) — ${overall}`
  );
  lines.push(`Run dir: see report.json`);

  return lines.join('\n');
}

/** Print the report to stdout. */
export function printReport(report: EvalReport): void {
  console.log(formatReport(report));
}

function pad(str: string, len: number): string {
  if (str.length >= len) return str.slice(0, len - 1) + ' ';
  return str + ' '.repeat(len - str.length);
}

function formatScores(caseReport: EvalReport['cases'][number]): string {
  // Use the last sample's scores (most recent)
  const lastSample = caseReport.samples[caseReport.samples.length - 1];
  if (!lastSample) return '';

  const parts: string[] = [];
  for (const result of lastSample.results) {
    if (result.score !== undefined) {
      parts.push(`${result.name}=${result.score}`);
    }
  }
  return parts.join(', ') || '(deterministic)';
}

function formatDuration(caseReport: EvalReport['cases'][number]): string {
  // Duration isn't in CaseReport directly; we skip it for now
  return '-';
}
