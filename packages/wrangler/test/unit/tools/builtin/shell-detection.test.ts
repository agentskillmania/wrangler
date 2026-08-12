import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { mkdirSync } from 'node:fs';

// Mock child_process.execSync to control which() behavior
// and node:fs statSync to control findGitBash behavior
vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return {
    ...actual,
    execSync: vi.fn(),
  };
});

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    statSync: vi.fn(),
  };
});

import { detectShell } from '../../../../src/host-env/node-host-env.js';
import { HostToolDeps } from '../../../../src/tools/builtin/workspace-deps.js';
import { NodeHostEnv } from '../../../../src/host-env/node-host-env.js';
import { execSync } from 'node:child_process';
import { statSync } from 'node:fs';

const execSyncMock = vi.mocked(execSync);
const statSyncMock = vi.mocked(statSync);

describe('shell detection (unix paths)', () => {
  const originalShell = process.env.SHELL;
  const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform');

  afterEach(() => {
    if (originalShell !== undefined) {
      process.env.SHELL = originalShell;
    } else {
      delete process.env.SHELL;
    }
    if (originalPlatform) {
      Object.defineProperty(process, 'platform', originalPlatform);
    }
    execSyncMock.mockReset();
  });

  it('should use $SHELL when set', () => {
    process.env.SHELL = '/bin/zsh';
    const shell = detectShell();
    expect(shell.path).toBe('/bin/zsh');
    expect(shell.name).toBe('zsh');
  });

  it('should fall back to /bin/zsh on macOS when $SHELL unset', () => {
    Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true });
    delete process.env.SHELL;
    const shell = detectShell();
    expect(shell.path).toBe('/bin/zsh');
    expect(shell.name).toBe('zsh');
  });

  it('should fall back to empty $SHELL on macOS', () => {
    Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true });
    process.env.SHELL = '';
    const shell = detectShell();
    expect(shell.path).toBe('/bin/zsh');
    expect(shell.name).toBe('zsh');
  });

  it('should use which("bash") on linux when $SHELL unset', () => {
    Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });
    delete process.env.SHELL;
    execSyncMock.mockReturnValue('/usr/bin/bash\n');
    const shell = detectShell();
    expect(shell.name).toBe('bash');
    expect(shell.path).toBe('/usr/bin/bash');
  });

  it('should return first result from which', () => {
    Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });
    delete process.env.SHELL;
    execSyncMock.mockReturnValue('/usr/bin/bash\n/usr/local/bin/bash\n');
    const shell = detectShell();
    expect(shell.path).toBe('/usr/bin/bash');
  });

  it('should fall back to /bin/sh when which("bash") throws', () => {
    Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });
    delete process.env.SHELL;
    execSyncMock.mockImplementation(() => {
      throw new Error('command not found');
    });
    const shell = detectShell();
    expect(shell.name).toBe('sh');
    expect(shell.path).toBe('/bin/sh');
  });
});

describe('shell detection (windows paths)', () => {
  const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform');
  const originalComspec = process.env.COMSPEC;
  const originalGitBashPath = process.env.WRANGLER_GIT_BASH_PATH;

  beforeEach(() => {
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
    delete process.env.SHELL;
  });

  afterEach(() => {
    if (originalPlatform) {
      Object.defineProperty(process, 'platform', originalPlatform);
    }
    if (originalComspec !== undefined) {
      process.env.COMSPEC = originalComspec;
    } else {
      delete process.env.COMSPEC;
    }
    if (originalGitBashPath !== undefined) {
      process.env.WRANGLER_GIT_BASH_PATH = originalGitBashPath;
    } else {
      delete process.env.WRANGLER_GIT_BASH_PATH;
    }
    execSyncMock.mockReset();
    statSyncMock.mockReset();
  });

  it('should prefer pwsh when available', () => {
    execSyncMock.mockImplementation((cmd: string) => {
      if (cmd.toString().includes('pwsh')) return 'C:\\Program Files\\PowerShell\\7\\pwsh.exe\n';
      throw new Error('not found');
    });
    const shell = detectShell();
    expect(shell.name).toBe('pwsh');
    expect(shell.path).toBe('C:\\Program Files\\PowerShell\\7\\pwsh.exe');
  });

  it('should fall back to powershell when pwsh not found', () => {
    execSyncMock.mockImplementation((cmd: string) => {
      if (cmd.toString().includes('powershell'))
        return 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe\n';
      throw new Error('not found');
    });
    const shell = detectShell();
    expect(shell.name).toBe('powershell');
  });

  it('should use WRANGLER_GIT_BASH_PATH env override', () => {
    process.env.WRANGLER_GIT_BASH_PATH = 'D:\\custom\\bash.exe';
    execSyncMock.mockImplementation(() => {
      throw new Error('not found');
    });
    const shell = detectShell();
    expect(shell.name).toBe('bash');
    expect(shell.path).toBe('D:\\custom\\bash.exe');
  });

  it('should derive git bash from git.exe location when file exists', () => {
    delete process.env.WRANGLER_GIT_BASH_PATH;
    execSyncMock.mockImplementation((cmd: string) => {
      if (cmd.toString().includes('git')) return 'C:\\Program Files\\Git\\cmd\\git.exe\n';
      throw new Error('not found');
    });
    statSyncMock.mockReturnValue({ isFile: () => true } as ReturnType<typeof statSync>);
    const shell = detectShell();
    expect(shell.name).toBe('bash');
    expect(shell.path).toContain('bash.exe');
  });

  it('should skip git bash when derived path does not exist', () => {
    delete process.env.WRANGLER_GIT_BASH_PATH;
    execSyncMock.mockImplementation((cmd: string) => {
      if (cmd.toString().includes('git')) return 'C:\\Program Files\\Git\\cmd\\git.exe\n';
      throw new Error('not found');
    });
    statSyncMock.mockImplementation(() => {
      throw new Error('ENOENT');
    });
    const shell = detectShell();
    expect(shell.name).toBe('cmd');
  });

  it('should skip git bash when git.exe is not found', () => {
    delete process.env.WRANGLER_GIT_BASH_PATH;
    execSyncMock.mockImplementation(() => {
      throw new Error('not found');
    });
    const shell = detectShell();
    expect(shell.name).toBe('cmd');
  });

  it('should fall back to COMSPEC when set', () => {
    delete process.env.WRANGLER_GIT_BASH_PATH;
    process.env.COMSPEC = 'C:\\Windows\\System32\\cmd.exe';
    execSyncMock.mockImplementation(() => {
      throw new Error('not found');
    });
    const shell = detectShell();
    expect(shell.name).toBe('cmd');
    expect(shell.path).toBe('C:\\Windows\\System32\\cmd.exe');
  });

  it('should fall back to cmd.exe when COMSPEC is not set', () => {
    delete process.env.WRANGLER_GIT_BASH_PATH;
    delete process.env.COMSPEC;
    execSyncMock.mockImplementation(() => {
      throw new Error('not found');
    });
    const shell = detectShell();
    expect(shell.name).toBe('cmd');
    expect(shell.path).toBe('cmd.exe');
  });

  it('should work with HostToolDeps constructor accepting shell override on windows', () => {
    const tempDir = join(tmpdir(), `shell-win-test-${Date.now()}`);
    mkdirSync(tempDir, { recursive: true });
    const customShell = { path: 'C:\\pwsh.exe', name: 'pwsh' };
    const deps = new HostToolDeps(new NodeHostEnv(), tempDir, 1024, customShell);
    expect(deps.shell).toEqual(customShell);
  });
});
