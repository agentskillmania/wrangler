// packages/wrangler-devtool/src/test-runner/assertions.ts
// Hard assertion implementations

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { HardAssertion, AssertionResult, AgentRunOutput } from './types.js';

export function evaluateAssertion(
  assertion: HardAssertion,
  output: AgentRunOutput,
  workspacePath: string
): AssertionResult {
  switch (assertion.type) {
    case 'output_contains':
      return evaluateOutputContains(assertion, output);
    case 'output_not_contains':
      return evaluateOutputNotContains(assertion, output);
    case 'output_matches':
      return evaluateOutputMatches(assertion, output);
    case 'tool_called':
      return evaluateToolCalled(assertion, output);
    case 'tool_not_called':
      return evaluateToolNotCalled(assertion, output);
    case 'tool_called_with':
      return evaluateToolCalledWith(assertion, output);
    case 'file_exists':
      return evaluateFileExists(assertion, workspacePath);
    case 'file_not_exists':
      return evaluateFileNotExists(assertion, workspacePath);
    case 'exit_code':
      return evaluateExitCode(assertion, output);
    default: {
      // Exhaustive check — should never reach here due to loader validation
      return {
        passed: false,
        message: `Unknown assertion type: ${(assertion as { type: string }).type}`,
      };
    }
  }
}

function evaluateOutputContains(assertion: HardAssertion, output: AgentRunOutput): AssertionResult {
  const value = assertion.value ?? '';
  const passed = output.answer.includes(value);
  return {
    passed,
    message: passed
      ? `Output contains "${value}"`
      : `Expected output to contain "${value}", but it did not. Output: "${output.answer}"`,
  };
}

function evaluateOutputNotContains(assertion: HardAssertion, output: AgentRunOutput): AssertionResult {
  const value = assertion.value ?? '';
  const passed = !output.answer.includes(value);
  return {
    passed,
    message: passed
      ? `Output does not contain "${value}"`
      : `Expected output to NOT contain "${value}", but it did. Output: "${output.answer}"`,
  };
}

function evaluateOutputMatches(assertion: HardAssertion, output: AgentRunOutput): AssertionResult {
  const pattern = assertion.pattern ?? '';
  let regex: RegExp;
  try {
    regex = new RegExp(pattern);
  } catch {
    return {
      passed: false,
      message: `Invalid regex pattern: "${pattern}"`,
    };
  }
  const passed = regex.test(output.answer);
  return {
    passed,
    message: passed
      ? `Output matches pattern /${pattern}/`
      : `Expected output to match pattern /${pattern}/, but it did not. Output: "${output.answer}"`,
  };
}

function evaluateToolCalled(assertion: HardAssertion, output: AgentRunOutput): AssertionResult {
  const tool = assertion.tool ?? '';
  const passed = output.toolCalls.some((tc) => tc.name === tool);
  return {
    passed,
    message: passed
      ? `Tool "${tool}" was called`
      : `Expected tool "${tool}" to be called, but it was not. Called tools: [${output.toolCalls.map((tc) => tc.name).join(', ')}]`,
  };
}

function evaluateToolNotCalled(assertion: HardAssertion, output: AgentRunOutput): AssertionResult {
  const tool = assertion.tool ?? '';
  const passed = !output.toolCalls.some((tc) => tc.name === tool);
  return {
    passed,
    message: passed
      ? `Tool "${tool}" was not called`
      : `Expected tool "${tool}" to NOT be called, but it was.`,
  };
}

function evaluateToolCalledWith(assertion: HardAssertion, output: AgentRunOutput): AssertionResult {
  const tool = assertion.tool ?? '';
  const withArgs = assertion.withArgs ?? {};

  const matching = output.toolCalls.filter((tc) => tc.name === tool);
  if (matching.length === 0) {
    return {
      passed: false,
      message: `Expected tool "${tool}" to be called with ${JSON.stringify(withArgs)}, but it was not called at all.`,
    };
  }

  const passed = matching.some((tc) => argsMatch(tc.args, withArgs));
  return {
    passed,
    message: passed
      ? `Tool "${tool}" was called with matching arguments`
      : `Expected tool "${tool}" to be called with ${JSON.stringify(withArgs)}, but no matching call found.`,
  };
}

function argsMatch(actual: Record<string, unknown>, expected: Record<string, unknown>): boolean {
  for (const [key, value] of Object.entries(expected)) {
    if (actual[key] !== value) {
      return false;
    }
  }
  return true;
}

function evaluateFileExists(assertion: HardAssertion, workspacePath: string): AssertionResult {
  const filePath = assertion.path ?? '';
  const absPath = resolve(workspacePath, filePath);
  const exists = existsSync(absPath);

  if (!exists) {
    return {
      passed: false,
      message: `Expected file "${filePath}" to exist, but it does not.`,
    };
  }

  if (assertion.contentContains !== undefined) {
    try {
      const content = readFileSync(absPath, 'utf-8');
      const passed = content.includes(assertion.contentContains);
      return {
        passed,
        message: passed
          ? `File "${filePath}" exists and contains "${assertion.contentContains}"`
          : `File "${filePath}" exists but does not contain "${assertion.contentContains}"`,
      };
    } catch (error) {
      return {
        passed: false,
        message: `File "${filePath}" exists but could not be read: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  return {
    passed: true,
    message: `File "${filePath}" exists`,
  };
}

function evaluateFileNotExists(assertion: HardAssertion, workspacePath: string): AssertionResult {
  const filePath = assertion.path ?? '';
  const absPath = resolve(workspacePath, filePath);
  const exists = existsSync(absPath);
  return {
    passed: !exists,
    message: exists
      ? `Expected file "${filePath}" to NOT exist, but it does.`
      : `File "${filePath}" does not exist`,
  };
}

function evaluateExitCode(assertion: HardAssertion, output: AgentRunOutput): AssertionResult {
  const expectedValue = Number(assertion.value ?? 0);

  // Map result type to exit code: success=0, max_steps=1, error=1
  let actualValue: number;
  switch (output.resultType) {
    case 'success':
      actualValue = 0;
      break;
    case 'max_steps':
    case 'error':
      actualValue = 1;
      break;
    default:
      actualValue = 1;
  }

  const passed = actualValue === expectedValue;
  return {
    passed,
    message: passed
      ? `Exit code is ${expectedValue}`
      : `Expected exit code ${expectedValue}, but got ${actualValue} (result type: ${output.resultType})`,
  };
}
