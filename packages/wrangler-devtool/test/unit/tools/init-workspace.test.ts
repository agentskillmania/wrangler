import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { initProject } from '../../../src/tools/init-workspace.js';
import { CliError } from '../../../src/cli/options.js';

describe('initProject', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'wrangler-devtool-test-'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('should create agent workspace', async () => {
    const dir = join(tempDir, 'agent-workspace');
    await initProject(dir, { type: 'agent' });

    const entries = readdirSync(dir);
    expect(entries).toContain('AGENT.md');
    expect(entries).not.toContain('agents');
    expect(entries).toContain('skills');
    expect(entries).toContain('test');
    expect(entries).toContain('mcp.json');
    expect(entries).toContain('mcp.json.example');

    const agentMd = readFileSync(join(dir, 'AGENT.md'), 'utf-8');
    expect(agentMd).toContain('name:');
    expect(agentMd).toContain('description:');
    expect(agentMd).not.toContain('Attach skills from');
    expect(agentMd).not.toContain('MCP Configuration');

    const mcpJson = readFileSync(join(dir, 'mcp.json'), 'utf-8');
    expect(JSON.parse(mcpJson)).toEqual({ mcpServers: {} });

    expect(existsSync(join(dir, '.git'))).toBe(true);
  });

  it('should create crew workspace', async () => {
    const dir = join(tempDir, 'crew-workspace');
    await initProject(dir, { type: 'crew' });

    const entries = readdirSync(dir);
    expect(entries).toContain('CREW.md');
    expect(entries).toContain('agents');
    expect(entries).toContain('skills');
    expect(entries).toContain('test');
    expect(entries).toContain('mcp.json');
    expect(entries).toContain('mcp.json.example');

    expect(existsSync(join(dir, '.git'))).toBe(true);
  });

  it('should reject non-empty directory', async () => {
    const dir = join(tempDir, 'non-empty');
    const fs = await import('node:fs/promises');
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(join(dir, 'existing.txt'), 'hello', 'utf-8');

    await expect(initProject(dir, { type: 'agent' })).rejects.toThrow(CliError);
  });

  it('should use directory name as default name', async () => {
    const dir = join(tempDir, 'my-agent');
    await initProject(dir, { type: 'agent' });

    const content = readFileSync(join(dir, 'AGENT.md'), 'utf-8');
    expect(content).toContain('name: my-agent');
  });

  it('should create missing directories', async () => {
    const dir = join(tempDir, 'deeply', 'nested', 'workspace');
    await initProject(dir, { type: 'agent' });

    expect(readdirSync(dir)).toContain('skills');
  });

  it('should skip git init with --no-git', async () => {
    const dir = join(tempDir, 'no-git');
    await initProject(dir, { type: 'agent', noGit: true });

    expect(existsSync(join(dir, '.git'))).toBe(false);
  });

  it('should skip git init when already in a git repo', async () => {
    const parentDir = join(tempDir, 'parent-repo');
    const childDir = join(parentDir, 'child-agent');

    const fs = await import('node:fs/promises');
    await fs.mkdir(parentDir, { recursive: true });

    // Initialize parent as git repo
    const { execSync } = await import('node:child_process');
    execSync('git init', { cwd: parentDir });

    await initProject(childDir, { type: 'agent' });

    // child should not have its own .git
    expect(existsSync(join(childDir, '.git'))).toBe(false);
    // but workspace files should still be created
    expect(existsSync(join(childDir, 'AGENT.md'))).toBe(true);
  });

  it('should create example skill and test files', async () => {
    const dir = join(tempDir, 'with-examples');
    await initProject(dir, { type: 'agent' });

    const skillMd = readFileSync(join(dir, 'skills', 'example.md'), 'utf-8');
    expect(skillMd).toContain('name: example');
    expect(skillMd).toContain('description:');

    const testYaml = readFileSync(join(dir, 'test', 'example.yaml'), 'utf-8');
    expect(testYaml).toContain('name: example-test');
    expect(testYaml).toContain('expected:');
  });
});
