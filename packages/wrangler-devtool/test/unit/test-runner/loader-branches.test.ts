import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadTestFile, TestLoaderError } from '../../../src/test-runner/loader.js';

describe('loadTestFile branch coverage', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'wrangler-loader-branch-'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('should throw when file_exists content_contains is not a string', async () => {
    const yaml = `
name: Bad content_contains
input:
  message: Hello
expected:
  hard:
    - type: file_exists
      path: result.txt
      content_contains: 123
`;
    const filePath = join(tempDir, 'bad.yaml');
    writeFileSync(filePath, yaml, 'utf-8');
    await expect(loadTestFile(filePath)).rejects.toThrow('content_contains must be a string');
  });

  it('should throw when file_not_exists path is missing', async () => {
    const yaml = `
name: Missing path
input:
  message: Hello
expected:
  hard:
    - type: file_not_exists
`;
    const filePath = join(tempDir, 'bad.yaml');
    writeFileSync(filePath, yaml, 'utf-8');
    await expect(loadTestFile(filePath)).rejects.toThrow('path must be a string');
  });
});
