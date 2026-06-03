// packages/wrangler-devtool/src/tools/create-template.ts
// 模板文件生成

import { writeFile, access, mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import { CliError, ExitCode } from '../cli/options.js';

function getAgentTemplate(name: string): string {
  return `---
name: ${name}
description: A new agent
---

# ${name}

Describe your agent's purpose and behavior here.
`;
}

function getSkillTemplate(name: string): string {
  return `---
name: ${name}
description: A new skill
---

# ${name}

Describe when and how to use this skill.
`;
}

function getCrewTemplate(name: string): string {
  return `---
name: ${name}
description: A new crew
---

# ${name}

Describe your crew's purpose and coordination rules here.
`;
}

/**
 * 创建空模板文件
 *
 * @param type - 模板类型
 * @param name - 名称
 * @param cwd - 工作目录
 * @returns 创建的文件路径
 */
export async function createTemplate(
  type: 'agent' | 'skill' | 'crew' | 'session',
  name: string,
  cwd: string
): Promise<string> {
  const dir = resolve(cwd);
  let filePath: string;
  let content: string;

  switch (type) {
    case 'agent':
      filePath = join(dir, 'AGENT.md');
      content = getAgentTemplate(name);
      break;
    case 'skill':
      filePath = join(dir, 'skills', `${name}.md`);
      content = getSkillTemplate(name);
      await mkdir(join(dir, 'skills'), { recursive: true });
      break;
    case 'crew':
      filePath = join(dir, 'CREW.md');
      content = getCrewTemplate(name);
      break;
    case 'session':
      filePath = join(dir, '.vibe', `${name}.md`);
      content = '';
      await mkdir(join(dir, '.vibe'), { recursive: true });
      break;
    default:
      throw new CliError(
        `Unknown template type: ${type}`,
        'INVALID_TYPE',
        ExitCode.ValidationFailure
      );
  }

  try {
    await access(filePath);
    throw new CliError(
      `File already exists: ${filePath}`,
      'FILE_EXISTS',
      ExitCode.ValidationFailure
    );
  } catch (error) {
    if (error instanceof CliError) throw error;
    // 文件不存在，继续
  }

  await writeFile(filePath, content, 'utf-8');
  return filePath;
}
