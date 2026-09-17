import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createShellTool } from '../../../../src/tools/builtin/shell.js';
import { HostToolDeps } from '../../../../src/tools/builtin/workspace-deps.js';
import { NodeHostEnv } from '../../../../src/host-env/node-host-env.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { ToolDeps } from '../../../../src/tools/builtin/workspace-deps.js';
import { createMockToolDeps } from '../../helpers/create-mock-deps.js';

describe('createShellTool', () => {
  let tempDir: string;
  let deps: ToolDeps;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'shell-test-'));
    deps = new HostToolDeps(new NodeHostEnv(), tempDir);
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('should execute echo command via ToolDeps', async () => {
    const tool = createShellTool(deps);
    const result = await tool.execute({ command: 'echo hello from shell' });
    expect(result).toContain('hello from shell');
  });

  it('should report non-zero exit code', async () => {
    const tool = createShellTool(deps);
    const result = await tool.execute({ command: 'ls /nonexistent_dir_xyz_12345' });
    expect(result).toContain('Exit code');
  });

  it('should truncate large output', async () => {
    const tool = createShellTool(deps);
    const result = await tool.execute({ command: 'seq 1 100000' });
    // Default maxOutput=100000; output is sliced to 100000 then a truncation
    // marker is appended, so total length exceeds 100000 but is bounded.
    expect(result).toContain('output truncated');
    expect(result.length).toBeLessThanOrEqual(100_000 + 50);
  });

  describe('maxOutput parameter', () => {
    it('defaults to 100000 when not specified', async () => {
      const tool = createShellTool(deps);
      const result = await tool.execute({ command: 'seq 1 50000' });
      // Default 100000 — 50000 lines of "1\n..50000\n" ≈ 340k chars → truncated
      expect(result).toContain('output truncated');
      // Truncated output stays at or below 100000 + marker length
      expect(result.length).toBeLessThanOrEqual(100_000 + 50);
    });

    it('respects custom maxOutput', async () => {
      const tool = createShellTool(deps, 1000);
      const result = await tool.execute({ command: 'seq 1 100000' });
      expect(result).toContain('output truncated');
      // Output body is exactly 1000 chars + truncation marker
      expect(result.length).toBeLessThanOrEqual(1000 + 50);
      expect(result.length).toBeGreaterThan(1000);
    });

    it('does not truncate when output fits within maxOutput', async () => {
      const tool = createShellTool(deps, 1000);
      const result = await tool.execute({ command: 'echo short' });
      expect(result.trim()).toBe('short');
      expect(result).not.toContain('truncated');
    });

    it('boundary: output exactly at maxOutput is not truncated', async () => {
      // Produce exactly 50 chars of output: "aaaa...a" (50 a's)
      const tool = createShellTool(deps, 50);
      const result = await tool.execute({ command: 'printf "%0.s a" {1..10}' });
      // printf produces " a" x10 = 20 chars — well under 50, no truncation
      expect(result).not.toContain('truncated');
    });
  });

  describe('description', () => {
    it('should include shell info in description when deps has shell', () => {
      const tool = createShellTool(deps);
      expect(tool.description).toContain('Current shell:');
      expect(tool.description).toContain(deps.shell!.name);
      expect(tool.description).toContain(deps.shell!.path);
    });

    it('should not include shell info when deps has no shell property', () => {
      const minimalDeps = createMockToolDeps({
        workspaceRoot: tempDir,
        resolvePath: (p: string) => join(tempDir, p),
      });
      const tool = createShellTool(minimalDeps);
      expect(tool.description).not.toContain('Current shell:');
      expect(tool.description).toBe('Execute shell commands in the workspace.');
    });

    // 工况化描述（R2P-242，对齐 Rust e0517a8）：裸机必须显式否认沙箱——
    // 否则模型会把"workspace"措辞读成隔离环境,在真机上按一次性环境行事。
    it('host 工况: explicitly disclaims sandbox (REAL machine)', () => {
      const tool = createShellTool(deps); // HostToolDeps → env 'host'
      expect(tool.description).toContain('no sandbox');
      expect(tool.description).toContain('REAL machine');
      // 无状态语义:cwd 重置 + env 不留 + 串联指引。
      expect(tool.description).toContain('do not persist');
      expect(tool.description).toContain('&&');
    });

    // 工况化描述（R2P-242，对齐 Rust be7a1b0）：沙箱是 wsh/busybox,方言
    // 边界(单引号规则、无 2>&1、缺失命令)必须写进文案——中性文案会让
    // 模型按 bash 语义写命令然后撞 argv bug。
    it('sandbox 工况: documents wsh dialect + busybox command set', () => {
      const sandboxDeps = createMockToolDeps({ env: 'sandbox' });
      const tool = createShellTool(sandboxDeps);
      expect(tool.description).toContain('wsh');
      expect(tool.description).toContain('NOT available');
      expect(tool.description).toContain('single quotes');
      expect(tool.description).toContain('2>&1');
      expect(tool.description).toContain('mounted at /');
      // 沙箱文案不得声称宿主真机语义,也不得断言网络开关(读不到配置,
      // 错误声称比不声称更糟)。
      expect(tool.description).not.toContain('REAL machine');
      expect(tool.description).not.toContain('network is');
    });

    // 工况判据是显式 env 标记,不是 shell 缺席——mock/浏览器 deps 不设
    // env 时必须拿到中性文案(不是沙箱文案)。
    it('deps without env and without shell keeps the neutral text', () => {
      const tool = createShellTool(createMockToolDeps());
      expect(tool.description).toBe('Execute shell commands in the workspace.');
      expect(tool.description).not.toContain('wsh');
      expect(tool.description).not.toContain('REAL machine');
    });
  });

  it('should propagate exec errors', async () => {
    const throwingDeps = createMockToolDeps({
      workspaceRoot: tempDir,
      resolvePath: (p: string) => join(tempDir, p),
      exec: async () => {
        throw 'string error';
      },
    });
    const tool = createShellTool(throwingDeps);
    await expect(tool.execute({ command: 'anything' })).rejects.toThrow('string error');
  });

  it('should show (no output) when stdout is empty on success', async () => {
    const depsNoOutput = createMockToolDeps({
      workspaceRoot: tempDir,
      resolvePath: (p: string) => join(tempDir, p),
      exec: vi.fn().mockResolvedValue({ stdout: '', stderr: '', exitCode: 0 }),
    });
    const tool = createShellTool(depsNoOutput);
    const result = await tool.execute({ command: 'true' });
    expect(result).toBe('(no output)');
  });

  it('should include stdout in error output', async () => {
    const depsWithStdout = createMockToolDeps({
      workspaceRoot: tempDir,
      resolvePath: (p: string) => join(tempDir, p),
      exec: vi.fn().mockResolvedValue({
        stdout: 'partial output',
        stderr: 'error msg',
        exitCode: 1,
      }),
    });
    const tool = createShellTool(depsWithStdout);
    const result = await tool.execute({ command: 'fail' });
    expect(result).toContain('Exit code: 1');
    expect(result).toContain('partial output');
    expect(result).toContain('error msg');
  });

  describe('schema validation', () => {
    it('rejects arguments missing the command field', () => {
      const tool = createShellTool(deps);
      expect(() => tool.parameters.parse({})).toThrow();
    });

    it('rejects non-string command argument', () => {
      const tool = createShellTool(deps);
      expect(() => tool.parameters.parse({ command: 123 })).toThrow();
    });

    it('accepts valid command argument', () => {
      const tool = createShellTool(deps);
      expect(tool.parameters.parse({ command: 'echo hi' })).toEqual({
        command: 'echo hi',
      });
    });
  });
});
