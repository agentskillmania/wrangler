// packages/wrangler-devtool/src/tools/init-workspace.ts
// Workspace 初始化

import { mkdir, writeFile, readdir } from 'node:fs/promises';
import { join, resolve, basename } from 'node:path';
import { CliError, ExitCode } from '../cli/options.js';

export interface InitOptions {
  mode: 'agent' | 'crew' | 'bare';
}

function getAgentMd(name: string): string {
  return `---
name: ${name}
description: A new agent
---

# ${name}

Describe your agent's purpose and behavior here.
`;
}

function getCrewMd(name: string): string {
  return `---
name: ${name}
description: A new crew
---

# ${name}

Describe your crew's purpose and coordination rules here.
`;
}

/**
 * 初始化 wrangler workspace
 *
 * @param cwd - 目标目录
 * @param options - 初始化选项
 */
export async function initWorkspace(cwd: string, options: InitOptions): Promise<void> {
  const dir = resolve(cwd);

  // 检查目录是否已存在且非空
  try {
    const entries = await readdir(dir);
    const nonDot = entries.filter((e) => !e.startsWith('.'));
    if (nonDot.length > 0) {
      throw new CliError(`Directory ${dir} is not empty`, 'DIR_NOT_EMPTY', ExitCode.GeneralError);
    }
  } catch (error) {
    if (error instanceof CliError) throw error;
    // 目录不存在，允许继续
  }

  await mkdir(dir, { recursive: true });

  if (options.mode === 'agent') {
    const name = basename(dir);
    await writeFile(join(dir, 'AGENT.md'), getAgentMd(name), 'utf-8');
  } else if (options.mode === 'crew') {
    const name = basename(dir);
    await writeFile(join(dir, 'CREW.md'), getCrewMd(name), 'utf-8');
    await mkdir(join(dir, 'agents'), { recursive: true });
  }

  await mkdir(join(dir, 'skills'), { recursive: true });
  await mkdir(join(dir, 'test'), { recursive: true });
}
