/**
 * @fileoverview Evaluator registry — dispatches EvaluatorSpec to the right evaluator.
 *
 * Deterministic evaluators handle all non-llm-judge types in one instance.
 * LlmJudgeEvaluator handles 'llm-judge' types and is lazily created (needs LLM config).
 */

import type { Evaluator, EvalTrace, EvaluatorSpec, EvalResult } from '../types.js';
import { DeterministicEvaluators } from './deterministic.js';
import { LlmJudgeEvaluator, type LlmJudgeOptions } from './llm-judge.js';

/**
 * Registry that owns evaluator instances and dispatches specs to them.
 * Create once per eval run.
 */
export class EvaluatorRegistry {
  private deterministic = new DeterministicEvaluators();
  private llmJudge: LlmJudgeEvaluator | null = null;
  private llmJudgeOptions?: LlmJudgeOptions;

  /** Determistic evaluator type keys (everything except llm-judge). */
  static readonly DETERMINISTIC_TYPES = new Set([
    'output_contains',
    'output_not_contains',
    'output_equals',
    'output_matches',
    'tool_called',
    'tool_not_called',
    'tool_called_with',
    'tool_call_count',
    'file_exists',
    'file_not_exists',
    'exit_code',
    'step_count',
  ]);

  /**
   * Configure the LLM judge. Must be called before evaluating llm-judge specs,
   * otherwise they will fail with a clear error.
   */
  configureLlmJudge(options: LlmJudgeOptions): void {
    this.llmJudgeOptions = options;
    this.llmJudge = new LlmJudgeEvaluator(options);
  }

  /**
   * Evaluate a single spec against a trace.
   * Dispatches to the deterministic evaluator or the LLM judge as appropriate.
   */
  async evaluate(trace: EvalTrace, spec: EvaluatorSpec): Promise<EvalResult> {
    if (spec.type === 'llm-judge') {
      if (!this.llmJudge) {
        return {
          name: (spec as { name?: string }).name ?? 'llm-judge',
          passed: false,
          message: 'LLM judge not configured. Call configureLlmJudge() first.',
        };
      }
      return this.llmJudge.evaluate(trace, spec);
    }
    return this.deterministic.evaluate(trace, spec);
  }

  /**
   * Evaluate all specs for a trace, returning one result per spec.
   */
  async evaluateAll(trace: EvalTrace, specs: EvaluatorSpec[]): Promise<EvalResult[]> {
    return Promise.all(specs.map((spec) => this.evaluate(trace, spec)));
  }

  /** Whether the registry has an LLM judge configured. */
  get hasLlmJudge(): boolean {
    return this.llmJudge !== null;
  }
}

/**
 * Check if a spec type requires the LLM judge.
 */
export function requiresLlmJudge(spec: EvaluatorSpec): boolean {
  return spec.type === 'llm-judge';
}

/**
 * Check if a suite uses any llm-judge evaluators.
 */
export function suiteUsesLlmJudge(specs: EvaluatorSpec[]): boolean {
  return specs.some(requiresLlmJudge);
}
