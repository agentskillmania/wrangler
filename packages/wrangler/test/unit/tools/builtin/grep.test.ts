/**
 * @fileoverview Unit tests for the grep TOOL layer (grep.ts).
 *
 * Source file under test: src/tools/builtin/grep.ts (createGrepTool).
 * Layer: UNIT — deps.grep is mocked, no real ripgrep, no real filesystem.
 *
 * These tests verify the TOOL-LAYER contract of createGrepTool: argument
 * validation, output formatting, and error handling. The actual ripgrep
 * invocation (and SEC1 injection guards) are tested at the execution layer
 * (workspace-deps-exec.test.ts) and end-to-end (integration/grep-tool.test.ts).
 */

import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { join } from 'node:path';
import { createGrepTool } from '../../../../src/tools/builtin/grep.js';
import type { ToolDeps } from '../../../../src/tools/builtin/workspace-deps.js';

/** Build a ToolDeps with a mocked grep that returns canned ripgrep-style output. */
function makeMockDeps(opts: {
  workspaceRoot?: string;
  grepOutput?: string;
  grepThrow?: Error;
  resolvePathThrow?: Error;
} = {}): ToolDeps {
  const workspaceRoot = opts.workspaceRoot ?? '/workspace';
  return {
    workspaceRoot,
    maxOutputSize: 1024,
    resolvePath: (p: string) => {
      if (opts.resolvePathThrow) throw opts.resolvePathThrow;
      return join(workspaceRoot, p);
    },
    exec: async () => ({ stdout: '', stderr: '', exitCode: 0 }),
    readFile: async () => '',
    writeFile: async () => {},
    editFile: async () => '',
    glob: async () => [],
    grep: async () => {
      if (opts.grepThrow) throw opts.grepThrow;
      return opts.grepOutput ?? '';
    },
  } as unknown as ToolDeps;
}

describe('grep tool (unit, mocked deps)', () => {
  it('has correct tool metadata', () => {
    const tool = createGrepTool(makeMockDeps());
    expect(tool.name).toBe('grep');
    expect(tool.parameters).toBeInstanceOf(z.ZodObject);
  });

  it('returns an error message for an invalid regex pattern', async () => {
    const tool = createGrepTool(makeMockDeps());
    const result = await tool.execute({ pattern: '[invalid' });
    expect(result).toContain('Invalid regex');
  });

  it('returns "No matches found" when deps.grep yields no output', async () => {
    const tool = createGrepTool(makeMockDeps({ grepOutput: '' }));
    const result = await tool.execute({ pattern: 'foo' });
    expect(result).toContain('No matches found');
  });

  it('returns "No matches found" when deps.grep returns the sentinel string', async () => {
    const tool = createGrepTool(makeMockDeps({ grepOutput: 'No matches found' }));
    const result = await tool.execute({ pattern: 'foo' });
    expect(result).toContain('No matches found');
  });

  it('parses and groups ripgrep-style output by file', async () => {
    // ripgrep --no-heading --line-number output: "<path>:<line>:<content>"
    const rgOutput = [
      '/workspace/src/a.ts:1:const foo = 1;',
      '/workspace/src/a.ts:5:const bar = foo;',
      '/workspace/src/b.ts:3:const foo = 2;',
    ].join('\n');
    const tool = createGrepTool(makeMockDeps({ grepOutput: rgOutput }));
    const result = await tool.execute({ pattern: 'foo' });
    // Grouped under relative paths (workspace prefix stripped)
    expect(result).toContain('src/a.ts:');
    expect(result).toContain('src/b.ts:');
    expect(result).toContain('Line 1: const foo = 1;');
    expect(result).toContain('Line 5: const bar = foo;');
    expect(result).toContain('Line 3: const foo = 2;');
  });

  it('caps parsed matches at 100', async () => {
    const lines = Array.from({ length: 150 }, (_, i) => `/workspace/a.ts:${i + 1}:match_${i}`).join('\n');
    const tool = createGrepTool(makeMockDeps({ grepOutput: lines }));
    const result = await tool.execute({ pattern: 'match_' });
    const matchCount = (result.match(/Line \d+:/g) || []).length;
    expect(matchCount).toBeLessThanOrEqual(100);
  });

  it('truncates long matching lines with an ellipsis', async () => {
    const longLine = 'x'.repeat(3000);
    const tool = createGrepTool(makeMockDeps({ grepOutput: `/workspace/a.ts:1:${longLine}` }));
    const result = await tool.execute({ pattern: 'x' });
    expect(result).toContain('...');
    expect(result.length).toBeLessThan(3000);
  });

  it('returns "No matches found" when raw output has no parseable lines', async () => {
    const tool = createGrepTool(
      makeMockDeps({ grepOutput: 'header line without colons\nanother bad line' })
    );
    const result = await tool.execute({ pattern: 'test' });
    expect(result).toContain('No matches found');
  });

  it('returns a path error when resolvePath throws a non-traversal error', async () => {
    const tool = createGrepTool(
      makeMockDeps({ resolvePathThrow: new Error('Permission denied') })
    );
    const result = await tool.execute({ pattern: 'test', path: 'src' });
    expect(result).toContain('Error: Invalid path');
  });

  it('re-throws a path traversal error from resolvePath', async () => {
    const tool = createGrepTool(
      makeMockDeps({ resolvePathThrow: new Error('Path traversal detected') })
    );
    await expect(tool.execute({ pattern: 'test', path: '../../etc' })).rejects.toThrow(
      'Path traversal detected'
    );
  });
});
