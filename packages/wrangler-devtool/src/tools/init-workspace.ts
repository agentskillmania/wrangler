// packages/wrangler-devtool/src/tools/init-workspace.ts
// Workspace 初始化

import { mkdir, writeFile, readdir, readFile } from 'node:fs/promises';
import { join, resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as git from 'isomorphic-git';
import * as nodeFs from 'node:fs';
import { CliError, ExitCode } from '../cli/options.js';

export interface InitOptions {
  mode: 'agent' | 'crew' | 'bare';
  noGit?: boolean;
}

const __dirname = fileURLToPath(new URL('.', import.meta.url));

function getTemplatesDir(): string {
  // 开发时: src/tools/ -> ../templates (即 src/templates)
  // 生产时: dist/tools/ -> ../templates (即 dist/templates)
  return join(__dirname, '..', 'templates');
}

async function loadTemplate(name: string): Promise<string> {
  const filePath = join(getTemplatesDir(), name);
  return readFile(filePath, 'utf-8');
}

function renderTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_match, key) => vars[key] ?? _match);
}

/**
 * 检测目录是否已在 git repo 中
 */
async function isInGitRepo(dir: string): Promise<boolean> {
  try {
    await git.findRoot({ fs: nodeFs, filepath: dir });
    return true;
  } catch {
    return false;
  }
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

  // Git 初始化
  if (!options.noGit && !(await isInGitRepo(dir))) {
    try {
      await git.init({ fs: nodeFs, dir, defaultBranch: 'main' });
    } catch {
      // git init 失败不阻断流程
    }
  }

  // MCP 配置
  const mcpJson = await loadTemplate('mcp.json');
  await writeFile(join(dir, 'mcp.json'), mcpJson, 'utf-8');

  const mcpJsonExample = await loadTemplate('mcp.json.example');
  await writeFile(join(dir, 'mcp.json.example'), mcpJsonExample, 'utf-8');

  // Skills 目录 + 样例
  await mkdir(join(dir, 'skills'), { recursive: true });
  const skillExample = await loadTemplate('skill-example.md');
  await writeFile(join(dir, 'skills', 'example.md'), skillExample, 'utf-8');

  // Test 目录 + 样例
  await mkdir(join(dir, 'test'), { recursive: true });
  const testExample = await loadTemplate('test-example.yaml');
  await writeFile(join(dir, 'test', 'example.yaml'), testExample, 'utf-8');

  // 模式特定文件
  if (options.mode === 'agent') {
    const name = basename(dir);
    const agentTemplate = await loadTemplate('agent.md');
    await writeFile(join(dir, 'AGENT.md'), renderTemplate(agentTemplate, { name }), 'utf-8');
  } else if (options.mode === 'crew') {
    const name = basename(dir);
    const crewTemplate = await loadTemplate('crew.md');
    await writeFile(join(dir, 'CREW.md'), renderTemplate(crewTemplate, { name }), 'utf-8');
    await mkdir(join(dir, 'agents'), { recursive: true });
  }
}
