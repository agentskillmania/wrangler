import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { loadSuite } from '../../../src/eval/loader.js';

describe('loadSuite', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'eval-loader-'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  function writeYaml(content: string): string {
    const path = join(tempDir, 'suite.yaml');
    writeFileSync(path, content, 'utf-8');
    return path;
  }

  it('parses a minimal valid suite', async () => {
    const path = writeYaml(`
name: basic
description: A basic suite
target:
  type: agent
  path: ./
  skill: null
sampling:
  runs: 1
  passThreshold: 1
cases:
  - name: say-hello
    input:
      message: Say hello
    evaluators:
      - type: output_contains
        value: hello
`);
    const suite = await loadSuite(path);

    expect(suite.name).toBe('basic');
    expect(suite.description).toBe('A basic suite');
    expect(suite.target.type).toBe('agent');
    expect(suite.target.path).toBe('./');
    expect(suite.target.skill).toBeNull();
    expect(suite.sampling.runs).toBe(1);
    expect(suite.sampling.passThreshold).toBe(1);
    expect(suite.cases).toHaveLength(1);
    expect(suite.cases[0].name).toBe('say-hello');
    expect(suite.cases[0].input.message).toBe('Say hello');
    expect(suite.cases[0].evaluators).toHaveLength(1);
    expect(suite.cases[0].evaluators[0]).toEqual({
      type: 'output_contains',
      value: 'hello',
    });
  });

  it('parses skill target with skill name', async () => {
    const path = writeYaml(`
name: skill-eval
target:
  type: skill
  path: ./skills
  skill: my-skill
sampling:
  runs: 3
  passThreshold: 0.67
cases:
  - name: basic-task
    input:
      message: Do the thing
    evaluators:
      - type: tool_called
        tool: file_write
`);
    const suite = await loadSuite(path);

    expect(suite.target.type).toBe('skill');
    expect(suite.target.skill).toBe('my-skill');
    expect(suite.sampling.runs).toBe(3);
    expect(suite.sampling.passThreshold).toBe(0.67);
  });

  it('parses crew target with a crew directory path', async () => {
    const path = writeYaml(`
name: crew-eval
target:
  type: crew
  path: ./my-crew
  skill: null
sampling:
  runs: 1
  passThreshold: 1
cases:
  - name: delegates
    input:
      message: Hello
    evaluators:
      - type: tool_called
        tool: delegate
`);
    const suite = await loadSuite(path);

    expect(suite.target.type).toBe('crew');
    expect(suite.target.path).toBe('./my-crew');
    expect(suite.target.skill).toBeNull();
  });

  it('parses context with files and env', async () => {
    const path = writeYaml(`
name: ctx
target:
  type: agent
  path: ./
  skill: null
sampling:
  runs: 1
  passThreshold: 1
cases:
  - name: with-context
    input:
      message: Review the code
    context:
      files:
        - source: fixtures/vuln.py
          target: src/main.py
      env:
        MODE: strict
    evaluators:
      - type: file_exists
        path: review.md
`);
    const suite = await loadSuite(path);

    expect(suite.cases[0].context?.files).toEqual([
      { source: 'fixtures/vuln.py', target: 'src/main.py' },
    ]);
    expect(suite.cases[0].context?.env).toEqual({ MODE: 'strict' });
  });

  it('parses multi-turn history', async () => {
    const path = writeYaml(`
name: multi-turn
target:
  type: agent
  path: ./
  skill: null
sampling:
  runs: 1
  passThreshold: 1
cases:
  - name: conversation
    input:
      message: Follow up
      history:
        - role: user
          content: Start
        - role: assistant
          content: OK
    evaluators:
      - type: output_contains
        value: done
`);
    const suite = await loadSuite(path);

    expect(suite.cases[0].input.history).toEqual([
      { role: 'user', content: 'Start' },
      { role: 'assistant', content: 'OK' },
    ]);
  });

  it('parses all deterministic evaluator types', async () => {
    const path = writeYaml(`
name: all-evals
target: { type: agent, path: ./, skill: null }
sampling: { runs: 1, passThreshold: 1 }
cases:
  - name: comprehensive
    input: { message: test }
    evaluators:
      - type: output_contains
        value: hello
        caseInsensitive: true
      - type: output_not_contains
        value: error
      - type: output_equals
        value: exact
      - type: output_matches
        pattern: "^d+$"
        flags: i
      - type: tool_called
        tool: file_read
      - type: tool_not_called
        tool: shell
      - type: tool_called_with
        tool: file_write
        arguments: { path: out.txt }
      - type: tool_call_count
        min: 1
        max: 5
      - type: file_exists
        path: out.txt
        contentContains: done
      - type: file_not_exists
        path: temp.txt
      - type: exit_code
        equals: success
      - type: step_count
        max: 10
`);
    const suite = await loadSuite(path);
    const evals = suite.cases[0].evaluators;

    expect(evals).toHaveLength(12);
    expect(evals[0]).toEqual({ type: 'output_contains', value: 'hello', caseInsensitive: true });
    expect(evals[3]).toEqual({ type: 'output_matches', pattern: '^d+$', flags: 'i' });
    expect(evals[6]).toEqual({
      type: 'tool_called_with',
      tool: 'file_write',
      arguments: { path: 'out.txt' },
    });
    expect(evals[7]).toEqual({ type: 'tool_call_count', min: 1, max: 5 });
    expect(evals[10]).toEqual({ type: 'exit_code', equals: 'success' });
    expect(evals[11]).toEqual({ type: 'step_count', max: 10 });
  });

  it('parses llm-judge evaluator with rubric and reference', async () => {
    const path = writeYaml(`
name: judge
target: { type: agent, path: ./, skill: null }
sampling: { runs: 1, passThreshold: 1 }
cases:
  - name: quality
    input: { message: Review }
    evaluators:
      - type: llm-judge
        name: thoroughness
        criteria: Coverage of security, performance, maintainability
        rubric:
          - { score: 5, description: Excellent }
          - { score: 1, description: Poor }
        minScore: 3
        reference: Should mention SQL injection
`);
    const suite = await loadSuite(path);
    const ev = suite.cases[0].evaluators[0];

    expect(ev).toEqual({
      type: 'llm-judge',
      name: 'thoroughness',
      criteria: 'Coverage of security, performance, maintainability',
      rubric: [
        { score: 5, description: 'Excellent' },
        { score: 1, description: 'Poor' },
      ],
      minScore: 3,
      reference: 'Should mention SQL injection',
    });
  });

  // ─── Error cases ──────────────────────────────────────

  it('throws on missing name', async () => {
    const path = writeYaml(`
target: { type: agent, path: ./, skill: null }
sampling: { runs: 1, passThreshold: 1 }
cases: []
`);
    await expect(loadSuite(path)).rejects.toThrow();
  });

  it('throws on missing target', async () => {
    const path = writeYaml(`
name: no-target
sampling: { runs: 1, passThreshold: 1 }
cases: []
`);
    await expect(loadSuite(path)).rejects.toThrow();
  });

  it('throws on missing sampling', async () => {
    const path = writeYaml(`
name: no-sampling
target: { type: agent, path: ./, skill: null }
cases: []
`);
    await expect(loadSuite(path)).rejects.toThrow();
  });

  it('throws on empty cases', async () => {
    const path = writeYaml(`
name: empty
target: { type: agent, path: ./, skill: null }
sampling: { runs: 1, passThreshold: 1 }
cases: []
`);
    await expect(loadSuite(path)).rejects.toThrow();
  });

  it('throws on invalid target type', async () => {
    const path = writeYaml(`
name: bad-type
target: { type: invalid, path: ./, skill: null }
sampling: { runs: 1, passThreshold: 1 }
cases:
  - name: x
    input: { message: test }
    evaluators: []
`);
    await expect(loadSuite(path)).rejects.toThrow();
  });

  it('throws on invalid passThreshold (> 1)', async () => {
    const path = writeYaml(`
name: bad-threshold
target: { type: agent, path: ./, skill: null }
sampling: { runs: 1, passThreshold: 1.5 }
cases:
  - name: x
    input: { message: test }
    evaluators: [{ type: output_contains, value: x }]
`);
    await expect(loadSuite(path)).rejects.toThrow();
  });

  it('throws on case with no evaluators', async () => {
    const path = writeYaml(`
name: no-evaluators
target: { type: agent, path: ./, skill: null }
sampling: { runs: 1, passThreshold: 1 }
cases:
  - name: x
    input: { message: test }
    evaluators: []
`);
    await expect(loadSuite(path)).rejects.toThrow();
  });

  it('throws on unknown evaluator type', async () => {
    const path = writeYaml(`
name: unknown-eval
target: { type: agent, path: ./, skill: null }
sampling: { runs: 1, passThreshold: 1 }
cases:
  - name: x
    input: { message: test }
    evaluators:
      - type: non_existent
        value: x
`);
    await expect(loadSuite(path)).rejects.toThrow();
  });

  it('throws on llm-judge without rubric', async () => {
    const path = writeYaml(`
name: bad-judge
target: { type: agent, path: ./, skill: null }
sampling: { runs: 1, passThreshold: 1 }
cases:
  - name: x
    input: { message: test }
    evaluators:
      - type: llm-judge
        name: quality
        criteria: good?
        minScore: 3
`);
    await expect(loadSuite(path)).rejects.toThrow();
  });

  it('throws on non-existent file', async () => {
    await expect(loadSuite(join(tempDir, 'nope.yaml'))).rejects.toThrow();
  });
});
