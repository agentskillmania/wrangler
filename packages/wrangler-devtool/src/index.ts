// @agentskillmania/wrangler-devtool
// Wrangler development tool library

// ── Scaffolding tools ───────────────────────────────────────────
export { initProject } from './tools/init-project.js';
export type { InitOptions } from './tools/init-project.js';
export { createTemplate } from './tools/create-template.js';

// ── File changes ────────────────────────────────────────────────
export { applyChanges } from './utils/file-change.js';
export type { FileChange, ApplyOptions, ApplyResult } from './utils/file-change.js';

// ── CLI basics ──────────────────────────────────────────────────
export { ExitCode, CliError } from './cli/options.js';
export type { CliErrorJson } from './cli/options.js';

// ── Evaluation framework ────────────────────────────────────────
export { runEval, EvalRunner } from './eval/runner.js';
export type { EvalRunnerOptions, RunResult as EvalRunResult } from './eval/runner.js';
export { loadSuite } from './eval/loader.js';
export { EvaluatorRegistry } from './eval/evaluators/index.js';
export { DeterministicEvaluators } from './eval/evaluators/deterministic.js';
export { LlmJudgeEvaluator } from './eval/evaluators/llm-judge.js';
export {
  printReport as printEvalReport,
  formatReport as formatEvalReport,
} from './eval/reporters/console.js';
export { formatJsonReport as formatEvalJsonReport } from './eval/reporters/json.js';
export type {
  EvalSuite,
  EvalCase,
  EvalTarget,
  EvalSampling,
  EvalTrace,
  EvalResult,
  EvalReport,
  CaseReport,
  SampleResult,
  ToolCallRecord,
  EvaluatorSpec,
  RubricLevel,
  Evaluator,
} from './eval/types.js';

// ── Built-in skills directory path ──────────────────────────────
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Absolute path to the built-in skills directory.
 * Upper-layer applications use this to configure `skillDirs`.
 */
export const BUILTIN_SKILLS_DIR: string = join(dirname(fileURLToPath(import.meta.url)), 'skills');
