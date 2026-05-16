import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadTestFile, TestLoaderError } from '../../../src/test-runner/loader.js';

describe('loadTestFile additional validation', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'wrangler-loader-more-'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('should throw when context is not an object', async () => {
    const yaml = `
name: Bad context
input:
  message: Hello
context: "not-an-object"
`;
    const filePath = join(tempDir, 'bad.yaml');
    writeFileSync(filePath, yaml, 'utf-8');
    await expect(loadTestFile(filePath)).rejects.toThrow('context must be an object');
  });

  it('should throw when tools is not an object', async () => {
    const yaml = `
name: Bad tools
input:
  message: Hello
tools: "not-an-object"
`;
    const filePath = join(tempDir, 'bad.yaml');
    writeFileSync(filePath, yaml, 'utf-8');
    await expect(loadTestFile(filePath)).rejects.toThrow('tools must be an object');
  });

  it('should throw when tools.available is not an array', async () => {
    const yaml = `
name: Bad available
input:
  message: Hello
tools:
  available: "not-array"
`;
    const filePath = join(tempDir, 'bad.yaml');
    writeFileSync(filePath, yaml, 'utf-8');
    await expect(loadTestFile(filePath)).rejects.toThrow('tools.available must be an array');
  });

  it('should throw when tools.available has non-string items', async () => {
    const yaml = `
name: Bad available items
input:
  message: Hello
tools:
  available: [123]
`;
    const filePath = join(tempDir, 'bad.yaml');
    writeFileSync(filePath, yaml, 'utf-8');
    await expect(loadTestFile(filePath)).rejects.toThrow('tools.available[0] must be a string');
  });

  it('should throw when tools.mock is not an object', async () => {
    const yaml = `
name: Bad mock
input:
  message: Hello
tools:
  mock: "not-object"
`;
    const filePath = join(tempDir, 'bad.yaml');
    writeFileSync(filePath, yaml, 'utf-8');
    await expect(loadTestFile(filePath)).rejects.toThrow('tools.mock must be an object');
  });

  it('should throw when tools.mock value is not an object', async () => {
    const yaml = `
name: Bad mock value
input:
  message: Hello
tools:
  mock:
    shell: "not-object"
`;
    const filePath = join(tempDir, 'bad.yaml');
    writeFileSync(filePath, yaml, 'utf-8');
    await expect(loadTestFile(filePath)).rejects.toThrow('tools.mock["shell"] must be an object');
  });

  it('should throw when expected is not an object', async () => {
    const yaml = `
name: Bad expected
input:
  message: Hello
expected: "not-object"
`;
    const filePath = join(tempDir, 'bad.yaml');
    writeFileSync(filePath, yaml, 'utf-8');
    await expect(loadTestFile(filePath)).rejects.toThrow('expected must be an object');
  });

  it('should throw when expected.hard is not an array', async () => {
    const yaml = `
name: Bad hard
input:
  message: Hello
expected:
  hard: "not-array"
`;
    const filePath = join(tempDir, 'bad.yaml');
    writeFileSync(filePath, yaml, 'utf-8');
    await expect(loadTestFile(filePath)).rejects.toThrow('expected.hard must be an array');
  });

  it('should throw when assertion is not an object', async () => {
    const yaml = `
name: Bad assertion
input:
  message: Hello
expected:
  hard:
    - "not-object"
`;
    const filePath = join(tempDir, 'bad.yaml');
    writeFileSync(filePath, yaml, 'utf-8');
    await expect(loadTestFile(filePath)).rejects.toThrow('expected.hard[0] must be an object');
  });

  it('should throw when tool_called missing tool', async () => {
    const yaml = `
name: Missing tool
input:
  message: Hello
expected:
  hard:
    - type: tool_called
`;
    const filePath = join(tempDir, 'bad.yaml');
    writeFileSync(filePath, yaml, 'utf-8');
    await expect(loadTestFile(filePath)).rejects.toThrow('tool must be a string');
  });

  it('should throw when tool_called_with missing with_args', async () => {
    const yaml = `
name: Missing with_args
input:
  message: Hello
expected:
  hard:
    - type: tool_called_with
      tool: shell
`;
    const filePath = join(tempDir, 'bad.yaml');
    writeFileSync(filePath, yaml, 'utf-8');
    await expect(loadTestFile(filePath)).rejects.toThrow('with_args must be an object');
  });

  it('should throw when file_exists missing path', async () => {
    const yaml = `
name: Missing path
input:
  message: Hello
expected:
  hard:
    - type: file_exists
`;
    const filePath = join(tempDir, 'bad.yaml');
    writeFileSync(filePath, yaml, 'utf-8');
    await expect(loadTestFile(filePath)).rejects.toThrow('path must be a string');
  });

  it('should throw when exit_code missing value', async () => {
    const yaml = `
name: Missing value
input:
  message: Hello
expected:
  hard:
    - type: exit_code
`;
    const filePath = join(tempDir, 'bad.yaml');
    writeFileSync(filePath, yaml, 'utf-8');
    await expect(loadTestFile(filePath)).rejects.toThrow('value must be a number');
  });

  it('should throw when exit_code value is not a number', async () => {
    const yaml = `
name: Bad value
input:
  message: Hello
expected:
  hard:
    - type: exit_code
      value: "zero"
`;
    const filePath = join(tempDir, 'bad.yaml');
    writeFileSync(filePath, yaml, 'utf-8');
    await expect(loadTestFile(filePath)).rejects.toThrow('value must be a number');
  });

  it('should throw when input is not an object', async () => {
    const yaml = `
name: Bad input
input: "not-object"
`;
    const filePath = join(tempDir, 'bad.yaml');
    writeFileSync(filePath, yaml, 'utf-8');
    await expect(loadTestFile(filePath)).rejects.toThrow('missing "input" field');
  });

  it('should throw when input.message is not a string', async () => {
    const yaml = `
name: Bad message
input:
  message: 123
`;
    const filePath = join(tempDir, 'bad.yaml');
    writeFileSync(filePath, yaml, 'utf-8');
    await expect(loadTestFile(filePath)).rejects.toThrow('input.message must be a string');
  });

  it('should throw when input.history is not an array', async () => {
    const yaml = `
name: Bad history
input:
  history: "not-array"
`;
    const filePath = join(tempDir, 'bad.yaml');
    writeFileSync(filePath, yaml, 'utf-8');
    await expect(loadTestFile(filePath)).rejects.toThrow('input.history must be an array');
  });

  it('should throw when input.history item content is not a string', async () => {
    const yaml = `
name: Bad history content
input:
  history:
    - role: user
      content: 123
`;
    const filePath = join(tempDir, 'bad.yaml');
    writeFileSync(filePath, yaml, 'utf-8');
    await expect(loadTestFile(filePath)).rejects.toThrow('content must be a string');
  });

  it('should throw when test case is not an object', async () => {
    const yaml = `
- "not-an-object"
`;
    const filePath = join(tempDir, 'bad.yaml');
    writeFileSync(filePath, yaml, 'utf-8');
    await expect(loadTestFile(filePath)).rejects.toThrow('Test case must be an object');
  });

  it('should throw when file cannot be read', async () => {
    const filePath = join(tempDir, 'nonexistent.yaml');
    await expect(loadTestFile(filePath)).rejects.toThrow(TestLoaderError);
    await expect(loadTestFile(filePath)).rejects.toThrow('Failed to read test file');
  });
});
