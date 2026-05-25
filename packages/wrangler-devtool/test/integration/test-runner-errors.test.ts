import { describe, it, expect } from 'vitest';
import { mkdtemp, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runTests } from '../../src/test-runner/runner.js';

describe('US3: Test runner error paths', () => {
  it('invalid YAML test case throws descriptive error', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'devtool-intg-'));
    await writeFile(
      join(tempDir, 'AGENT.md'),
      `---
name: echo-agent
description: Echoes back
---
Echo back the user's message exactly.`,
      'utf-8'
    );
    await mkdir(join(tempDir, 'test'), { recursive: true });
    await writeFile(
      join(tempDir, 'test', '001-bad.yaml'),
      `name: good-name\ninput:\n  message: "hi"\nexpected:\n  hard:\n    - type: invalid_assertion_type\n      value: "x"`,
      'utf-8'
    );

    // Loader should throw TestLoaderError for invalid assertion type
    await expect(runTests(tempDir)).rejects.toThrow(/invalid_assertion_type|must be one of/);
  });

  it('test case missing input field throws descriptive error', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'devtool-intg-'));
    await writeFile(
      join(tempDir, 'AGENT.md'),
      `---
name: echo-agent
description: Echoes back
---
Echo back the user's message exactly.`,
      'utf-8'
    );
    await mkdir(join(tempDir, 'test'), { recursive: true });
    await writeFile(
      join(tempDir, 'test', '001-no-input.yaml'),
      `name: missing-input\ndescription: no input field`,
      'utf-8'
    );

    await expect(runTests(tempDir)).rejects.toThrow(/missing.*input/i);
  });

  it('empty test directory returns empty report', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'devtool-intg-'));
    await writeFile(
      join(tempDir, 'AGENT.md'),
      `---
name: echo-agent
description: Echoes back
---
Echo back.`,
      'utf-8'
    );
    await mkdir(join(tempDir, 'test'), { recursive: true });

    const report = await runTests(tempDir);

    expect(report.summary.total).toBe(0);
    expect(report.suites).toHaveLength(0);
    expect(report.summary.passed).toBe(0);
    expect(report.summary.failed).toBe(0);
  });

  it('no test directory returns empty report', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'devtool-intg-'));
    await writeFile(
      join(tempDir, 'AGENT.md'),
      `---
name: echo-agent
description: Echoes back
---
Echo back.`,
      'utf-8'
    );

    const report = await runTests(tempDir);

    expect(report.summary.total).toBe(0);
    expect(report.suites).toHaveLength(0);
  });
});
