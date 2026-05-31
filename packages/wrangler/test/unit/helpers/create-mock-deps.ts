/**
 * @fileoverview Factory for creating mock ToolDeps objects in tests
 *
 * Provides a fully-stubbed ToolDeps with safe defaults.
 * Callers can override specific methods via the `overrides` parameter.
 */
import { join } from 'node:path';
import { vi } from 'vitest';
import type { ToolDeps } from '../../../src/tools/builtin/workspace-deps.js';

/** Default stubs for every ToolDeps method — safe no-op returns */
const defaultStubs = {
  resolvePath: (p: string) => p,
  exec: vi.fn().mockResolvedValue({ stdout: '', stderr: '', exitCode: 0 }),
  readFile: vi.fn().mockResolvedValue(''),
  writeFile: vi.fn().mockResolvedValue(undefined),
  editFile: vi.fn().mockResolvedValue(''),
  glob: vi.fn().mockResolvedValue([]),
  grep: vi.fn().mockResolvedValue(''),
};

/**
 * Create a mock ToolDeps for unit tests.
 *
 * @param overrides - Partial overrides for any ToolDeps field or method.
 *                    Use `{ workspaceRoot: '/custom' }` to set a different root.
 *                    Use `{ exec: vi.fn().mockResolvedValue(...) }` to control exec behavior.
 * @returns A ToolDeps object with safe defaults applied to all methods.
 *
 * @example
 * ```ts
 * // Default mock — all methods return empty/zero results
 * const deps = createMockToolDeps();
 *
 * // Override exec to simulate a command failure
 * const deps = createMockToolDeps({
 *   exec: vi.fn().mockResolvedValue({ stdout: 'error output', stderr: '', exitCode: 1 }),
 * });
 *
 * // Override resolvePath with a real workspace root
 * const deps = createMockToolDeps({
 *   workspaceRoot: '/workspace',
 *   resolvePath: (p) => join('/workspace', p),
 * });
 * ```
 */
export function createMockToolDeps(overrides: Partial<ToolDeps> = {}): ToolDeps {
  return {
    workspaceRoot: '/test-workspace',
    maxOutputSize: 1024 * 1024,
    ...defaultStubs,
    ...overrides,
  } as ToolDeps;
}

/**
 * Create a mock ToolDeps that resolves paths relative to the given root.
 * Convenience wrapper that sets up resolvePath to use `join(root, p)`.
 */
export function createMockToolDepsWithRoot(
  root: string,
  overrides: Partial<ToolDeps> = {}
): ToolDeps {
  return createMockToolDeps({
    workspaceRoot: root,
    resolvePath: (p: string) => join(root, p),
    ...overrides,
  });
}
