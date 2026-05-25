// @agentskillmania/wrangler-devtool
// Wrangler development tool library

// ── Primary API ──────────────────────────────────────────────────
export { DevTool } from './devtool.js';
export type { DevToolOptions } from './devtool.js';

// ── Low-level exports ────────────────────────────────────────────

export { ExitCode, CliError } from './cli/options.js';
export type { CliErrorJson } from './cli/options.js';

export { initProject } from './tools/init-workspace.js';
export type { InitOptions } from './tools/init-workspace.js';

export { createTemplate } from './tools/create-template.js';

export { forkSession, listSessions } from './tools/session-manager.js';
export type { ForkOptions, ListOptions } from './tools/session-manager.js';

export { applyChanges } from './utils/file-change.js';
export type { FileChange, ApplyOptions, ApplyResult } from './utils/file-change.js';

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

// Phase 3: Config and LLM
export { loadConfig, requireLLMConfig } from './config.js';
export type { LLMConfig, DevToolConfig, LoadConfigOptions } from './config.js';

export { createLLMClient } from './llm.js';

// Phase 3: Agents
export { runAgentArchitect, createArchitectRunner } from './agents/architect.js';
export { runSkillDesigner, createSkillDesignerRunner } from './agents/skill-designer.js';
export { runCrewComposer, createCrewComposerRunner } from './agents/crew-composer.js';
export { runReviewer, createReviewerRunner } from './agents/reviewer.js';
export {
  runSessionCurator,
  createCuratorRunnerWrapper as createSessionCuratorRunner,
} from './agents/session-curator.js';

export {
  loadPromptTemplate,
  parseAgentOutput,
  parseReviewReport,
  createGenerationRunner,
  createReviewRunner,
  createCuratorRunner,
  runGenerationWithLoop,
  runReview as runReviewAgent,
  runCurator as runCuratorAgent,
} from './agents/orchestrator.js';
export type { RunnerConfig } from './agents/orchestrator.js';

export type {
  AgentOutput,
  ReviewReport,
  ReviewDimension,
  ReviewIssue,
  SessionSummary,
  AgentOptions,
  AgentRunOptions,
} from './agents/types.js';
