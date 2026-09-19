import type { FastifyInstance } from 'fastify';

import type { DecoratedFastifyInstance } from '../types.js';

/**
 * Session query and deletion routes.
 *
 * Sessions are created automatically by wrangler session middleware during
 * runner.run(). This module only provides read, fork, and delete operations.
 */
export async function sessionRoutes(fastify: FastifyInstance): Promise<void> {
  const decorated = fastify as unknown as DecoratedFastifyInstance;
  const manager = () => decorated.sessionManager;

  /**
   * GET /api/sessions
   *
   * Returns all sessions sorted by most recently updated.
   * Optional query parameter `workspacePath` filters by workspace.
   */
  fastify.get('/api/sessions', async (request) => {
    // 健康快照时机顺带惰性驱逐（R2P-121，对齐 Rust daemon 在挂流/健康快照/
    // 定时清扫调 evict_idle——温会话回收不只依赖"有新会话插入"时的顺手
    // 清扫）。驱逐=内存下线、盘保留，list 本身走盘不受影响。
    manager().evictIdleSessions();
    const query = request.query as { workspacePath?: string };
    return manager().list(query.workspacePath);
  });

  /**
   * POST /api/sessions/:id/fork
   *
   * Forks a session: copies agent state and conversation history
   * into a new session with a new ID. The new session can continue
   * independently from the same point.
   */
  fastify.post('/api/sessions/:id/fork', async (request) => {
    const { id } = request.params as { id: string };

    const info = await manager().getInfo(id);
    if (!info) return { error: 'Session not found' };

    const store = manager().getSessionStore(info.workspacePath);

    const state = await store.loadState(id);
    if (!state) return { error: 'Session state not found' };

    // Generate a new session ID and create the session
    const newId = `${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
    await store.createWithId(newId, info.agentName);

    // Copy state with new ID
    const forkedState = { ...state, id: newId };
    await store.saveState(newId, forkedState);

    manager().registerSession(newId, info.workspacePath);

    return { id: newId };
  });

  /**
   * GET /api/sessions/:id
   *
   * Returns session info by id.
   */
  fastify.get('/api/sessions/:id', async (request) => {
    const { id } = request.params as { id: string };
    const info = await manager().getInfo(id);
    if (!info) return { error: 'Session not found' };
    return info;
  });

  /**
   * DELETE /api/sessions/:id
   *
   * Deletes a session by id. Stops the active AgentSession if running.
   */
  fastify.delete('/api/sessions/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    // R2P-161b①（对齐 Rust 098adbd 的先查注册表再删盘）：冷装配占位中的
    // id 不可删——delete() 会清掉占位并删盘，而在飞装配的 finally 随后
    // setAgentSession 注册一个盘上已删的僵尸会话（下一轮 afterRun 落盘
    // 还会把目录"复活"）。409 starting 分诊让客户端等装配落定后重试。
    if (manager().isReservedAgentSession(id)) {
      reply.code(409);
      return {
        error: 'Session is busy',
        reason: 'starting',
        detail:
          'the session is being assembled from disk (cold start); retry the delete after it finishes',
      };
    }
    // P2-c 评审 P1（对齐 Rust delete_session_route 的 quiet_blockers 三臂
    // 静默闸）：有活轮/子女/邮箱时强删会孤儿化进行中的驱动——stop() 触发
    // 的收尾钩子在孤儿对象上开消费轮真 LLM 调用（计费僵尸轮），且
    // beforeRun/afterRun 会复活刚删的目录。blockedBy 逐项说清在等什么。
    const session = manager().getAgentSession(id);
    if (session) {
      const blockers: string[] = [];
      if (session.busy) blockers.push('a turn is in flight');
      if (session.hasActiveChildren()) blockers.push('sub-task(s) still running');
      if (session.hasPendingDeliveries()) blockers.push('pending delivery(ies) not yet consumed');
      if (blockers.length > 0) {
        reply.code(409);
        return { error: 'Session is active; stop it before deleting', blockedBy: blockers };
      }
    }
    await manager().delete(id);
    return { ok: true };
  });
}
