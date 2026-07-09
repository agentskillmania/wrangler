/**
 * @fileoverview Execution adapter interface — abstracts agent vs skill execution.
 *
 * Both adapters produce the same EvalTrace, so evaluators and runner don't
 * care which kind of target they're dealing with.
 */

import type { EvalCase, EvalTrace, EvalSuite } from '../types.js';

/** Options passed to adapter.execute(). */
export interface AdapterExecuteOptions {
  /** The full suite (provides target + sampling config). */
  suite: EvalSuite;
  /** Which sample this is (0-indexed). */
  sampleIndex: number;
  /** Temporary directory for this run (fixture files are set up here). */
  workspacePath: string;
}

/**
 * Execute one case once and collect the full trace.
 *
 * Implementations must:
 *   - Set up the workspace (copy fixtures, set env)
 *   - Run the agent/skill
 *   - Collect tool calls via event listeners
 *   - Restore env after completion
 *   - Return a complete EvalTrace
 */
export interface ExecutionAdapter {
  /**
   * @param caseData - The case to execute
   * @param options - Execution options (workspace, sampling, etc.)
   * @returns Complete execution trace
   */
  execute(caseData: EvalCase, options: AdapterExecuteOptions): Promise<EvalTrace>;
}
