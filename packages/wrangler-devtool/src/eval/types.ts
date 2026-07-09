/**
 * @fileoverview Evaluation framework — core type definitions.
 *
 * Replaces the old hard/soft split with a unified Evaluator abstraction.
 * All evaluators receive the same EvalTrace and return the same EvalResult.
 */

import type { RunResult } from '@agentskillmania/colts';
import type { TokenStats } from '@agentskillmania/llm-client';

// ─── Target ─────────────────────────────────────────────────

/** What is being evaluated — an agent definition or a skill. */
export interface EvalTarget {
  /** 'agent' evaluates an AGENT.md definition; 'skill' evaluates a SKILL.md. */
  type: 'agent' | 'skill';
  /** Directory containing the AGENT.md / CREW.md (for agent) or the skill parent dir (for skill). */
  path: string;
  /** When type=skill, the skill name to load via load_skill. Null for type=agent. */
  skill: string | null;
}

// ─── Sampling ───────────────────────────────────────────────

/**
 * How many times to run each case and what counts as a pass.
 *
 * - Multi-run: runs > 1, pass_threshold as a ratio (e.g. 0.67 = 2/3 must pass)
 * - Single-run: runs = 1, temperature = 0 for deterministic output
 */
export interface EvalSampling {
  /** Number of times to execute each case. */
  runs: number;
  /** Pass ratio threshold (0–1). A case passes if pass_count/runs >= threshold. */
  passThreshold: number;
  /** Temperature forwarded to the LLM. Omit to use provider default. */
  temperature?: number;
  /** Model override for the evaluated target. */
  model?: string;
  /** Max steps per run. */
  maxSteps?: number;
}

// ─── Case ───────────────────────────────────────────────────

/** A single test case. */
export interface EvalCase {
  /** Unique case identifier (used in trace filenames and reports). */
  name: string;
  /** Human-readable description of what this case checks. */
  description?: string;
  /** Input message to send to the agent/skill. */
  input: {
    message: string;
    /** Optional prior conversation turns (for multi-turn cases). */
    history?: Array<{ role: 'user' | 'assistant'; content: string }>;
  };
  /** Test environment setup before running. */
  context?: {
    /**
     * Fixture files to copy into the temporary workspace before running.
     * source = path relative to project root, target = path inside workspace.
     */
    files?: Array<{ source: string; target: string }>;
    /** Environment variables to set during the run. */
    env?: Record<string, string>;
  };
  /** Evaluators applied to this case's trace(s). */
  evaluators: EvaluatorSpec[];
}

// ─── Evaluator specs (YAML-facing) ──────────────────────────

/** A rubric level for llm-judge evaluators. */
export interface RubricLevel {
  score: number;
  description: string;
}

/**
 * Discriminated union of all evaluator specs as written in YAML.
 * Each 'type' maps to a built-in evaluator implementation.
 */
export type EvaluatorSpec =
  | { type: 'output_contains'; value: string; caseInsensitive?: boolean }
  | { type: 'output_not_contains'; value: string; caseInsensitive?: boolean }
  | { type: 'output_equals'; value: string; caseInsensitive?: boolean }
  | { type: 'output_matches'; pattern: string; flags?: string }
  | { type: 'tool_called'; tool: string }
  | { type: 'tool_not_called'; tool: string }
  | { type: 'tool_called_with'; tool: string; arguments: Record<string, unknown> }
  | { type: 'tool_call_count'; min?: number; max?: number }
  | { type: 'file_exists'; path: string; contentContains?: string }
  | { type: 'file_not_exists'; path: string }
  | { type: 'exit_code'; equals: RunResult['type'] }
  | { type: 'step_count'; min?: number; max?: number }
  | {
      type: 'llm-judge';
      name: string;
      criteria: string;
      rubric: RubricLevel[];
      minScore: number;
      /** Optional golden answer for reference-based comparison. */
      reference?: string;
    };

// ─── Suite ──────────────────────────────────────────────────

/** A complete evaluation suite, loaded from one YAML file. */
export interface EvalSuite {
  name: string;
  description?: string;
  target: EvalTarget;
  sampling: EvalSampling;
  cases: EvalCase[];
}

// ─── Trace (execution output) ───────────────────────────────

/** A recorded tool call with its arguments and result. */
export interface ToolCallRecord {
  /** Tool name, e.g. 'file_read', 'shell'. */
  name: string;
  /** Parsed arguments passed to the tool. */
  arguments: Record<string, unknown>;
  /** The result the tool returned (stringified if not serializable). */
  result?: unknown;
  /** Whether the tool call raised an error. */
  isError?: boolean;
}

/**
 * Complete execution trace from one run of one case.
 * This is the input to all evaluators.
 */
export interface EvalTrace {
  /** Name of the case this trace belongs to. */
  caseName: string;
  /** Which sample this is (0-indexed). */
  sampleIndex: number;
  /** The input message that was sent. */
  input: string;
  /** The agent's final answer text. */
  answer: string;
  /** colts native run result (type, tokens, step count). */
  result: RunResult;
  /** All tool calls recorded during the run. */
  toolCalls: ToolCallRecord[];
  /** Total steps taken. */
  steps: number;
  /** Wall-clock duration in milliseconds. */
  duration: number;
  /** Path to the temporary workspace where file operations occurred. */
  workspacePath: string;
  /** Token usage statistics. */
  tokens?: TokenStats;
}

// ─── Result ─────────────────────────────────────────────────

/** Output of a single evaluator on a single trace. */
export interface EvalResult {
  /** Evaluator name (e.g. 'output_contains', 'thoroughness'). */
  name: string;
  /** Whether the evaluator's pass condition was met. */
  passed: boolean;
  /** Numeric score (present for llm-judge; undefined for deterministic). */
  score?: number;
  /** Human-readable explanation of the judgment. */
  message: string;
}

// ─── Report ─────────────────────────────────────────────────

/** Results of one sample run. */
export interface SampleResult {
  sampleIndex: number;
  /** Individual evaluator results for this sample. */
  results: EvalResult[];
  /** Whether all evaluators passed for this sample. */
  passed: boolean;
}

/** Aggregated results for one case across all samples. */
export interface CaseReport {
  /** Case name. */
  name: string;
  /** Per-sample results. */
  samples: SampleResult[];
  /** Number of samples that passed. */
  passCount: number;
  /** Whether this case passed (passCount/runs >= passThreshold). */
  passed: boolean;
}

/** Full evaluation report. */
export interface EvalReport {
  /** Suite name. */
  suite: string;
  /** Run identifier (timestamp + suite name). */
  runId: string;
  /** What was evaluated. */
  target: EvalTarget;
  /** Sampling configuration used. */
  sampling: EvalSampling;
  /** ISO timestamp of run start. */
  startedAt: string;
  /** ISO timestamp of run end. */
  finishedAt: string;
  /** Per-case reports. */
  cases: CaseReport[];
  /** Total cases. */
  totalCases: number;
  /** Cases that passed. */
  passed: number;
  /** Cases that failed. */
  failed: number;
  /** Overall pass rate (0–1). */
  passRate: number;
}

// ─── Evaluator interface ────────────────────────────────────

/**
 * Unified evaluator interface — both deterministic and LLM-based evaluators
 * implement this. Receives the full trace, returns a result.
 */
export interface Evaluator {
  /** Evaluator type key (matches EvaluatorSpec['type']). */
  type: string;
  /** Evaluate a trace against this evaluator's spec. */
  evaluate(trace: EvalTrace, spec: EvaluatorSpec): Promise<EvalResult> | EvalResult;
}
