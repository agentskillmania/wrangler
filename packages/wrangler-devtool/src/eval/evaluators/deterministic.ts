/**
 * @fileoverview Deterministic evaluators — pure functions over EvalTrace.
 *
 * These replace the old 'hard' assertions. Each handles one EvaluatorSpec type
 * and returns a boolean pass/fail with a human-readable message.
 */

import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { Evaluator, EvalTrace, EvaluatorSpec, EvalResult } from '../types.js';

/**
 * Check if an object contains all key/value pairs from a subset (shallow).
 * Used by tool_called_with for argument subset matching.
 */
function matchesSubset(
  actual: Record<string, unknown>,
  expected: Record<string, unknown>
): boolean {
  for (const [key, value] of Object.entries(expected)) {
    if (actual[key] !== value) return false;
  }
  return true;
}

/**
 * All deterministic (non-LLM) evaluators bundled into one class that
 * implements the Evaluator interface. Dispatches by spec.type.
 */
export class DeterministicEvaluators implements Evaluator {
  readonly type = 'deterministic';

  async evaluate(trace: EvalTrace, spec: EvaluatorSpec): Promise<EvalResult> {
    switch (spec.type) {
      case 'output_contains':
        return this.outputContains(trace, spec);
      case 'output_not_contains':
        return this.outputNotContains(trace, spec);
      case 'output_equals':
        return this.outputEquals(trace, spec);
      case 'output_matches':
        return this.outputMatches(trace, spec);
      case 'tool_called':
        return this.toolCalled(trace, spec);
      case 'tool_not_called':
        return this.toolNotCalled(trace, spec);
      case 'tool_called_with':
        return this.toolCalledWith(trace, spec);
      case 'tool_call_count':
        return this.toolCallCount(trace, spec);
      case 'file_exists':
        return this.fileExists(trace, spec);
      case 'file_not_exists':
        return this.fileNotExists(trace, spec);
      case 'exit_code':
        return this.exitCode(trace, spec);
      case 'step_count':
        return this.stepCount(trace, spec);
      default:
        // LLM-judge is handled by LlmJudgeEvaluator, not here.
        return {
          name: spec.type,
          passed: false,
          message: `DeterministicEvaluators cannot handle type '${spec.type}'`,
        };
    }
  }

  private outputContains(
    trace: EvalTrace,
    spec: Extract<EvaluatorSpec, { type: 'output_contains' }>
  ): EvalResult {
    const text = spec.caseInsensitive ? trace.answer.toLowerCase() : trace.answer;
    const needle = spec.caseInsensitive ? spec.value.toLowerCase() : spec.value;
    const passed = text.includes(needle);
    return {
      name: 'output_contains',
      passed,
      message: passed
        ? `Answer contains "${spec.value}"`
        : `Answer does not contain "${spec.value}"`,
    };
  }

  private outputNotContains(
    trace: EvalTrace,
    spec: Extract<EvaluatorSpec, { type: 'output_not_contains' }>
  ): EvalResult {
    const text = spec.caseInsensitive ? trace.answer.toLowerCase() : trace.answer;
    const needle = spec.caseInsensitive ? spec.value.toLowerCase() : spec.value;
    const passed = !text.includes(needle);
    return {
      name: 'output_not_contains',
      passed,
      message: passed
        ? `Answer does not contain "${spec.value}"`
        : `Answer unexpectedly contains "${spec.value}"`,
    };
  }

  private outputEquals(
    trace: EvalTrace,
    spec: Extract<EvaluatorSpec, { type: 'output_equals' }>
  ): EvalResult {
    const answer = spec.caseInsensitive ? trace.answer.toLowerCase() : trace.answer;
    const expected = spec.caseInsensitive ? spec.value.toLowerCase() : spec.value;
    const passed = answer === expected;
    return {
      name: 'output_equals',
      passed,
      message: passed
        ? 'Answer matches exactly'
        : `Expected "${spec.value}", got "${trace.answer}"`,
    };
  }

  private outputMatches(
    trace: EvalTrace,
    spec: Extract<EvaluatorSpec, { type: 'output_matches' }>
  ): EvalResult {
    let regex: RegExp;
    try {
      regex = new RegExp(spec.pattern, spec.flags);
    } catch {
      return { name: 'output_matches', passed: false, message: `Invalid regex: ${spec.pattern}` };
    }
    const passed = regex.test(trace.answer);
    return {
      name: 'output_matches',
      passed,
      message: passed
        ? `Answer matches /${spec.pattern}/${spec.flags ?? ''}`
        : `Answer does not match /${spec.pattern}/${spec.flags ?? ''}`,
    };
  }

