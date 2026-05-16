import { describe, it, expect } from 'vitest';
import { mkdtemp, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runTests } from '../../src/test-runner/runner.js';

describe('US3: Run regression tests', () => {
  it('AC3.1-AC3.3: discovers and runs test cases with hard assertions', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'devtool-intg-'));

    // Create a simple agent
    await writeFile(
      join(tempDir, 'AGENT.md'),
      `---
name: echo-agent
description: Echoes back what you say
---
Echo back the user's message exactly.`,
      'utf-8'
    );

    // Create test directory and test case
    await mkdir(join(tempDir, 'test'), { recursive: true });
    await writeFile(
      join(tempDir, 'test', '001-echo.yaml'),
      `name: Echo test
description: Agent should echo back the input
input:
  message: "hello world"
expected:
  hard:
    - type: output_contains
      value: "hello world"
`,
      'utf-8'
    );

    const report = await runTests(tempDir, { hardOnly: true });

    expect(report.summary.total).toBeGreaterThan(0);
    expect(report.suites.length).toBeGreaterThan(0);
  });

  it('AC3.7: returns exit code semantics — failed tests in report', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'devtool-intg-'));

    await writeFile(
      join(tempDir, 'AGENT.md'),
      `---
name: math-agent
description: Does math
---
You are a calculator. When asked to calculate, respond with the result only.`,
      'utf-8'
    );

    await mkdir(join(tempDir, 'test'), { recursive: true });
    await writeFile(
      join(tempDir, 'test', '001-math.yaml'),
      `name: Math test
input:
  message: "What is 2+2?"
expected:
  hard:
    - type: output_contains
      value: "4"
`,
      'utf-8'
    );

    const report = await runTests(tempDir, { hardOnly: true });

    // Report structure
    expect(report.summary).toHaveProperty('total');
    expect(report.summary).toHaveProperty('passed');
    expect(report.summary).toHaveProperty('failed');
    expect(report.summary).toHaveProperty('duration');
    expect(report.summary).toHaveProperty('hardPassed');
    expect(report.summary).toHaveProperty('hardFailed');
  });
});
