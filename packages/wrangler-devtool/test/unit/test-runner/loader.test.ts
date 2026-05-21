import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { join, basename } from 'node:path';
import { tmpdir } from 'node:os';
import {
  loadTestFile,
  discoverTestFiles,
  loadTestCases,
  TestLoaderError,
} from '../../../src/test-runner/loader.js';

describe('loadTestFile', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'wrangler-loader-test-'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('should parse a valid single-message test case', async () => {
    const yaml = `
name: Basic math
description: Simple arithmetic
input:
  message: Calculate 2 + 2
expected:
  hard:
    - type: output_contains
      value: "4"
`;
    const filePath = join(tempDir, 'math.yaml');
    writeFileSync(filePath, yaml, 'utf-8');

    const cases = await loadTestFile(filePath);
    expect(cases).toHaveLength(1);
    expect(cases[0].name).toBe('Basic math');
    expect(cases[0].description).toBe('Simple arithmetic');
    expect(cases[0].input.message).toBe('Calculate 2 + 2');
    expect(cases[0].expected.hard).toHaveLength(1);
    expect(cases[0].expected.hard![0].type).toBe('output_contains');
    expect(cases[0].expected.hard![0].value).toBe('4');
    expect(cases[0].sourceFile).toBe(filePath);
  });

  it('should parse a multi-turn test case', async () => {
    const yaml = `
name: Multi-turn conversation
input:
  history:
    - role: user
      content: Hello
    - role: assistant
      content: Hi there
    - role: user
      content: What's up?
expected:
  hard:
    - type: output_contains
      value: "up"
`;
    const filePath = join(tempDir, 'multi.yaml');
    writeFileSync(filePath, yaml, 'utf-8');

    const cases = await loadTestFile(filePath);
    expect(cases).toHaveLength(1);
    expect(cases[0].input.history).toHaveLength(3);
    expect(cases[0].input.history![0].role).toBe('user');
    expect(cases[0].input.history![1].role).toBe('assistant');
  });

  it('should parse test case with context and tools', async () => {
    const yaml = `
name: With context
input:
  message: Process data
context:
  files:
    - source: fixtures/data.json
      target: data.json
  env:
    MODE: strict
tools:
  available: [shell, file-read]
  mock:
    web-fetch:
      response: { status: 200 }
expected:
  hard:
    - type: file_exists
      path: data.json
`;
    const filePath = join(tempDir, 'context.yaml');
    writeFileSync(filePath, yaml, 'utf-8');

    const cases = await loadTestFile(filePath);
    expect(cases[0].context?.files).toHaveLength(1);
    expect(cases[0].context?.files![0].source).toBe('fixtures/data.json');
    expect(cases[0].context?.files![0].target).toBe('data.json');
    expect(cases[0].context?.env).toEqual({ MODE: 'strict' });
    expect(cases[0].tools?.available).toEqual(['shell', 'file-read']);
    expect(cases[0].tools?.mock?.['web-fetch']).toEqual({ response: { status: 200 } });
  });

  it('should parse multiple test cases from a YAML array', async () => {
    const yaml = `
- name: Case 1
  input:
    message: Hello
  expected:
    hard:
      - type: output_contains
        value: hello

- name: Case 2
  input:
    message: World
  expected:
    hard:
      - type: output_contains
        value: world
`;
    const filePath = join(tempDir, 'array.yaml');
    writeFileSync(filePath, yaml, 'utf-8');

    const cases = await loadTestFile(filePath);
    expect(cases).toHaveLength(2);
    expect(cases[0].name).toBe('Case 1');
    expect(cases[1].name).toBe('Case 2');
  });

  it('should throw TestLoaderError for invalid YAML', async () => {
    const filePath = join(tempDir, 'bad.yaml');
    writeFileSync(filePath, 'not: valid: {{yaml', 'utf-8');

    await expect(loadTestFile(filePath)).rejects.toThrow(TestLoaderError);
  });

  it('should throw TestLoaderError for missing name', async () => {
    const yaml = `
input:
  message: Hello
`;
    const filePath = join(tempDir, 'noname.yaml');
    writeFileSync(filePath, yaml, 'utf-8');

    await expect(loadTestFile(filePath)).rejects.toThrow(TestLoaderError);
    await expect(loadTestFile(filePath)).rejects.toThrow('missing required field: "name"');
  });

  it('should throw TestLoaderError for missing input', async () => {
    const yaml = `
name: No input
`;
    const filePath = join(tempDir, 'noinput.yaml');
    writeFileSync(filePath, yaml, 'utf-8');

    await expect(loadTestFile(filePath)).rejects.toThrow(TestLoaderError);
    await expect(loadTestFile(filePath)).rejects.toThrow('missing required field: "input"');
  });

  it('should throw TestLoaderError for invalid input.history role', async () => {
    const yaml = `
name: Bad history
input:
  history:
    - role: system
      content: Hello
`;
    const filePath = join(tempDir, 'badhistory.yaml');
    writeFileSync(filePath, yaml, 'utf-8');

    await expect(loadTestFile(filePath)).rejects.toThrow(TestLoaderError);
    await expect(loadTestFile(filePath)).rejects.toThrow('role must be "user" or "assistant"');
  });

  it('should throw TestLoaderError for invalid assertion type', async () => {
    const yaml = `
name: Bad assertion
input:
  message: Hello
expected:
  hard:
    - type: unknown_assertion
      value: test
`;
    const filePath = join(tempDir, 'badassert.yaml');
    writeFileSync(filePath, yaml, 'utf-8');

    await expect(loadTestFile(filePath)).rejects.toThrow(TestLoaderError);
    await expect(loadTestFile(filePath)).rejects.toThrow('type must be one of');
  });

  it('should throw TestLoaderError for missing assertion fields', async () => {
    const yaml = `
name: Missing fields
input:
  message: Hello
expected:
  hard:
    - type: output_contains
`;
    const filePath = join(tempDir, 'missingfields.yaml');
    writeFileSync(filePath, yaml, 'utf-8');

    await expect(loadTestFile(filePath)).rejects.toThrow(TestLoaderError);
    await expect(loadTestFile(filePath)).rejects.toThrow('value must be a string');
  });

  it('should throw TestLoaderError for empty YAML', async () => {
    const filePath = join(tempDir, 'empty.yaml');
    writeFileSync(filePath, '', 'utf-8');

    await expect(loadTestFile(filePath)).rejects.toThrow(TestLoaderError);
    await expect(loadTestFile(filePath)).rejects.toThrow('empty');
  });

  it('should validate all assertion types', async () => {
    const yaml = `
name: All assertions
input:
  message: Test
expected:
  hard:
    - type: output_contains
      value: "a"
    - type: output_not_contains
      value: "b"
    - type: output_matches
      pattern: "^hello"
    - type: tool_called
      tool: shell
    - type: tool_not_called
      tool: delete
    - type: tool_called_with
      tool: shell
      with_args: { command: "ls" }
    - type: file_exists
      path: result.txt
      content_contains: "done"
    - type: file_not_exists
      path: secret.txt
    - type: exit_code
      value: 0
`;
    const filePath = join(tempDir, 'all.yaml');
    writeFileSync(filePath, yaml, 'utf-8');

    const cases = await loadTestFile(filePath);
    const hard = cases[0].expected.hard!;
    expect(hard).toHaveLength(9);
    expect(hard[0].type).toBe('output_contains');
    expect(hard[1].type).toBe('output_not_contains');
    expect(hard[2].type).toBe('output_matches');
    expect(hard[3].type).toBe('tool_called');
    expect(hard[4].type).toBe('tool_not_called');
    expect(hard[5].type).toBe('tool_called_with');
    expect(hard[6].type).toBe('file_exists');
    expect(hard[7].type).toBe('file_not_exists');
    expect(hard[8].type).toBe('exit_code');
    expect(hard[6].contentContains).toBe('done');
    expect(hard[8].value).toBe('0');
  });

  it('should throw TestLoaderError for invalid context.files entry', async () => {
    const yaml = `
name: Bad files
input:
  message: Hello
context:
  files:
    - source: foo
`;
    const filePath = join(tempDir, 'badfiles.yaml');
    writeFileSync(filePath, yaml, 'utf-8');

    await expect(loadTestFile(filePath)).rejects.toThrow(TestLoaderError);
    await expect(loadTestFile(filePath)).rejects.toThrow('must have "source" and "target" strings');
  });

  it('should throw TestLoaderError for non-string env values', async () => {
    const yaml = `
name: Bad env
input:
  message: Hello
context:
  env:
    COUNT: 123
`;
    const filePath = join(tempDir, 'badenv.yaml');
    writeFileSync(filePath, yaml, 'utf-8');

    await expect(loadTestFile(filePath)).rejects.toThrow(TestLoaderError);
    await expect(loadTestFile(filePath)).rejects.toThrow('must be a string');
  });
});

