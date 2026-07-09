/**
 * @fileoverview YAML suite loader — parses eval-suite.yaml into a validated EvalSuite.
 *
 * Uses Zod for schema validation. Raw YAML keys use snake_case / kebab-case
 * (e.g. pass_threshold, caseInsensitive) and are normalized to the camelCase
 * fields defined in types.ts.
 */

import { readFile } from 'node:fs/promises';
import { z } from 'zod';

import type {
  EvalSuite,
  EvalCase,
  EvalTarget,
  EvalSampling,
  EvaluatorSpec,
} from './types.js';

// ─── Zod schemas ────────────────────────────────────────────

const targetSchema = z.object({
  type: z.literal('agent').or(z.literal('skill')),
  path: z.string().min(1),
  skill: z.string().nullable(),
});

const samplingSchema = z.object({
  runs: z.number().int().min(1),
  passThreshold: z.number().min(0).max(1),
  temperature: z.number().min(0).max(2).optional(),
  model: z.string().optional(),
  maxSteps: z.number().int().min(1).optional(),
});

const rubricLevelSchema = z.object({
  score: z.number(),
  description: z.string(),
});

/**
 * Evaluator spec schema — discriminated union by 'type'.
 * Each variant enforces its required fields and allows its optional fields.
 */
const evaluatorSpecSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('output_contains'),
    value: z.string(),
    caseInsensitive: z.boolean().optional(),
  }),
  z.object({
    type: z.literal('output_not_contains'),
    value: z.string(),
    caseInsensitive: z.boolean().optional(),
  }),
  z.object({
    type: z.literal('output_equals'),
    value: z.string(),
    caseInsensitive: z.boolean().optional(),
  }),
  z.object({
    type: z.literal('output_matches'),
    pattern: z.string(),
    flags: z.string().optional(),
  }),
  z.object({
    type: z.literal('tool_called'),
    tool: z.string(),
  }),
  z.object({
    type: z.literal('tool_not_called'),
    tool: z.string(),
  }),
  z.object({
    type: z.literal('tool_called_with'),
    tool: z.string(),
    arguments: z.record(z.unknown()),
  }),
  z.object({
    type: z.literal('tool_call_count'),
    min: z.number().int().optional(),
    max: z.number().int().optional(),
  }),
  z.object({
    type: z.literal('file_exists'),
    path: z.string(),
    contentContains: z.string().optional(),
  }),
  z.object({
    type: z.literal('file_not_exists'),
    path: z.string(),
  }),
  z.object({
    type: z.literal('exit_code'),
    equals: z.enum(['success', 'max_steps', 'error', 'abort', 'stopped', 'waiting-human']),
  }),
  z.object({
    type: z.literal('step_count'),
    min: z.number().int().optional(),
    max: z.number().int().optional(),
  }),
  z.object({
    type: z.literal('llm-judge'),
    name: z.string(),
    criteria: z.string(),
    rubric: z.array(rubricLevelSchema).min(1),
    minScore: z.number(),
    reference: z.string().optional(),
  }),
]);

const historyEntrySchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.string(),
});

const fileFixtureSchema = z.object({
  source: z.string(),
  target: z.string(),
});

const contextSchema = z.object({
  files: z.array(fileFixtureSchema).optional(),
  env: z.record(z.string()).optional(),
});

const caseSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  input: z.object({
    message: z.string(),
    history: z.array(historyEntrySchema).optional(),
  }),
  context: contextSchema.optional(),
  evaluators: z.array(evaluatorSpecSchema).min(1),
});

const suiteSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  target: targetSchema,
  sampling: samplingSchema,
  cases: z.array(caseSchema).min(1),
});

// ─── Loader ─────────────────────────────────────────────────

/**
 * Load and validate an evaluation suite from a YAML file.
 *
 * @param yamlPath - Absolute or relative path to the suite YAML file.
 * @returns Validated EvalSuite.
 * @throws If the file cannot be read, the YAML is malformed, or validation fails.
 */
export async function loadSuite(yamlPath: string): Promise<EvalSuite> {
  const yaml = await import('js-yaml');
  const raw = await readFile(yamlPath, 'utf-8');
  const parsed = yaml.load(raw);

  const result = suiteSchema.safeParse(parsed);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  at ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid eval suite ${yamlPath}:\n${issues}`);
  }

  // Zod output is structurally compatible with EvalSuite, but we cast through
  // unknown to satisfy the discriminated-union EvaluatorSpec type.
  return result.data as unknown as EvalSuite;
}

// Re-export for consumers that want the Zod schema directly (e.g. CLI --check)
export { suiteSchema };
