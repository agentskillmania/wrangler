// packages/wrangler-devtool/src/test-runner/loader.ts
// Parse test/*.yaml files into structured TestCase objects

import { readFile, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import yaml from 'js-yaml';

import type {
  TestCase,
  TestInput,
  TestContext,
  TestTools,
  HardAssertion,
  AssertionType,
  SoftEvaluation,
} from './types.js';
export type { TestCase };

const VALID_ASSERTION_TYPES: AssertionType[] = [
  'output_contains',
  'output_not_contains',
  'output_matches',
  'tool_called',
  'tool_not_called',
  'tool_called_with',
  'file_exists',
  'file_not_exists',
  'exit_code',
];

export class TestLoaderError extends Error {
  constructor(
    message: string,
    public readonly file: string,
    public readonly caseName?: string
  ) {
    super(message);
  }
}

function validateInput(input: unknown, file: string, caseName: string): TestInput {
  if (input === null || typeof input !== 'object') {
    throw new TestLoaderError(`Test case "${caseName}" missing "input" field`, file, caseName);
  }

  const obj = input as Record<string, unknown>;

  if (obj.message !== undefined && typeof obj.message !== 'string') {
    throw new TestLoaderError(
      `Test case "${caseName}" input.message must be a string`,
      file,
      caseName
    );
  }

  if (obj.history !== undefined) {
    if (!Array.isArray(obj.history)) {
      throw new TestLoaderError(
        `Test case "${caseName}" input.history must be an array`,
        file,
        caseName
      );
    }
    for (let i = 0; i < obj.history.length; i++) {
      const h = obj.history[i] as Record<string, unknown>;
      if (typeof h.role !== 'string' || !['user', 'assistant'].includes(h.role)) {
        throw new TestLoaderError(
          `Test case "${caseName}" input.history[${i}].role must be "user" or "assistant"`,
          file,
          caseName
        );
      }
      if (typeof h.content !== 'string') {
        throw new TestLoaderError(
          `Test case "${caseName}" input.history[${i}].content must be a string`,
          file,
          caseName
        );
      }
    }
  }

  if (obj.message === undefined && obj.history === undefined) {
    throw new TestLoaderError(
      `Test case "${caseName}" input must have "message" or "history"`,
      file,
      caseName
    );
  }

  return obj as TestInput;
}

function validateContext(
  context: unknown,
  file: string,
  caseName: string
): TestContext | undefined {
  if (context === undefined) return undefined;
  if (context === null || typeof context !== 'object') {
    throw new TestLoaderError(`Test case "${caseName}" context must be an object`, file, caseName);
  }

  const obj = context as Record<string, unknown>;
  const result: TestContext = {};

  if (obj.files !== undefined) {
    if (!Array.isArray(obj.files)) {
      throw new TestLoaderError(
        `Test case "${caseName}" context.files must be an array`,
        file,
        caseName
      );
    }
    result.files = (obj.files as unknown[]).map((f: unknown, i: number) => {
      if (
        f === null ||
        typeof f !== 'object' ||
        typeof (f as Record<string, unknown>).source !== 'string' ||
        typeof (f as Record<string, unknown>).target !== 'string'
      ) {
        throw new TestLoaderError(
          `Test case "${caseName}" context.files[${i}] must have "source" and "target" strings`,
          file,
          caseName
        );
      }
      return {
        source: String((f as Record<string, unknown>).source),
        target: String((f as Record<string, unknown>).target),
      };
    });
  }

  if (obj.env !== undefined) {
    if (obj.env === null || typeof obj.env !== 'object') {
      throw new TestLoaderError(
        `Test case "${caseName}" context.env must be an object`,
        file,
        caseName
      );
    }
    result.env = Object.fromEntries(
      Object.entries(obj.env).map(([k, v]) => {
        if (typeof v !== 'string') {
          throw new TestLoaderError(
            `Test case "${caseName}" context.env["${k}"] must be a string`,
            file,
            caseName
          );
        }
        return [k, v];
      })
    );
  }

  return result;
}

function validateTools(tools: unknown, file: string, caseName: string): TestTools | undefined {
  if (tools === undefined) return undefined;
  if (tools === null || typeof tools !== 'object') {
    throw new TestLoaderError(`Test case "${caseName}" tools must be an object`, file, caseName);
  }

  const obj = tools as Record<string, unknown>;
  const result: TestTools = {};

  if (obj.available !== undefined) {
    if (!Array.isArray(obj.available)) {
      throw new TestLoaderError(
        `Test case "${caseName}" tools.available must be an array`,
        file,
        caseName
      );
    }
    result.available = obj.available.map((v: unknown, i: number) => {
      if (typeof v !== 'string') {
        throw new TestLoaderError(
          `Test case "${caseName}" tools.available[${i}] must be a string`,
          file,
          caseName
        );
      }
      return v;
    });
  }

  if (obj.mock !== undefined) {
    if (obj.mock === null || typeof obj.mock !== 'object') {
      throw new TestLoaderError(
        `Test case "${caseName}" tools.mock must be an object`,
        file,
        caseName
      );
    }
    result.mock = Object.fromEntries(
      Object.entries(obj.mock).map(([k, v]) => {
        if (v === null || typeof v !== 'object') {
          throw new TestLoaderError(
            `Test case "${caseName}" tools.mock["${k}"] must be an object`,
            file,
            caseName
          );
        }
        return [k, v as { response?: unknown; error?: string }];
      })
    );
  }

  return result;
}

function validateAssertion(
  assertion: unknown,
  file: string,
  caseName: string,
  index: number
): HardAssertion {
  if (assertion === null || typeof assertion !== 'object') {
    throw new TestLoaderError(
      `Test case "${caseName}" expected.hard[${index}] must be an object`,
      file,
      caseName
    );
  }

  const obj = assertion as Record<string, unknown>;

  if (typeof obj.type !== 'string' || !VALID_ASSERTION_TYPES.includes(obj.type as AssertionType)) {
    throw new TestLoaderError(
      `Test case "${caseName}" expected.hard[${index}].type must be one of: ${VALID_ASSERTION_TYPES.join(', ')}`,
      file,
      caseName
    );
  }

  const type = obj.type as AssertionType;
  const result: HardAssertion = { type };

  if (type === 'output_contains' || type === 'output_not_contains') {
    if (typeof obj.value !== 'string') {
      throw new TestLoaderError(
        `Test case "${caseName}" expected.hard[${index}].value must be a string`,
        file,
        caseName
      );
    }
    result.value = obj.value;
  }

  if (type === 'output_matches') {
    if (typeof obj.pattern !== 'string') {
      throw new TestLoaderError(
        `Test case "${caseName}" expected.hard[${index}].pattern must be a string`,
        file,
        caseName
      );
    }
    result.pattern = obj.pattern;
  }

  if (type === 'tool_called' || type === 'tool_not_called') {
    if (typeof obj.tool !== 'string') {
      throw new TestLoaderError(
        `Test case "${caseName}" expected.hard[${index}].tool must be a string`,
        file,
        caseName
      );
    }
    result.tool = obj.tool;
  }

  if (type === 'tool_called_with') {
    if (typeof obj.tool !== 'string') {
      throw new TestLoaderError(
        `Test case "${caseName}" expected.hard[${index}].tool must be a string`,
        file,
        caseName
      );
    }
    result.tool = obj.tool;
    if (
      obj.with_args === undefined ||
      obj.with_args === null ||
      typeof obj.with_args !== 'object'
    ) {
      throw new TestLoaderError(
        `Test case "${caseName}" expected.hard[${index}].with_args must be an object`,
        file,
        caseName
      );
    }
    result.withArgs = obj.with_args as Record<string, unknown>;
  }

  if (type === 'file_exists') {
    if (typeof obj.path !== 'string') {
      throw new TestLoaderError(
        `Test case "${caseName}" expected.hard[${index}].path must be a string`,
        file,
        caseName
      );
    }
    result.path = obj.path;
    if (obj.content_contains !== undefined) {
      if (typeof obj.content_contains !== 'string') {
        throw new TestLoaderError(
          `Test case "${caseName}" expected.hard[${index}].content_contains must be a string`,
          file,
          caseName
        );
      }
      result.contentContains = obj.content_contains;
    }
  }

  if (type === 'file_not_exists') {
    if (typeof obj.path !== 'string') {
      throw new TestLoaderError(
        `Test case "${caseName}" expected.hard[${index}].path must be a string`,
        file,
        caseName
      );
    }
    result.path = obj.path;
  }

  if (type === 'exit_code') {
    if (typeof obj.value !== 'number') {
      throw new TestLoaderError(
        `Test case "${caseName}" expected.hard[${index}].value must be a number`,
        file,
        caseName
      );
    }
    result.value = String(obj.value);
  }

  return result;
}

function validateSoftEvaluation(
  evaluation: unknown,
  file: string,
  caseName: string,
  index: number
): SoftEvaluation {
  if (evaluation === null || typeof evaluation !== 'object') {
    throw new TestLoaderError(
      `Test case "${caseName}" expected.soft[${index}] must be an object`,
      file,
      caseName
    );
  }

  const obj = evaluation as Record<string, unknown>;

  if (typeof obj.name !== 'string' || obj.name.trim().length === 0) {
    throw new TestLoaderError(
      `Test case "${caseName}" expected.soft[${index}].name must be a non-empty string`,
      file,
      caseName
    );
  }

  if (typeof obj.criteria !== 'string') {
    throw new TestLoaderError(
      `Test case "${caseName}" expected.soft[${index}].criteria must be a string`,
      file,
      caseName
    );
  }

  if (!Array.isArray(obj.rubric)) {
    throw new TestLoaderError(
      `Test case "${caseName}" expected.soft[${index}].rubric must be an array`,
      file,
      caseName
    );
  }

  for (let i = 0; i < obj.rubric.length; i++) {
    const item = obj.rubric[i] as Record<string, unknown>;
    if (typeof item.score !== 'number') {
      throw new TestLoaderError(
        `Test case "${caseName}" expected.soft[${index}].rubric[${i}].score must be a number`,
        file,
        caseName
      );
    }
    if (typeof item.description !== 'string') {
      throw new TestLoaderError(
        `Test case "${caseName}" expected.soft[${index}].rubric[${i}].description must be a string`,
        file,
        caseName
      );
    }
  }

  if (typeof obj.minScore !== 'number') {
    throw new TestLoaderError(
      `Test case "${caseName}" expected.soft[${index}].minScore must be a number`,
      file,
      caseName
    );
  }

  return {
    name: obj.name,
    criteria: obj.criteria,
    rubric: obj.rubric as Array<{ score: number; description: string }>,
    minScore: obj.minScore,
  };
}

function validateExpected(expected: unknown, file: string, caseName: string): TestCase['expected'] {
  if (expected === undefined) {
    return {};
  }
  if (expected === null || typeof expected !== 'object') {
    throw new TestLoaderError(`Test case "${caseName}" expected must be an object`, file, caseName);
  }

  const obj = expected as Record<string, unknown>;
  const result: TestCase['expected'] = {};

  if (obj.hard !== undefined) {
    if (!Array.isArray(obj.hard)) {
      throw new TestLoaderError(
        `Test case "${caseName}" expected.hard must be an array`,
        file,
        caseName
      );
    }
    result.hard = obj.hard.map((a, i) => validateAssertion(a, file, caseName, i));
  }

  if (obj.soft !== undefined) {
    if (!Array.isArray(obj.soft)) {
      throw new TestLoaderError(
        `Test case "${caseName}" expected.soft must be an array`,
        file,
        caseName
      );
    }
    result.soft = obj.soft.map((s, i) => validateSoftEvaluation(s, file, caseName, i));
  }

  return result;
}

function validateTestCase(data: unknown, file: string): TestCase {
  if (data === null || typeof data !== 'object') {
    throw new TestLoaderError(`Test case must be an object`, file);
  }

  const obj = data as Record<string, unknown>;

  if (typeof obj.name !== 'string' || obj.name.trim().length === 0) {
    throw new TestLoaderError(`Test case missing required field: "name"`, file);
  }

  const caseName = obj.name;

  if (obj.input === undefined) {
    throw new TestLoaderError(
      `Test case "${caseName}" missing required field: "input"`,
      file,
      caseName
    );
  }

  const input = validateInput(obj.input, file, caseName);
  const context = validateContext(obj.context, file, caseName);
  const tools = validateTools(obj.tools, file, caseName);
  const expected = validateExpected(obj.expected, file, caseName);

  return {
    name: caseName,
    description: typeof obj.description === 'string' ? obj.description : undefined,
    input,
    context,
    tools,
    expected,
    sourceFile: file,
  };
}

export async function loadTestFile(filePath: string): Promise<TestCase[]> {
  let content: string;
  try {
    content = await readFile(filePath, 'utf-8');
  } catch (error) {
    throw new TestLoaderError(
      `Failed to read test file: ${error instanceof Error ? error.message : String(error)}`,
      filePath
    );
  }

  let parsed: unknown;
  try {
    parsed = yaml.load(content, { schema: yaml.DEFAULT_SCHEMA });
  } catch (error) {
    throw new TestLoaderError(
      `Failed to parse YAML: ${error instanceof Error ? error.message : String(error)}`,
      filePath
    );
  }

  if (parsed === null || parsed === undefined) {
    throw new TestLoaderError(`YAML file is empty`, filePath);
  }

  const docs = Array.isArray(parsed) ? (parsed as unknown[]) : [parsed];
  return docs.map((doc) => validateTestCase(doc, filePath));
}

export async function discoverTestFiles(targetPath: string): Promise<string[]> {
  const absPath = resolve(targetPath);
  const testDir = join(absPath, 'test');

  let entries: string[];
  try {
    entries = await readdir(testDir);
  } catch {
    return [];
  }

  return entries
    .filter((e) => e.endsWith('.yaml') || e.endsWith('.yml'))
    .map((e) => join(testDir, e))
    .sort();
}

export async function loadTestCases(targetPath: string): Promise<TestCase[]> {
  const files = await discoverTestFiles(targetPath);
  const allCases: TestCase[] = [];

  for (const file of files) {
    const cases = await loadTestFile(file);
    allCases.push(...cases);
  }

  return allCases;
}