  private toolCalled(
    trace: EvalTrace,
    spec: Extract<EvaluatorSpec, { type: 'tool_called' }>
  ): EvalResult {
    const passed = trace.toolCalls.some((tc) => tc.name === spec.tool);
    return {
      name: 'tool_called',
      passed,
      message: passed ? `Tool "${spec.tool}" was called` : `Tool "${spec.tool}" was not called`,
    };
  }

  private toolNotCalled(
    trace: EvalTrace,
    spec: Extract<EvaluatorSpec, { type: 'tool_not_called' }>
  ): EvalResult {
    const passed = !trace.toolCalls.some((tc) => tc.name === spec.tool);
    return {
      name: 'tool_not_called',
      passed,
      message: passed
        ? `Tool "${spec.tool}" was not called`
        : `Tool "${spec.tool}" was unexpectedly called`,
    };
  }

  private toolCalledWith(
    trace: EvalTrace,
    spec: Extract<EvaluatorSpec, { type: 'tool_called_with' }>
  ): EvalResult {
    const match = trace.toolCalls.find(
      (tc) => tc.name === spec.tool && matchesSubset(tc.arguments, spec.arguments)
    );
    return {
      name: 'tool_called_with',
      passed: !!match,
      message: match
        ? `Tool "${spec.tool}" called with matching arguments`
        : `No "${spec.tool}" call matched arguments ${JSON.stringify(spec.arguments)}`,
    };
  }

  private toolCallCount(
    trace: EvalTrace,
    spec: Extract<EvaluatorSpec, { type: 'tool_call_count' }>
  ): EvalResult {
    const count = trace.toolCalls.length;
    const aboveMin = spec.min === undefined || count >= spec.min;
    const belowMax = spec.max === undefined || count <= spec.max;
    const passed = aboveMin && belowMax;
    const range = `${spec.min ?? 0}–${spec.max ?? '∞'}`;
    return {
      name: 'tool_call_count',
      passed,
      message: passed
        ? `Tool call count ${count} within range ${range}`
        : `Tool call count ${count} outside range ${range}`,
    };
  }

  private async fileExists(
    trace: EvalTrace,
    spec: Extract<EvaluatorSpec, { type: 'file_exists' }>
  ): Promise<EvalResult> {
    const fullPath = join(trace.workspacePath, spec.path);
    if (!existsSync(fullPath)) {
      return {
        name: 'file_exists',
        passed: false,
        message: `File does not exist: ${spec.path}`,
      };
    }
    if (spec.contentContains) {
      try {
        const content = await readFile(fullPath, 'utf-8');
        const passed = content.includes(spec.contentContains);
        return {
          name: 'file_exists',
          passed,
          message: passed
            ? `File ${spec.path} contains "${spec.contentContains}"`
            : `File ${spec.path} does not contain "${spec.contentContains}"`,
        };
      } catch {
        return {
          name: 'file_exists',
          passed: false,
          message: `Could not read ${spec.path} to check content`,
        };
      }
    }
    return {
      name: 'file_exists',
      passed: true,
      message: `File exists: ${spec.path}`,
    };
  }

  private fileNotExists(
    trace: EvalTrace,
    spec: Extract<EvaluatorSpec, { type: 'file_not_exists' }>
  ): EvalResult {
    const fullPath = join(trace.workspacePath, spec.path);
    const passed = !existsSync(fullPath);
    return {
      name: 'file_not_exists',
      passed,
      message: passed
        ? `File does not exist: ${spec.path}`
        : `File unexpectedly exists: ${spec.path}`,
    };
  }

  private exitCode(
    trace: EvalTrace,
    spec: Extract<EvaluatorSpec, { type: 'exit_code' }>
  ): EvalResult {
    const passed = trace.result.type === spec.equals;
    return {
      name: 'exit_code',
      passed,
      message: passed
        ? `Result type is ${spec.equals}`
        : `Expected result type ${spec.equals}, got ${trace.result.type}`,
    };
  }

  private stepCount(
    trace: EvalTrace,
    spec: Extract<EvaluatorSpec, { type: 'step_count' }>
  ): EvalResult {
    const aboveMin = spec.min === undefined || trace.steps >= spec.min;
    const belowMax = spec.max === undefined || trace.steps <= spec.max;
    const passed = aboveMin && belowMax;
    const range = `${spec.min ?? 0}–${spec.max ?? '∞'}`;
    return {
      name: 'step_count',
      passed,
      message: passed
        ? `Step count ${trace.steps} within range ${range}`
        : `Step count ${trace.steps} outside range ${range}`,
    };
  }
}