describe('discoverTestFiles', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'wrangler-discover-test-'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('should discover yaml files in test directory', async () => {
    mkdirSync(join(tempDir, 'test'));
    writeFileSync(join(tempDir, 'test', 'a.yaml'), 'name: A\ninput:\n  message: hi', 'utf-8');
    writeFileSync(join(tempDir, 'test', 'b.yml'), 'name: B\ninput:\n  message: hi', 'utf-8');
    writeFileSync(join(tempDir, 'test', 'c.txt'), 'not yaml', 'utf-8');

    const files = await discoverTestFiles(tempDir);
    expect(files).toHaveLength(2);
    expect(files.map((f) => basename(f)).sort()).toEqual(['a.yaml', 'b.yml']);
  });

  it('should return empty array if test directory does not exist', async () => {
    const files = await discoverTestFiles(tempDir);
    expect(files).toEqual([]);
  });
});

describe('loadTestCases', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'wrangler-cases-test-'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('should load all test cases from all files', async () => {
    mkdirSync(join(tempDir, 'test'));
    writeFileSync(join(tempDir, 'test', 'a.yaml'), 'name: A\ninput:\n  message: hi', 'utf-8');
    writeFileSync(
      join(tempDir, 'test', 'b.yaml'),
      '- name: B1\n  input:\n    message: hi\n- name: B2\n  input:\n    message: hi',
      'utf-8'
    );

    const cases = await loadTestCases(tempDir);
    expect(cases).toHaveLength(3);
    expect(cases.map((c) => c.name)).toContain('A');
    expect(cases.map((c) => c.name)).toContain('B1');
    expect(cases.map((c) => c.name)).toContain('B2');
  });
});
