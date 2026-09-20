/**
 * @fileoverview User Story: Crew chat end-to-end via daemon HTTP API (Integration)
 *
 * As a daemon client
 * I want to start a conversation driven by a crew config
 * So that the primary agent can delegate sub-tasks to worker sub-agents
 * and I see the delegation events stream through SSE in real time
 *
 * Acceptance Criteria:
 * 1. POST /api/chat/:id {crew} 首次即建（统一发送端点，ack 语义——原
 *    /api/crews/:id/chat 已并入，对齐 Rust 65732f3）
 * 2. The SSE stream contains subagent-* events proving the primary agent
 *    delegated to the worker sub-agent (subagent-start, subagent-token,
 *    subagent-end)
 * 3. POST /api/chat/:sessionId resumes the crew session and the resumed
 *    session still has the delegate tool wired (subagent-* events fire again)
 *
 * Tests use the real LLM via .env (no mocks). Gated by
 * ENABLE_INTEGRATION_TESTS=true. The fixture is a minimal crew whose
 * orchestrator is instructed to delegate every user question verbatim,
 * and whose researcher is instructed to answer with a fixed keyword —
 * so the test verifies the *event-flow pathway*, not sub-agent intelligence.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import Fastify, { type FastifyInstance } from 'fastify';
import { ConfigManager } from '../../src/core/config-manager.js';
import { ResourceManager } from '../../src/core/resource-manager.js';
import { SessionManager } from '../../src/core/session-manager.js';
import { chatRoutes } from '../../src/routes/chat.js';
import { testConfig, itif } from './config.js';

/**
 * Helper: parse SSE text into structured events.
 */
function parseSSE(raw: string): Array<{ event: string; data: unknown }> {
  const results: Array<{ event: string; data: unknown }> = [];
  const chunks = raw.split('\n\n').filter((c) => c.trim());
  for (const chunk of chunks) {
    const lines = chunk.split('\n');
    let event = '';
    let data = '';
    for (const line of lines) {
      if (line.startsWith('event: ')) event = line.slice(7);
      else if (line.startsWith('data: ')) data = line.slice(6);
    }
    if (event) {
      results.push({ event, data: data ? JSON.parse(data) : {} });
    }
  }
  return results;
}

/**
 * 增量读取常驻 events 流（GET /api/chat/:id/events），直到谓词满足或超时。
 *
 * R2P-141 起 daemon 会话恒为异步委派：delegate 受理即返回，子任务在后台
 * 跑——subagent-* 帧、delivery 投递帧与消费轮都发生在会话通道上，可能
 * 晚于请求级流关闭（对齐 Rust：观察面是常驻 events 流，不是 send 响应）。
 * 请求级流早关不再等于委派失败；本助手补齐异步段的观察窗。
 */
async function readEventsUntil(
  url: string,
  stop: (events: Array<{ event: string }>) => boolean,
  timeoutMs: number
): Promise<Array<{ event: string; data: unknown }>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const collected: Array<{ event: string; data: unknown }> = [];
  try {
    const res = await fetch(url, { signal: controller.signal });
    expect(res.status).toBe(200);
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let idx: number;
      while ((idx = buf.indexOf('\n\n')) >= 0) {
        const chunk = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        if (chunk.trim()) collected.push(...parseSSE(chunk + '\n\n'));
      }
      if (stop(collected)) {
        controller.abort();
        break;
      }
    }
  } catch {
    /* abort（谓词满足或超时）——已收集的帧足够断言/报错定位 */
  } finally {
    clearTimeout(timer);
  }
  return collected;
}

/**
 * 异步委派全链路的收敛谓词：子任务完成（subagent-end）→ 投递落箱
 * （delivery 帧）→ 消费轮消化（delivery 之后的 done）。三者齐 = 结果已
 * 回到 LLM，R2P-141/142 的端到端闭环。
 */
function delegationLoopSettled(events: Array<{ event: string }>): boolean {
  const deliveryIdx = events.findIndex((e) => e.event === 'delivery');
  if (deliveryIdx < 0) return false;
  if (!events.some((e) => e.event === 'subagent-end')) return false;
  return events.slice(deliveryIdx + 1).some((e) => e.event === 'done');
}

