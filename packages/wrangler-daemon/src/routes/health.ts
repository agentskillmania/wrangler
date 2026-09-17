import { readFileSync } from 'node:fs';
import { cwd } from 'node:process';

import type { FastifyInstance } from 'fastify';

import {
  AGENTS_DIR,
  APP_DIR,
  CONFIG_PATH,
  CREWS_DIR,
  PID_PATH,
  SESSIONS_DIR,
  SKILLS_DIR,
} from '../constants.js';

/**
 * Daemon package version (the TS analog of Rust's CARGO_PKG_VERSION env!).
 * Read at module load from the package.json next to this package — src and
 * dist layouts both resolve `../../package.json` to it. Unresolvable →
 * 'unknown' rather than failing the route.
 */
function readDaemonVersion(): string {
  try {
    return (
      (
        JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf-8')) as {
          version?: string;
        }
      ).version ?? 'unknown'
    );
  } catch {
    return 'unknown';
  }
}

/** Health check route */
export async function healthRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get('/api/health', async () => {
    return { status: 'ok' };
  });

  /**
   * GET /api/env —— 环境自省（只读，R2P-233，对齐 Rust c66ff2d 的字段集）。
   *
   * 给 playground 这类观察端回答「配置在哪、数据落哪」：应用目录及其解析
   * 来源（env 覆盖还是默认值）、config.yaml 路径、各资源目录、daemon 工
   * 作目录。路径原样返回（不做 `~` 折叠，保留可直拷的绝对路径）。不返回
   * 任何凭据（provider/key 全不在场）。
   */
  fastify.get('/api/env', async () => {
    const appDirSource =
      process.env.AGENTSKILLMANIA_APP_DIR && process.env.AGENTSKILLMANIA_APP_DIR.trim() !== ''
        ? 'env:AGENTSKILLMANIA_APP_DIR'
        : 'default:~/.agentskillmania/skill-studio';

    return {
      version: readDaemonVersion(),
      appDir: APP_DIR,
      appDirSource,
      configPath: CONFIG_PATH,
      agentsDir: AGENTS_DIR,
      skillsDir: SKILLS_DIR,
      crewsDir: CREWS_DIR,
      sessionsDir: SESSIONS_DIR,
      pidPath: PID_PATH,
      daemonCwd: cwd(),
      // spec-plan 不在应用目录下：工作区锚定。
      specPlanNote: 'workspace-anchored: {workspace}/.spec-plan (specs/ plans/ archive/)',
    };
  });
}
