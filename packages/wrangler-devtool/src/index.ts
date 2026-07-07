// @agentskillmania/wrangler-devtool
// Wrangler development tool library

// ── Scaffolding tools ───────────────────────────────────────────
export { initProject } from './tools/init-workspace.js';
export type { InitOptions } from './tools/init-workspace.js';
export { createTemplate } from './tools/create-template.js';

// ── File changes ────────────────────────────────────────────────
export { applyChanges } from './utils/file-change.js';
export type { FileChange, ApplyOptions, ApplyResult } from './utils/file-change.js';

// ── CLI basics ──────────────────────────────────────────────────
export { ExitCode, CliError } from './cli/options.js';
export type { CliErrorJson } from './cli/options.js';

// ── test-runner (kept as-is, Phase 2 rework) ────────────────────
export { runTests, TestRunner } from './test-runner/runner.js';
export type {
  TestReport,
  TestSuite,
  TestCaseResult,
  TestSummary,
  TestCliOptions,
} from './test-runner/types.js';

export { loadTestCases, loadTestFile, discoverTestFiles } from './test-runner/loader.js';
export type { TestCase, TestLoaderError } from './test-runner/loader.js';

export { evaluateAssertion } from './test-runner/assertions.js';
export type { AssertionResult } from './test-runner/types.js';

export { printReport, formatReport } from './test-runner/reporters/console.js';
export { formatJsonReport } from './test-runner/reporters/json.js';
export { evaluateSoft } from './test-runner/soft-evaluator.js';
export type { SoftEvaluationResult } from './test-runner/soft-evaluator.js';

// ── Built-in skills directory path ──────────────────────────────
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Absolute path to the built-in skills directory.
 * Upper-layer applications use this to configure `skillDirs`.
 */
export const BUILTIN_SKILLS_DIR: string = join(
  dirname(fileURLToPath(import.meta.url)),
  'skills'
);
