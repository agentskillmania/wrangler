// packages/wrangler-devtool/src/test-runner/reporters/json.ts
// JSON reporter for programmatic consumption

import type { TestReport, TestCaseResult } from '../types.js';

interface JsonCaseResult {
  name: string;
  description?: string;
  passed: boolean;
  duration: number;
  hardAssertions: {
    passed: number;
    failed: number;
    details: Array<{ type: string; passed: boolean; message: string }>;
  };
  softEvaluations?: Array<{
    name: string;
    score: number;
    passed: boolean;
    reasoning: string;
  }>;
  error?: string;
}

interface JsonSuiteResult {
  file: string;
  passed: boolean;
  cases: JsonCaseResult[];
}

interface JsonReport {
  summary: {
    total: number;
    passed: number;
    failed: number;
    duration: number;
    hardPassed: number;
    hardFailed: number;
  };
  suites: JsonSuiteResult[];
}

export function formatJsonReport(report: TestReport): string {
  const jsonReport: JsonReport = {
    summary: report.summary,
    suites: report.suites.map((suite) => ({
      file: suite.file,
      passed: suite.passed,
      cases: suite.cases.map((c) => formatCase(c)),
    })),
  };

  return JSON.stringify(jsonReport, null, 2);
}

function formatCase(result: TestCaseResult): JsonCaseResult {
  const jsonCase: JsonCaseResult = {
    name: result.case.name,
    description: result.case.description,
    passed: result.passed,
    duration: result.duration,
    hardAssertions: {
      passed: result.hardResults.filter((r) => r.passed).length,
      failed: result.hardResults.filter((r) => !r.passed).length,
      details: result.hardResults.map((r) => ({
        type: String(r.message).split(':')[0] || 'assertion',
        passed: r.passed,
        message: r.message,
      })),
    },
  };

  if (result.softResults && result.softResults.length > 0) {
    jsonCase.softEvaluations = result.softResults.map((sr: unknown) => {
      const s = sr as Record<string, unknown>;
      return {
        name: String(s.name ?? 'unknown'),
        score: Number(s.score ?? 0),
        passed: Boolean(s.passed),
        reasoning: String(s.reasoning ?? ''),
      };
    });
  }

  if (result.error) {
    jsonCase.error = result.error;
  }

  return jsonCase;
}
