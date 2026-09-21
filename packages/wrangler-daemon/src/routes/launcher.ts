import type { FastifyInstance } from 'fastify';

/**
 * Launcher data route — agents, skills, sessions overview.
 *
 * Provides a single endpoint that returns all launcher data needed
 * to render the home screen: available agents, skills, and sessions.
 */
export async function launcherRoutes(fastify: FastifyInstance): Promise<void> {
  /**
   * GET /api/launcher
   *
   * Returns combined launcher data: agents, skills, and sessions.
   * All three queries run in parallel for efficiency.
   */
  fastify.get('/api/launcher', async () => {
    // daemon 身份（对齐 Rust health.rs 的 LauncherResponse：名称/版本/
    // 端口/主机——原 agents/skills/sessions 聚合形状无消费方，随 65732f3
    // 的 playground 家族对齐收编）。
    const addr = fastify.server.address();
    const address = typeof addr === 'string' ? addr : (addr ?? { port: 0, address: '' });
    return {
      name: 'wrangler-daemon',
      version: process.env.npm_package_version ?? '0.0.0-dev',
      port: typeof address === 'object' ? address.port : 0,
      host: typeof address === 'object' ? address.address : '',
    };
  });
}
