/**
 * @fileoverview Shared validation helpers for integration tests.
 *
 * Three-layer validation pattern:
 * 1. Structural legality — schema shape (types, required fields)
 * 2. Domain constraints — value ranges, enum membership, non-empty strings
 * 3. Semantic validity — cross-field consistency, heuristic quality checks
 */

import { expect } from 'vitest';
import type { ReviewReport, ReviewIssue } from '../../src/agents/types.js';
import type { AgentOutput } from '../../src/agents/types.js';

const DIMENSION_NAMES = ['clarity', 'completeness', 'focus', 'safety', 'efficiency'] as const;

/**
 * Validate a ReviewReport at three layers.
 *
 * Layer 1: all 5 dimensions exist with score (number) and reasoning (string).
 * Layer 2: scores in [1,5], non-empty reasoning/summary, valid issue severity enum.
 * Layer 3: overallScore correlates with dimension scores (within 2 points of average).
 */
export function validateReviewReport(result: ReviewReport): void {
  // Layer 1: structural legality
  expect(result.overallScore).toBeTypeOf('number');
  expect(result.summary).toBeTypeOf('string');
  expect(Array.isArray(result.issues)).toBe(true);

  for (const name of DIMENSION_NAMES) {
    const dim = result.dimensions[name];
    expect(dim, `dimension "${name}" should exist`).toBeDefined();
    expect(dim.score).toBeTypeOf('number');
    expect(dim.reasoning).toBeTypeOf('string');
  }

  // Layer 2: domain constraints
  expect(result.overallScore).toBeGreaterThanOrEqual(1);
  expect(result.overallScore).toBeLessThanOrEqual(5);
  expect(result.summary.length).toBeGreaterThan(0);

  for (const name of DIMENSION_NAMES) {
    const dim = result.dimensions[name];
    expect(dim.score).toBeGreaterThanOrEqual(1);
    expect(dim.score).toBeLessThanOrEqual(5);
    expect(dim.reasoning.length).toBeGreaterThan(0);
  }

  validateIssues(result.issues);

  // Layer 3: semantic validity — overallScore should correlate with dimension scores
  const dimScores = DIMENSION_NAMES.map((n) => result.dimensions[n].score);
  const avgDimScore = dimScores.reduce((a, b) => a + b, 0) / dimScores.length;
  expect(Math.abs(result.overallScore - avgDimScore)).toBeLessThanOrEqual(2);
}

/**
 * Validate ReviewIssue entries: severity must be a valid enum value,
 * description and suggestion must be non-empty.
 */
export function validateIssues(issues: ReviewIssue[]): void {
  for (const issue of issues) {
    expect(['minor', 'major', 'critical']).toContain(issue.severity);
    expect(issue.description.length).toBeGreaterThan(0);
    expect(issue.suggestion.length).toBeGreaterThan(0);
  }
}

/**
 * Validate an AgentOutput at three layers.
 *
 * Layer 1: changes is array, summary is string.
 * Layer 2: non-empty summary, valid change types, new/old content present where required.
 * Layer 3: summary is non-trivial (>10 chars), optionally verify first change type.
 */
export function validateAgentOutput(result: AgentOutput, expectedType?: 'create' | 'edit'): void {
  // Layer 1: structural legality
  expect(Array.isArray(result.changes)).toBe(true);
  expect(result.summary).toBeTypeOf('string');

  // Layer 2: domain constraints
  expect(result.summary.length).toBeGreaterThan(0);
  for (const change of result.changes) {
    expect(['create', 'edit', 'delete']).toContain(change.type);
    if (change.type === 'create') {
      expect(change.new).toBeDefined();
      expect(change.new!.length).toBeGreaterThan(0);
    }
    if (change.type === 'edit') {
      expect(change.old).toBeDefined();
      expect(change.old!.length).toBeGreaterThan(0);
      expect(change.new).toBeDefined();
      expect(change.new!.length).toBeGreaterThan(0);
    }
  }

  // Layer 3: semantic validity
  expect(result.summary.length).toBeGreaterThan(10);
  if (expectedType && result.changes.length > 0) {
    expect(result.changes[0].type).toBe(expectedType);
  }
}

/**
 * Validate generated AGENT.md content at three layers.
 *
 * Layer 1: has YAML frontmatter with --- delimiters.
 * Layer 2: frontmatter contains name and description with non-empty values.
 * Layer 3: body content is non-trivial (>20 chars).
 */
export function validateAgentMarkdown(content: string): void {
  // Layer 1: structural — must have YAML frontmatter
  expect(content).toMatch(/^---\s*\n/);
  const frontmatterEnd = content.indexOf('---', 3);
  expect(frontmatterEnd, 'frontmatter closing --- not found').toBeGreaterThan(3);

  const frontmatter = content.slice(3, frontmatterEnd);

  // Layer 2: domain — name and description fields exist with values
  expect(frontmatter).toContain('name:');
  expect(frontmatter).toContain('description:');

  const nameMatch = frontmatter.match(/^name:\s*(.+)$/m);
  expect(nameMatch, 'name field should have a value').not.toBeNull();
  expect(nameMatch![1].trim().length).toBeGreaterThan(0);

  // Layer 3: semantic — body should have substance
  const body = content.slice(frontmatterEnd + 3).trim();
  expect(body.length).toBeGreaterThan(20);
}

/**
 * Validate generated skill markdown content at three layers.
 *
 * Similar to validateAgentMarkdown but only requires name in frontmatter.
 */
export function validateSkillMarkdown(content: string): void {
  // Layer 1: structural
  expect(content).toMatch(/^---\s*\n/);
  const frontmatterEnd = content.indexOf('---', 3);
  expect(frontmatterEnd, 'frontmatter closing --- not found').toBeGreaterThan(3);

  const frontmatter = content.slice(3, frontmatterEnd);

  // Layer 2: domain
  expect(frontmatter).toContain('name:');
  const nameMatch = frontmatter.match(/^name:\s*(.+)$/m);
  expect(nameMatch, 'name field should have a value').not.toBeNull();
  expect(nameMatch![1].trim().length).toBeGreaterThan(0);

  // Layer 3: semantic
  const body = content.slice(frontmatterEnd + 3).trim();
  expect(body.length).toBeGreaterThan(20);
}