describe('Integration: Crew chat', () => {
  let fastify: FastifyInstance;
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'daemon-crew-chat-'));

    // LLM config from .env (no mocks)
    const configPath = join(tempDir, 'config.yaml');
    await writeFile(
      configPath,
      `llm:\n  providers:\n    - name: ${JSON.stringify(testConfig.provider)}\n      apiKey: ${JSON.stringify(testConfig.apiKey)}\n${testConfig.baseUrl ? `      baseUrl: ${JSON.stringify(testConfig.baseUrl)}\n` : ''}      models:\n        - modelId: ${JSON.stringify(testConfig.testModel)}\n          contextWindow: 128000\n          maxTokens: 4096\n          reasoning: false\nserver:\n  port: 3100\n  host: localhost\n`
    );
    const configManager = new ConfigManager(configPath);
    await configManager.init();

    // Build a minimal crew on disk:
    //   - primary: orchestrator (forced to delegate every question)
    //   - worker:  researcher (answers with a fixed keyword)
    const agentsDir = join(tempDir, 'agents');
    const skillsDir = join(tempDir, 'skills');
    const crewsDir = join(tempDir, 'crews');
    const crewDir = join(crewsDir, 'delegate-crew');
    await mkdir(join(crewDir, 'agents'), { recursive: true });

    await writeFile(
      join(crewDir, 'CREW.md'),
      [
        '---',
        'name: delegate-crew',
        'primary-agent: orchestrator',
        '---',
        '',
        '# delegate-crew',
        '',
        'A crew whose orchestrator must delegate every user question to the researcher.',
        '',
      ].join('\n')
    );

    await writeFile(
      join(crewDir, 'agents', 'orchestrator.md'),
      [
        '---',
        'name: orchestrator',
        'description: routes every user question to the researcher',
        '---',
        '',
        'You are the orchestrator. For EVERY user question, you MUST call the',
        '`delegate` tool with name="researcher" and pass the user question as the',
        'task. Do not answer the question yourself. After the researcher returns,',
        'reply with a one-line summary that includes the token "DELEGATED".',
        // 异步委派收敛锚（R2P-141）：投递消息（<delivery> 包裹的子任务结果）
        // 不是新的用户问题——再委派会制造「投递→再委派→再投递」的活锁，
        // 测试永远等不到安静。收到投递即收尾作答。
        'When you receive a message containing <delivery> blocks (results of',
        'sub-tasks you delegated), do NOT delegate again — that is not a new user',
        'question. Reply with the one-line DELEGATED summary immediately.',
      ].join('\n')
    );

    await writeFile(
      join(crewDir, 'agents', 'researcher.md'),
      [
        '---',
        'name: researcher',
        'description: answers questions with a fixed marker',
        '---',
        '',
        'You are the researcher. Answer the delegated task briefly. Your answer',
        'must include the token "RESEARCHER_OK".',
      ].join('\n')
    );

    const resourceManager = new ResourceManager(agentsDir, skillsDir, crewsDir);
    await resourceManager.init();

    const sessionsDir = join(tempDir, 'sessions');
    const sessionManager = new SessionManager(sessionsDir);
    await sessionManager.init();

    fastify = Fastify();
    fastify.decorate('configManager', configManager);
    fastify.decorate('resourceManager', resourceManager);
    fastify.decorate('sessionManager', sessionManager);
    await fastify.register(chatRoutes);
    await fastify.listen({ port: 0, host: '127.0.0.1' });
  });

  afterEach(async () => {
    await fastify.close();
    await rm(tempDir, { recursive: true, force: true });
  });

  function getUrl(): string {
    const addr = fastify.addresses()[0];
    return typeof addr === 'string' ? addr : `http://127.0.0.1:${addr.port}`;
  }

  itif(testConfig.enabled)(
    'POST /api/chat/:id {crew} 首次即建——subagent-* events for a delegation round',
    { timeout: 320_000 } as never,
    async () => {
      const workspaceDir = join(tempDir, 'workspace');
      await mkdir(workspaceDir, { recursive: true });

      // 统一发送端点创建（client-chosen id + crew 字段）→ ack；轮帧全在
      // 常驻 events 流上收。
      const sessionId = 'crew-intg-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
      const res = await fetch(`${getUrl()}/api/chat/${sessionId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: 'What is 2+2? Delegate this to the researcher.',
          workspacePath: workspaceDir,
          crew: 'delegate-crew',
          sessionId,
          thinkingEnabled: false,
          model: testConfig.testModel,
        }),
      });
      if (res.status !== 200) {
        // eslint-disable-next-line no-console
        console.log('[crew-chat] non-200 body:', (await res.text()).slice(0, 500));
      }
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toContain('application/json');
      const ack = (await res.json()) as { sessionId: string; turnSeq: number };
      expect(ack.sessionId).toBe(sessionId);
      expect(typeof ack.turnSeq).toBe('number');

      const events: Array<{ event: string; data: unknown }> = [];
      const eventTypes: string[] = [];

      // 异步委派（R2P-141 起）：子任务后台执行，帧与投递在会话通道上——
      // 请求级流关闭后经常驻 events 流补齐观察窗，直到全链路收敛。
      const channel = await readEventsUntil(
        `${getUrl()}/api/chat/${sessionId}/events`,
        delegationLoopSettled,
        150_000
      );
      const union = [...events, ...channel];
      const unionTypes = union.map((e) => e.event);

      // Sub-agent delegation pathway — the core assertion of this test.
      // If any of these are missing, the daemon crew integration is broken.
      expect(unionTypes).toContain('subagent-start');
      expect(unionTypes).toContain('subagent-token');
      expect(unionTypes).toContain('subagent-end');

      // The sub-agent's tokens must carry the fixed marker, proving the
      // researcher (not the orchestrator) produced the streamed output.
      const subagentTokens = union
        .filter((e) => e.event === 'subagent-token')
        .map((e) => (e.data as { delta?: string }).delta ?? '')
        .join('');
      expect(subagentTokens).toMatch(/RESEARCHER_OK/);

      // subagent-end must carry structured metrics (tokens + duration)
      const subagentEnd = union.find((e) => e.event === 'subagent-end');
      expect(subagentEnd).toBeDefined();
      const endData = subagentEnd!.data as Record<string, unknown>;
      expect(endData.tokens).toBeDefined();
      expect((endData.tokens as { input: number }).input).toBeGreaterThanOrEqual(0);
      expect(endData.duration).toBeDefined();
      expect(endData.duration as number).toBeGreaterThanOrEqual(0);

      // 异步闭环（R2P-141/142）：子完成的投递帧到达，且 subtaskId 与受理
      // 的 subagent-start 配对；delivery 之后有 done = 消费轮把结果喂回了
      // LLM。
      const subagentStart = union.find((e) => e.event === 'subagent-start');
      const delivery = union.find((e) => e.event === 'delivery');
      expect(delivery).toBeDefined();
      expect((delivery!.data as { subtaskId?: string }).subtaskId).toBe(
        (subagentStart!.data as { subtaskId?: string }).subtaskId
      );
      expect(delegationLoopSettled(channel)).toBe(true, 'delivery 后消费轮收敛');

      // 收尾安静（防 afterEach 撕 fastify/临时目录时后台轮仍在写盘）。
      const sm = (
        fastify as unknown as {
          sessionManager: SessionManager & {
            activeSessions: Map<string, unknown>;
          };
        }
      ).sessionManager;
      const warm = sm.activeSessions.get(sessionId) as
        | {
            busy: boolean;
            hasActiveChildren(): boolean;
            hasPendingDeliveries(): boolean;
          }
        | undefined;
      if (warm) {
        await vi.waitFor(
          () =>
            expect(!warm.busy && !warm.hasActiveChildren() && !warm.hasPendingDeliveries()).toBe(
              true
            ),
          // 与下方 resume 用例同窗（150s）：收敛前可能还有一整轮消费轮
          // （LLM 真跑，非 mock），60s 实测不够。
          { timeout: 150_000, interval: 250 }
        );
      }
    }
  );

  itif(testConfig.enabled)(
    'POST /api/chat/:sessionId resumes a crew session and delegation still fires',
    { timeout: 320_000 } as never,
    async () => {
      const workspaceDir = join(tempDir, 'workspace');
      await mkdir(workspaceDir, { recursive: true });

      // Step 1: 统一发送端点创建会话（ack；client-chosen id + crew 字段）。
      const sessionId = 'crew-resume-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
      const firstRes = await fetch(`${getUrl()}/api/chat/${sessionId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: 'Say hello. Delegate this to the researcher.',
          workspacePath: workspaceDir,
          crew: 'delegate-crew',
          sessionId,
          thinkingEnabled: false,
          model: testConfig.testModel,
        }),
      });
      expect(firstRes.status).toBe(200);
      const firstAck = (await firstRes.json()) as { sessionId: string };
      expect(firstAck.sessionId).toBe(sessionId);

      // Evict the in-memory AgentSession so the next /api/chat/:sessionId
      // call is forced down the AgentSession.resume path (which is what
      // step 7's crewId reload addresses). Without this eviction, the
      // daemon would just reuse the still-active runner and never reload
      // crew config — masking any resume-path regression.
      const sm = (
        fastify as unknown as {
          sessionManager: SessionManager & {
            activeSessions: Map<string, unknown>;
          };
        }
      ).sessionManager;
      // R2P-141：首次委派是异步的——子任务在请求流关闭后仍在后台跑。
      // 驱逐前等它完整落地（子女清零 + 投递消化 + 无在飞轮），否则旧
      // 会话对象的后台活动会与 resume 出的新对象交叉写同一会话目录。
      const warm = sm.activeSessions.get(sessionId) as
        | {
            busy: boolean;
            hasActiveChildren(): boolean;
            hasPendingDeliveries(): boolean;
          }
        | undefined;
      expect(warm).toBeDefined();
      await vi.waitFor(
        () =>
          expect(!warm!.busy && !warm!.hasActiveChildren() && !warm!.hasPendingDeliveries()).toBe(
            true
          ),
        { timeout: 150_000, interval: 250 }
      );
      sm.activeSessions.delete(sessionId);
      // Sanity check: eviction worked.
      expect(sm.activeSessions.has(sessionId)).toBe(false);

      // Step 2: resume the session with a follow-up that should also delegate.
      // R2P-153 双轨迁移：send 默认 ack 化——旧「send 即流」断言经 ?stream=1 过渡轨保持。
      const resumeRes = await fetch(`${getUrl()}/api/chat/${sessionId}?stream=1`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: 'One more: what is 3+3? Delegate to the researcher.',
          thinkingEnabled: false,
          model: testConfig.testModel,
        }),
      });
      if (resumeRes.status !== 200) {
        // eslint-disable-next-line no-console
        console.log('[crew-resume] non-200 body:', (await resumeRes.text()).slice(0, 500));
      }
      expect(resumeRes.status).toBe(200);
      const resumeRaw = await resumeRes.text();
      const resumeEvents = parseSSE(resumeRaw);
      {
        const types = resumeEvents.map((e) => e.event);
        if (!types.includes('done')) {
          // eslint-disable-next-line no-console
          console.log(
            '[crew-resume] stream without done. events:',
            JSON.stringify(resumeEvents).slice(0, 600)
          );
        }
      }
      const resumeEventTypes = resumeEvents.map((e) => e.event);

      expect(resumeEventTypes).toContain('done');
      // The resumed session must still have the delegate tool wired
      // (this is what step 7's crewId reload makes possible)——R2P-141 起
      // 异步受理：subagent-* 帧与投递在会话通道上，经 events 流断言。
      const channel = await readEventsUntil(
        `${getUrl()}/api/chat/${sessionId}/events`,
        delegationLoopSettled,
        150_000
      );
      const union = [...resumeEvents, ...channel];
      const unionTypes = union.map((e) => e.event);
      expect(unionTypes).toContain('subagent-start');
      expect(unionTypes).toContain('subagent-token');
      expect(unionTypes).toContain('subagent-end');

      const subagentTokens = union
        .filter((e) => e.event === 'subagent-token')
        .map((e) => (e.data as { delta?: string }).delta ?? '')
        .join('');
      expect(subagentTokens).toMatch(/RESEARCHER_OK/);
      // 异步闭环：投递帧到达且消费轮收敛（delivery 后有 done）。
      expect(unionTypes).toContain('delivery');
      expect(delegationLoopSettled(channel)).toBe(true);
    }
  );
});
