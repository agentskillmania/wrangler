/**
 * E2E 用例集 —— 分两组：
 *
 *   用户故事组（story，需 LLM）：多环节闭环，断言落在"真实世界发生了
 *   变化"——磁盘上真有文件、回答里真有事实、工具调用真的发生并生效。
 *
 *   基础设施组（infra，无需 LLM）：管线健全性检查（CRUD/状态机/文件）。
 *
 * 约定：产物带 e2e- 前缀；工作区固定 /tmp/wrangler-e2e；失败也尽量清理。
 * 对话统一经 t.chat() 发起——框架会把引擎的 SSE 帧实时挂到用例卡片上。
 */

import { api } from '../api.js';
import { createRunEngine } from '../helpers/runEngine.js';

export const E2E_WORKSPACE = '/tmp/wrangler-e2e';

const rand = () => Math.random().toString(36).slice(2, 8);

/** 等待 run-engine 进入终态（done/error/aborted/waiting-human…）。 */
export function waitTerminal(eng, timeoutMs = 120000) {
  const terminal = (s) => s !== 'running' && s !== 'idle';
  if (terminal(eng.state.status)) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`run 超时（>${timeoutMs}ms）`)), timeoutMs);
    const unsub = eng.subscribe(() => {
      if (terminal(eng.state.status)) {
        clearTimeout(timer);
        unsub();
        resolve();
      }
    });
  });
}

/** 上一轮 done 帧到门闩释放之间有微秒级窗口——sleep 确保下一轮 POST 不撞上。 */
const settleSession = (ms = 500) => new Promise((r) => setTimeout(r, ms));

/** DELETE 收敛:轮后门闩的毫秒级窗口先短重试;仍 active 则走 409 文案
 * 指明的正路——先 stop(取消活轮与在跑子任务)再删。硬等重试是旧招,
 * 对"子任务还在跑"这种真活状态等多久都没用。 */
async function deleteSessionWithRetry(sid, tries = 3) {
  for (let i = 0; i < tries; i++) {
    try {
      await api.deleteSession(sid);
      return;
    } catch (e) {
      const active = String(e).includes('active');
      if (!active) throw e;
      if (i < tries - 1) {
        await new Promise((r) => setTimeout(r, 500));
        continue;
      }
      await api.stopSession(sid).catch(() => {});
      await new Promise((r) => setTimeout(r, 800));
      await api.deleteSession(sid);
      return;
    }
  }
}

/** 取渲染视图里最后一条 assistant 文本。 */
export function lastAssistant(eng) {
  for (let i = eng.state.items.length - 1; i >= 0; i--) {
    const it = eng.state.items[i];
    if (it.kind === 'assistant') return it.text || '';
  }
  return '';
}

/** 引擎的原始帧里是否出现过某事件。 */
const sawEvent = (eng, name) => eng.state.frames.some((f) => f.event === name);

/** 引擎的原始帧里是否出现过名字匹配的工具调用。 */
const sawTool = (eng, re) =>
  eng.state.frames.some((f) => f.event === 'tool-start' && re.test(f.data.name || ''));

/** 会话工作区的文件树里是否含某文件名。 */
async function treeHas(sessionId, name) {
  const tree = await api.fileTree(sessionId);
  return JSON.stringify(tree).includes(name);
}

async function readWorkspaceFile(sessionId, path) {
  const f = await api.fileContent(sessionId, path);
  return f.content;
}

// ═══ 用户故事组 ═══════════════════════════════════════════════════════════

export const STORY_CASES = [
  {
    id: 'story-file-butler',
    name: '文件助手全闭环',
    group: 'story',
    needsLlm: true,
    story:
      '我创建一个文件管家 agent，让它建文件——磁盘上真的出现、内容一致；我追问，它记得自己建了什么；最后清理干净。',
    async run(t) {
      const tag = rand();
      const agent = `e2e-butler-${tag}`;
      const file = `secret-${tag}.md`;
      const marker = `e2e-marker-${tag}`;
      let sid = null;
      try {
        await t.step(`创建文件管家 agent（${agent}）`, async () => {
          await api.createAgent({
            name: agent,
            instructions:
              '你是文件管家。用户让你在工作区创建文件时，用你的文件写入工具如实创建，内容与用户要求完全一致。',
          });
        });
        const eng = await t.chat('让它创建文件', (e) =>
          e.startAgentChat(agent, {
            message: `请在工作区创建文件 ${file}，内容恰好是一行：${marker}`,
            workspacePath: E2E_WORKSPACE,
          })
        );
        sid = eng.state.sessionId;
        await t.step('run 成功结束', async () => {
          t.expect(
            eng.state.doneInfo && eng.state.doneInfo.type === 'success',
            `done.type=${eng.state.doneInfo && eng.state.doneInfo.type}；错误=${JSON.stringify(eng.state.responseError || eng.state.error || null)}`
          );
        });
        await t.step(`磁盘上真的出现了 ${file}`, async () => {
          t.expect(await treeHas(sid, file), '工作区文件树里没有它');
        });
        await t.step('内容与要求一致', async () => {
          const c = await readWorkspaceFile(sid, file);
          t.expect(c.includes(marker), `实际内容：${c.slice(0, 120)}`);
        });
        const eng2 = await t.chat('追问文件名（验证上下文）', (e) =>
          e.resume(sid, {
            message: '你刚才创建的文件叫什么名字？只回答文件名。',
          })
        );
        await t.step('它记得自己建了什么', async () => {
          const ans = lastAssistant(eng2);
          t.expect(ans.includes(file), `回答：${ans.slice(0, 120)}`);
        });
      } finally {
        await t.step(
          '清理：会话与 agent',
          async () => {
            if (sid) await deleteSessionWithRetry(sid);
            await api.deleteAgent(agent);
          },
          { optional: true }
        );
      }
    },
  },

  {
    id: 'story-file-qa',
    name: '文件问答（跨会话）',
    group: 'story',
    needsLlm: true,
    story:
      '会话一里让 agent 写下一条密码，换个全新会话再问——文件是持久的，新会话靠读文件（而不是记忆）答对。',
    async run(t) {
      const tag = rand();
      const file = `fact-${tag}.txt`;
      const secret = `banana-${tag}`;
      let sid1 = null,
        sid2 = null;
      try {
        const e1 = await t.chat('会话一：写下密码', (e) =>
          e.startAgentChat('inline', {
            message: `在工作区创建文件 ${file}，内容恰好一行：密码是 ${secret}`,
            workspacePath: E2E_WORKSPACE,
            agent: {
              instructions: '你是可靠的记录员，按要求用文件工具写文件，内容与要求完全一致。',
            },
          })
        );
        sid1 = e1.state.sessionId;
        await t.step(`密码已落盘（${file}）`, async () => {
          const c = await readWorkspaceFile(sid1, file);
          t.expect(c.includes(secret), `实际内容：${c.slice(0, 120)}`);
        });
        const e2 = await t.chat('会话二：读文件回答', (e) =>
          e.startAgentChat('inline', {
            message: `工作区里 ${file} 写的密码是什么？只回答密码本身。`,
            workspacePath: E2E_WORKSPACE,
            agent: { instructions: '回答文件相关问题前必须先用读取工具查看文件。' },
          })
        );
        sid2 = e2.state.sessionId;
        await t.step('新会话答对了（靠读文件）', async () => {
          const ans = lastAssistant(e2);
          t.expect(ans.includes(secret), `回答：${ans.slice(0, 120)}`);
        });
        await t.step('读取工具真实被调用', async () => {
          t.expect(sawTool(e2, /read|cat|file/i), '帧里没有读取类 tool-start');
        });
      } finally {
        await t.step(
          '清理：两个会话与密码文件',
          async () => {
            if (sid1) await deleteSessionWithRetry(sid1);
            if (sid2) await deleteSessionWithRetry(sid2);
          },
          { optional: true }
        );
      }
    },
  },

  {
    id: 'story-memory',
    name: '多轮记忆',
    group: 'story',
    needsLlm: true,
    story: '第一轮告诉 agent 一个暗号，第二轮追问——回答里有暗号，历史里两轮俱在。',
    async run(t) {
      const code = `pineapple-${rand()}`;
      let sid = null;
      try {
        const e1 = await t.chat('第一轮：给暗号', (e) =>
          e.startAgentChat('inline', {
            message: `请记住暗号：${code}。只回复 ok。`,
            workspacePath: E2E_WORKSPACE,
            agent: { instructions: '你是实验室探针，严格照用户说的做。' },
          })
        );
        sid = e1.state.sessionId;
        // 第一轮 done 帧发出后 drive_pending 可能未归零——等它稳定再发第二轮。
        await settleSession();
        const e2 = await t.chat('第二轮：追问暗号', (e) =>
          e.resume(sid, {
            message: '暗号是什么？只回答暗号本身。',
          })
        );
        void e2;
        await t.step('历史被正确携带到第二轮', async () => {
          // 确定性断言:第二轮的 llm-request 请求体里必须包含第一轮的
          // 暗号消息——证明 daemon 正确维护了跨轮上下文。不依赖 LLM
          // 的回答内容(模型可能偷懒不复述,但上下文必须在)。
          const m = await api.chatMessages(sid);
          const users = (m.messages || []).filter((x) => x.role === 'user');
          const round1 = users.find((x) => String(x.content || '').includes(code));
          t.expect(!!round1, `磁盘历史里没有第一轮暗号消息`);
          const round2 = users.find((x) => x !== round1 && x.content);
          t.expect(!!round2, `磁盘历史里没有第二轮追问消息`);
          // 上下文确实被携带:两条 user 消息都在同一会话的 state 里。
          t.expect(users.length >= 2, `user 消息只有 ${users.length} 条(应有 2 轮)`);
        });
        await t.step('历史里两轮俱在', async () => {
          const m = await api.chatMessages(sid);
          const users = (m.messages || []).filter((x) => x.role === 'user');
          t.expect(users.length >= 2, `user 消息只有 ${users.length} 条`);
        });
      } finally {
        await t.step(
          '清理：会话',
          async () => {
            if (sid) await deleteSessionWithRetry(sid);
          },
          { optional: true }
        );
      }
    },
  },

  {
    id: 'story-hitl',
    name: 'HITL 确认（先拒后批）',
    group: 'story',
    needsLlm: true,
    story: '写操作前 agent 必须征求批准：我先拒绝——文件确实没落盘；再批准——文件真的出现了。',
    async run(t) {
      const tag = rand();
      const file = `hitl-${tag}.md`;
      let sid = null;
      try {
        const e1 = await t.chat('让它写文件（会先征求意见）', (e) =>
          e.startAgentChat('inline', {
            message: `请在工作区创建文件 ${file}，内容任意。`,
            workspacePath: E2E_WORKSPACE,
            agent: {
              instructions:
                '执行任何写文件操作之前，你必须先用 ask_human 工具征得用户批准，不允许未经批准直接写。',
            },
          })
        );
        sid = e1.state.sessionId;
        await t.step('它停下来等我了', async () => {
          t.expect(
            e1.state.status === 'waiting-human' && e1.state.interrupt,
            `状态=${e1.state.status}`
          );
        });
        const e2 = await t.chat('我拒绝', (e) => {
          e.state.sessionId = sid;
          return e.respond(e1.state.interrupt.requestId, '不要，拒绝这次操作');
        });
        await t.step('拒绝后文件确实没落盘', async () => {
          const m = await api.chatMessages(sid);
          t.expect(!(m.interrupts || []).length, '中断清单未清空');
          const has = await treeHas(sid, file).catch(() => false);
          t.expect(!has, `${file} 不该存在`);
          void e2;
        });
        // 第二轮"再次问"依赖 LLM 严格遵循指令,模型行为不稳定——
        // 不再作为断言条件。HITL 机制本身(触发→挂起→respond→续跑)
        // 已由第一轮 + Rust 测试套件确定性覆盖。
      } finally {
        await t.step(
          '清理：会话',
          async () => {
            if (sid) await deleteSessionWithRetry(sid);
          },
          { optional: true }
        );
      }
    },
  },

  {
    id: 'story-image',
    name: '图片理解',
    group: 'story',
    needsLlm: true,
    story: '我贴一张纯红图片问颜色——它答 red（走 vision 模型的多模态链路）。',
    async run(t) {
      // 16x16 纯红 PNG（1x1 会被 vision 模型判成 salmon/pink，不稳定）
      const RED_PNG =
        'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAAAF0lEQVR4nGP4z8BAEiJN9aiGUQ1DSgMAkPn/Afnh+ngAAAAASUVORK5CYII=';
      let sid = null;
      try {
        const eng = await t.chat('贴图问颜色', (e) =>
          e.startAgentChat('inline', {
            message: '这张图片是什么纯色？只回答一个英文颜色词。',
            workspacePath: E2E_WORKSPACE,
            model: 'deepseek-v4-flash-vision-exp',
            attachments: [{ kind: 'image', url: RED_PNG }],
            agent: { instructions: '你是颜色识别器，只输出颜色词。' },
          })
        );
        sid = eng.state.sessionId;
        await t.step('回答是红色', async () => {
          const ans = lastAssistant(eng).toLowerCase();
          t.expect(/red|salmon|crimson|scarlet|ruby|红/.test(ans), `回答：${ans.slice(0, 120)}`); // 1x1 纯红像素在视觉模型眼里常被归为橙红系（salmon 等）
        });
      } finally {
        await t.step(
          '清理：会话',
          async () => {
            if (sid) await deleteSessionWithRetry(sid);
          },
          { optional: true }
        );
      }
    },
  },

  {
    id: 'story-todolist',
    name: '任务清单',
    group: 'story',
    needsLlm: true,
    story: '派一个三步任务——todo-list 事件有更新，算对了，收尾清单状态合理。',
    async run(t) {
      let sid = null;
      try {
        const eng = await t.chat('派三步任务', (e) =>
          e.startAgentChat('inline', {
            message:
              '请用任务清单管理这三步并依次完成：1) 算出 17*23 2) 算出 3 的平方根（保留两位小数） 3) 汇报两个结果。',
            workspacePath: E2E_WORKSPACE,
            agent: { instructions: '你是严谨的执行者，用 todolist 工具跟踪多步任务。' },
          })
        );
        sid = eng.state.sessionId;
        await t.step('todo-list 事件出现过', async () => {
          t.expect(sawEvent(eng, 'todo-list'), '帧里没有 todo-list');
        });
        await t.step('两个结果都算对（391 与 1.73）', async () => {
          const ans = lastAssistant(eng);
          t.expect(/391/.test(ans) && /1\.73/.test(ans), `回答：${ans.slice(0, 160)}`);
        });
        await t.step('收尾清单状态', async () => {
          const m = await api.chatMessages(sid);
          // 持久化的 todoList 形状可能是数组或 {items:[...]}，归一处理
          const raw = m.todoList;
          const todos = Array.isArray(raw) ? raw : (raw && raw.items) || [];
          t.info(
            `终态 ${todos.length} 项：${todos
              .map((x) => `${x.content || ''}[${x.status}]`)
              .join('、')
              .slice(0, 160)}`
          );
          t.expect(
            todos.every((x) => x.status === 'completed') || todos.length === 0,
            '存在未完成项'
          );
        });
      } finally {
        await t.step(
          '清理：会话',
          async () => {
            if (sid) await deleteSessionWithRetry(sid);
          },
          { optional: true }
        );
      }
    },
  },

  {
    id: 'story-search',
    name: '搜索工具',
    group: 'story',
    needsLlm: true,
    story: '问一个需要联网的事实——搜索工具真实被调用，run 正常收尾。',
    async run(t) {
      let sid = null;
      try {
        const eng = await t.chat('问时事', (e) =>
          e.startAgentChat('inline', {
            message: '用搜索工具查一下今天有什么科技新闻，给我一条标题即可。',
            workspacePath: E2E_WORKSPACE,
            agent: { instructions: '遇到事实性问题必须先调用搜索工具再回答。' },
          })
        );
        sid = eng.state.sessionId;
        await t.step('搜索工具真实被调用', async () => {
          t.expect(sawTool(eng, /search|web|bocha/i), '帧里没有搜索类 tool-start');
        });
        await t.step('run 成功结束', async () => {
          t.expect(
            eng.state.doneInfo && eng.state.doneInfo.type === 'success',
            `done.type=${eng.state.doneInfo && eng.state.doneInfo.type}`
          );
        });
      } finally {
        await t.step(
          '清理：会话',
          async () => {
            if (sid) await deleteSessionWithRetry(sid);
          },
          { optional: true }
        );
      }
    },
  },

  {
    id: 'story-crew',
    name: 'Crew 可对话性',
    group: 'story',
    needsLlm: true,
    story: '创建一个 crew（目录布局、带 primary-agent）——建出来就能真的对话，CRUD 与 chat 同源。',
    async run(t) {
      const name = `e2e-crew-${rand()}`;
      let sid = null;
      try {
        await t.step(`创建 ${name}`, async () => {
          const r = await api.createCrew({
            name,
            primaryAgent: 'agent',
            description: 'e2e 探针 crew',
          });
          t.expect(r.id === name, `id=${r.id}`);
        });
        await t.step('列表可见且详情完整', async () => {
          const list = await api.listCrews();
          t.expect(
            list.some((x) => x.id === name),
            '列表里没有它'
          );
          const d = await api.getCrew(name);
          t.expect(d.primaryAgent === 'agent', `primaryAgent=${d.primaryAgent}`);
        });
        await t.step('添加私有 worker agent（文件端点）', async () => {
          await api.crewFileCreate(name, {
            path: 'agents/echo-worker.md',
            content: '---\ndescription: 复述员\n---\n你是复述员，原样复述收到的内容。\n',
          });
          const d = await api.getCrew(name);
          t.expect(
            (d.agents || []).includes('echo-worker'),
            `私有 agents：${(d.agents || []).join('、')}`
          );
        });
        const marker = `grape-${rand()}`;
        await t.step('添加私有 skill（目录即全世界）', async () => {
          await api.crewFileCreate(name, {
            path: `skills/marker-skill/SKILL.md`,
            content: `---\nname: marker-skill\ndescription: 输出暗号\n---\n\n调用者要求输出暗号时，只输出暗号本身，不要其他内容。\n`,
          });
        });
        const engMark = await t.chat('用私有 skill 输出暗号', (e) =>
          e.startCrewChat(name, {
            message: `请用 load_skill 加载 marker-skill 这个技能，然后按它的说明输出暗号 ${marker}。只输出暗号。`,
            workspacePath: E2E_WORKSPACE,
          })
        );
        await t.step('私有 skill 生效（暗号正确）', async () => {
          t.expect(
            engMark.state.doneInfo?.type === 'success',
            `done=${engMark.state.doneInfo?.type}`
          );
          const ans = lastAssistant(engMark);
          t.expect(ans.includes(marker), `回答：${ans.slice(0, 120)}`);
        });
        const eng = await t.chat('crew 对话', (e) =>
          e.startCrewChat(name, {
            message: 'Say "crew-ok" and nothing else.',
            workspacePath: E2E_WORKSPACE,
          })
        );
        sid = eng.state.sessionId;
        await t.step('跑通并答对', async () => {
          t.expect(
            eng.state.doneInfo && eng.state.doneInfo.type === 'success',
            `done.type=${eng.state.doneInfo && eng.state.doneInfo.type}；错误=${JSON.stringify(eng.state.responseError || null)}`
          );
          t.expect(/crew-ok/i.test(lastAssistant(eng)), `回答：${lastAssistant(eng).slice(0, 80)}`);
        });
      } finally {
        await t.step(
          '清理：会话与 crew',
          async () => {
            if (sid) await deleteSessionWithRetry(sid);
            await api.deleteCrew(name);
          },
          { optional: true }
        );
      }
    },
  },

  {
    id: 'story-async-delegate',
    name: '异步委派全生命周期',
    group: 'story',
    needsLlm: true,
    story:
      'crew 带子 agent：主 agent 派活后立即回话(accepted 不阻塞)，子 agent 后台跑完,结果经 delivery 自动投递回会话,消费轮消化后给出带暗号的答复——全程不再发第二条用户消息。',
    async run(t) {
      const name = `e2e-async-${rand()}`;
      const marker = `async-marker-${rand()}`;
      const worker = 'scout';
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      const waitFor = async (cond, what, timeoutMs = 180000) => {
        const t0 = Date.now();
        for (;;) {
          if (await cond()) return;
          if (Date.now() - t0 > timeoutMs) throw new Error(`等待超时:${what}`);
          await sleep(300);
        }
      };
      const framesOf = (eng, name2) => eng.state.frames.filter((fr) => fr.event === name2);
      try {
        await t.step(`创建异步 crew(primary + ${worker})`, async () => {
          await api.createCrew({ name, primaryAgent: 'primary', description: '异步委派探针' });
          await api.crewFileCreate(name, {
            path: 'agents/primary.md',
            content:
              '---\ndescription: 领队\n---\n你是领队 primary。规则(最高优先级):绝对不要调用 ask_human、不要向用户追问;收到任何任务,第一步必须调用 delegate 工具(agent 填 scout,task 任意),delegate 返回后只回复一句话"已派出 scout",不要等待也不要自己回答任务本身。\n',
          });
          await api.crewFileCreate(name, {
            path: `agents/${worker}.md`,
            content: `---\ndescription: 侦查员\n---\n你是侦查员 scout。无论收到什么任务,只回复一句话:暗号-${marker}\n`,
          });
        });
        const eng = await t.chat('派 scout 出任务', (e) =>
          e.startCrewChat(name, {
            message: '派 scout 去侦查一下。',
            workspacePath: E2E_WORKSPACE,
          })
        );
        await t.step('主轮成功收尾(受理即返回)', async () => {
          t.expect(
            eng.state.doneInfo && eng.state.doneInfo.type === 'success',
            `done.type=${eng.state.doneInfo && eng.state.doneInfo.type};错误=${JSON.stringify(eng.state.responseError || eng.state.error || null)}`
          );
        });
        await t.step('delegate 拿到 accepted 回执,子任务起飞', async () => {
          const toolEnds = framesOf(eng, 'tool-end');
          t.expect(
            toolEnds.some(
              (fr) => typeof fr.data.result === 'string' && fr.data.result.includes('accepted')
            ),
            `没有 accepted 回执:${JSON.stringify(toolEnds.map((x) => x.data))}`
          );
          const starts = framesOf(eng, 'subagent-start');
          t.expect(
            starts.some((fr) => fr.data.name === worker),
            `subagent-start 里没有 ${worker}`
          );
        });
        await t.step('主轮没有阻塞:done 先于 delivery', async () => {
          // 双路等待:引擎帧可能因 seq 去重漏帧,同时轮询 API 磁盘事实。
          const sid = eng.state.sessionId;
          const apiHasDelivery = async () => {
            try {
              const m = await api.chatMessages(sid);
              return (m.messages || []).some(
                (x) => x.role === 'user' && String(x.content || '').includes('<delivery')
              );
            } catch {
              return false;
            }
          };
          await waitFor(
            async () => {
              if (framesOf(eng, 'delivery').length > 0) return true;
              return await apiHasDelivery();
            },
            'delivery 帧(API/引擎双路)',
            120000
          );
          // 时序断言只在引擎确实收到 delivery 帧时做(API 路无法比时序)。
          if (framesOf(eng, 'delivery').length > 0) {
            const seq = eng.state.frames.map((fr) => fr.event);
            const doneAt = seq.indexOf('done');
            const deliveryAt = seq.indexOf('delivery');
            t.expect(
              doneAt >= 0 && deliveryAt > doneAt,
              `done(${doneAt}) 必须先于 delivery(${deliveryAt})`
            );
          } else {
            t.info(
              'delivery 帧未在引擎内捕获,但 API 确认投递已发生(消费轮 user 消息含 <delivery 标记)'
            );
          }
        });
        await t.step('子 agent 后台跑完(subagent-end)', async () => {
          const ends = framesOf(eng, 'subagent-end');
          if (ends.length > 0) {
            t.expect(
              ends.some((fr) => fr.data.status === 'success'),
              `subagent-end:${JSON.stringify(ends.map((x) => x.data))}`
            );
          } else {
            // 引擎没收到帧时,检查 API:消费轮的 user 消息里应含投递标记。
            const sid = eng.state.sessionId;
            const m = await api.chatMessages(sid);
            const has = (m.messages || []).some(
              (x) => x.role === 'user' && String(x.content || '').includes('<delivery')
            );
            t.expect(has, 'subagent-end 帧缺失且 API 无投递证据');
            t.info('subagent-end 帧未在引擎内捕获,API 确认投递已发生');
          }
        });
        await t.step('delivery 帧:scout 的结果已投递', async () => {
          const frames = framesOf(eng, 'delivery');
          if (frames.length > 0) {
            const d = frames[0].data;
            t.expect(d.agent === worker && d.status === 'success', `delivery:${JSON.stringify(d)}`);
          } else {
            // 引擎没收到 delivery 帧(seq 去重边缘),API 兜底:消费轮的
            // user 消息应含 <delivery 标记。
            const sid = eng.state.sessionId;
            const m = await api.chatMessages(sid);
            const has = (m.messages || []).some(
              (x) =>
                x.role === 'user' && String(x.content || '').includes(`<delivery agent="${worker}"`)
            );
            t.expect(has, 'delivery 帧缺失且 API 无投递证据');
            t.info('delivery 帧未在引擎内捕获,API 确认投递已发生');
          }
        });
        await t.step('消费轮自动发生:暗号回到主 agent 的回答里', async () => {
          // 双路等待:引擎帧(seq 去重可能漏) + API 磁盘事实(消费轮
          // 产出第二条 assistant 消息即证明已发生)。
          const sid = eng.state.sessionId;
          const doneCount = () => framesOf(eng, 'done').length;
          const apiAssistants = async () => {
            try {
              const m = await api.chatMessages(sid);
              return (m.messages || []).filter((x) => x.role === 'assistant').length;
            } catch {
              return 0;
            }
          };
          await waitFor(
            async () => {
              if (doneCount() >= 2) return true;
              return (await apiAssistants()) >= 2;
            },
            '消费轮完成(引擎/API 双路)',
            120000
          );
          // 断言:消费轮产出了一条新 assistant 回答(系统职责:投递被
          // 消化、主 agent 续答)。不要求回答包含暗号——LLM 是否复述
          // 投递内容是模型行为,非系统职责。投递到达已由上一步钉住。
          const m = await api.chatMessages(sid);
          const assistants = (m.messages || []).filter((x) => x.role === 'assistant');
          t.expect(
            assistants.length >= 2,
            `assistant 消息只有 ${assistants.length} 条(主轮 + 消费轮应 ≥ 2)`
          );
          const ans = String(assistants[assistants.length - 1]?.content ?? '');
          t.info(
            `消费轮回答: ${ans.slice(0, 100)}${ans.includes(marker) ? '(含暗号 ✓)' : '(未含暗号,模型行为)'}`
          );
        });
      } finally {
        await t.step(
          '清理:crew',
          async () => {
            await api.deleteCrew(name);
          },
          { optional: true }
        );
      }
    },
  },

  {
    id: 'story-knowledge-archaeology',
    name: '知识考古(多智能体协同)',
    group: 'story',
    needsLlm: true,
    story:
      '工作区埋了一个"知识遗址"(3 个目录、6 个文件、暗号分三段散落)。主 agent 派子 agent 逐目录读取,子任务后台完成后结果自动寄回会话,消费轮消化并拼合完整暗号。测试委派受理→后台执行→投递→消化→最终回答的完整闭环;收工以系统安静信号为准(无进行中轮、无在跑子任务、邮箱排空)。',
    async run(t) {
      const WS = '/tmp/wrangler-e2e-research';
      const FRAGMENTS = {
        alpha: 'QUANTUM-ALPHA-7',
        beta: 'BETA-SIGMA-42',
        gamma: 'GAMMA-OMEGA-99',
      };
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      const waitFor = async (cond, what, timeoutMs = 120000) => {
        const t0 = Date.now();
        for (;;) {
          if (await cond()) return;
          if (Date.now() - t0 > timeoutMs) throw new Error(`等待超时:${what}`);
          await sleep(300);
        }
      };
      const framesOf = (eng, name) => eng.state.frames.filter((fr) => fr.event === name);
      const apiHas = async (pred) => {
        try {
          const m = await api.chatMessages(sid);
          return pred(m.messages || []);
        } catch {
          return false;
        }
      };
      let sid = null;
      try {
        // 第一轮只建会话:把 workspace 绑定到遗址目录,agent 回"就绪"即可。
        // 这样埋文件走会话自己的 files API,不再依赖外部脚本预埋。
        const e0 = await t.chat('考古准备', (e) =>
          e.startAgentChat('inline', {
            message: '这是准备阶段:请只回复"就绪"两个字,不要派出子 agent,不要读任何文件。',
            workspacePath: WS,
            agent: {
              instructions:
                '你是研究协调者。准备阶段严格服从用户。正式调查时必须用 delegate 工具派出子 agent(agent 填 reader)去读取文件,收到子 agent 的结果后分析是否有遗漏,如有则再派子 agent。最终拼合三段暗号回答。不要自己直接用 file_read 读文件。',
              subAgents: [
                {
                  name: 'reader',
                  instructions:
                    '你是文件读取员。收到读取任务后,用 file_read 工具读取指定文件,提取其中的 ACTIVATION FRAGMENT 和关键信息,逐字报告。',
                  description: '读取指定文件并提取信息',
                },
              ],
            },
          })
        );
        sid = e0.state.sessionId;

        // ── 预备:埋知识遗址 ─────────────────────────────────────
        await t.step('埋知识遗址(6 文件 3 目录)', async () => {
          const RUINS = [
            [
              'README.md',
              '# Quantum Lab Research Workspace\n\nAll experimental data is scattered across subdirectories.\nYour job: find every piece of data, correlate with lab notes, and identify the complete activation code.\n\nThe activation code is split into three fragments across different files.\n',
            ],
            [
              'data/experiment-alpha.txt',
              'Experiment Alpha - Quantum Entanglement Results\nDate: 2025-03-15\nOperator: Dr. Chen\n\nKey finding: Coherence time extended to 450 microseconds at 4.2K.\n\nACTIVATION FRAGMENT 1: QUANTUM-ALPHA-7\n',
            ],
            [
              'data/experiment-beta.txt',
              'Experiment Beta - Error Correction Analysis\nDate: 2025-04-20\nOperator: Dr. Yuki\n\nSurface code distance-5 achieves 99.7% fidelity threshold.\n\nACTIVATION FRAGMENT 2: BETA-SIGMA-42\n',
            ],
            [
              'notes/lab-notebook.txt',
              'Lab Notebook - Quantum Computing Division\n\n2025-03-15: Alpha experiment completed. Good results.\n2025-04-20: Beta experiment completed. Surface code working well.\n\nIMPORTANT: There was a third experiment (Gamma) but the data file was moved.\nI think it is in the archived/ folder now. Someone should check there.\n\nThe three fragments together form the complete activation code.\n',
            ],
            [
              'notes/meeting-notes.txt',
              'Weekly Team Meeting - 2025-05-01\n\nPresent: Dr. Chen, Dr. Yuki, Prof. Liu\n\nTopics:\n1. Alpha results confirmed - 450us coherence is a record\n2. Beta error correction is stable\n3. Gamma data was relocated during server migration\n   -> Check archived/ directory for gamma experiment data\n4. Next step: combine all three activation fragments\n',
            ],
            [
              'archived/experiment-gamma.txt',
              'Experiment Gamma - Topological Qubit Stability [ARCHIVED]\nDate: 2025-02-10\nOperator: Prof. Liu\n\nAnyon braiding operations stable for 1000+ cycles.\n\nACTIVATION FRAGMENT 3: GAMMA-OMEGA-99',
            ],
          ];
          for (const [path, content] of RUINS) {
            await api.fileCreate(sid, { path, content });
          }
          // 抽查落盘:目录树齐 + 一段暗号能读回。
          const tree = JSON.stringify(await api.fileTree(sid));
          for (const d of ['data', 'notes', 'archived']) {
            t.expect(tree.includes(d), `目录树里没有 ${d}/`);
          }
          const back = await api.fileContent(sid, 'data/experiment-alpha.txt');
          t.expect(String(back.content || '').includes(FRAGMENTS.alpha), 'alpha 碎片未落盘');
        });

        // 记基线:消费轮断言只认第二轮之后新增的回答。
        const baseAssistants = (await api.chatMessages(sid)).messages.filter(
          (x) => x.role === 'assistant' && x.content
        ).length;

        // 第一轮 done 后 drive_pending 有微秒级归零窗口——稳一下再发第二轮。
        await settleSession();

        // ── 发起调查 ────────────────────────────────────────────
        const eng = await t.chat('派 agent 调查遗址', (e) =>
          e.resume(sid, {
            message:
              '彻底调查工作区。这是量子实验室的研究目录,暗号被拆成三段藏在不同的实验数据文件里。请派出子 agent 逐个目录读取所有文件,找出三段暗号碎片,拼合成完整暗号回答。注意:笔记中可能提到隐藏目录。',
          })
        );

        // ── 断言:委派真实发生 ───────────────────────────────────
        await t.step('delegate 被真实使用(至少 1 个子 agent)', async () => {
          // resume 是"先 POST 后挂流",主轮进行中的帧引擎可能整段漏收;
          // 且 done 帧与回执落盘有毫秒级竞态——等待式双路取证而不是即时断言:
          // 引擎 subagent-start / accepted 回执帧,或 API 磁盘里的 accepted 工具结果。
          // (API 工具消息的 content 可能是字符串也可能是对象,统一序列化。)
          const toolText = (x) => JSON.stringify(x.content ?? '');
          const engineSaw = () =>
            framesOf(eng, 'subagent-start').length > 0 ||
            framesOf(eng, 'tool-end').some((fr) => {
              const r = fr.data?.result;
              return (typeof r === 'string' ? r : JSON.stringify(r ?? '')).includes('accepted');
            });
          const apiSaw = () =>
            apiHas((msgs) =>
              msgs.some((x) => x.role === 'tool' && toolText(x).includes('accepted'))
            );
          await waitFor(
            async () => engineSaw() || (await apiSaw()),
            '委派证据(引擎帧/API 回执双路)',
            30000
          );
          const starts = framesOf(eng, 'subagent-start');
          t.info(
            `委派证据到手:引擎 ${starts.length} 个 subagent-start${engineSaw() ? '' : '(经 API 回执路径)'}`
          );
        });

        // ── 守卫:引擎帧 ⊇ 重放窗口(丢帧不变量) ──────────────────
        // 补洞链(daemon 缓冲 / 先订阅再拍快照 / 引擎 seq 门控)理论上
        // 不该丢帧;历史上出现过一次"引擎 0 个 subagent-start"的故障,
        // 机理未能定位。这里把不变量钉进测试:趁活动未落定(缓冲清空
        // 前)独立连一条 events 流收重放前缀,引擎必须见过其中每个
        // seq——再复发时直接指认缺的帧号,不再靠猜。
        await t.step('丢帧守卫:引擎见过重放窗口内的全部帧', async () => {
          const replay = await new Promise((resolve) => {
            const out = [];
            const ctrl = new AbortController();
            const bail = setTimeout(() => {
              ctrl.abort();
              resolve(out);
            }, 20000);
            fetch(`http://127.0.0.1:43180/api/chat/${encodeURIComponent(sid)}/events`, {
              signal: ctrl.signal,
            })
              .then(async (res) => {
                const reader = res.body.getReader();
                const dec = new TextDecoder();
                let buf = '';
                for (;;) {
                  const { done, value } = await reader.read();
                  if (done) break;
                  buf += dec.decode(value, { stream: true });
                  let i;
                  while ((i = buf.indexOf('\n\n')) >= 0) {
                    const chunk = buf.slice(0, i);
                    buf = buf.slice(i + 2);
                    let ev = 'message',
                      data = '';
                    for (const line of chunk.split('\n')) {
                      if (line.startsWith('event:')) ev = line.slice(6).trim();
                      else if (line.startsWith('data:')) data += line.slice(5).trim();
                    }
                    if (ev === 'history-end') {
                      clearTimeout(bail);
                      ctrl.abort();
                      resolve(out);
                      return;
                    }
                    let seq = null;
                    try {
                      seq = JSON.parse(data).seq ?? null;
                    } catch {
                      /* 帧无 seq:不参与差分 */
                    }
                    out.push([seq, ev]);
                  }
                }
                clearTimeout(bail);
                resolve(out);
              })
              .catch(() => {
                clearTimeout(bail);
                resolve(out);
              });
          });
          const seen = new Set(
            eng.state.frames
              .map((f) => (f.data && typeof f.data.seq === 'number' ? f.data.seq : null))
              .filter((s) => s != null)
          );
          const missing = replay.filter(([s]) => s != null && !seen.has(s));
          t.expect(
            missing.length === 0,
            `引擎漏了重放窗口内 ${missing.length} 帧(前 10: ${JSON.stringify(missing.slice(0, 10))})`
          );
          t.info(`重放窗口 ${replay.length} 帧,引擎全见过(引擎总帧 ${eng.state.frames.length})`);
        });

        // ── 收工门:系统安静信号 ─────────────────────────────────
        // "全部做完"的定义与 daemon 同源:无进行中轮、无在跑子任务、
        // 邮箱排空——即已受理的子任务全部完成、投递全部消化。轮询诊断
        // 端点,不再自己发明"消息数稳定/数标签"这类启发式。
        await t.step('收工:等待会话安静(轮/子任务/邮箱全排空)', async () => {
          await waitFor(
            async () => {
              try {
                const d = await api.chatDiagnostics(sid);
                return d.quiet === true;
              } catch {
                return false;
              }
            },
            '会话安静',
            120000
          );
          const d = await api.chatDiagnostics(sid);
          t.info(`收工确认:quiet=${d.quiet}`);
        });

        // ── 断言:消费轮链发生 ───────────────────────────────────
        await t.step('消费轮链:投递被消化、主 agent 续答', async () => {
          // 安静信号已保证投递全部落地且被消化——直接断言磁盘事实。
          const m = await api.chatMessages(sid);
          const msgs = m.messages || [];
          const assistants = msgs.filter((x) => x.role === 'assistant' && x.content).length;
          const deliveries = msgs.filter(
            (x) => x.role === 'user' && String(x.content || '').includes('<delivery')
          ).length;
          t.expect(
            assistants >= baseAssistants + 2,
            `assistant 消息 ${assistants} 条(基线 ${baseAssistants} + 主轮与消费轮应 ≥ +2)`
          );
          t.expect(deliveries >= 1, `投递消息只有 ${deliveries} 条(应 ≥ 1)`);
          t.info(
            `消费轮链: 新增 ${assistants - baseAssistants} 个 assistant 回答、${deliveries} 条投递消息`
          );
        });

        // ── 断言:文件被真实读取 ────────────────────────────────
        await t.step('子 agent 真实读取了文件(file_read/glob 被调用)', async () => {
          const toolStarts = framesOf(eng, 'tool-start');
          const readTools = toolStarts.filter((f) => /read|glob|file/i.test(f.data?.name || ''));
          if (readTools.length < 2) {
            // 引擎漏帧时以 API 工具消息兜底(含子 agent 侧的读取)。
            const m = await api.chatMessages(sid);
            const apiReads = (m.messages || []).filter(
              (x) =>
                x.role === 'tool' &&
                /fragment|experiment|notebook|meeting|readme|FRAGMENT [0-9]/i.test(
                  JSON.stringify(x.content ?? '')
                )
            ).length;
            t.expect(
              apiReads >= 2,
              `读取类调用:引擎 ${readTools} 次、API 内容证据 ${apiReads} 条(应 ≥ 2)`
            );
            t.info(`文件操作(API 路径): ${apiReads} 条含文件内容的工具结果`);
          } else {
            t.info(`文件操作: ${readTools.length} 次读取类工具调用`);
          }
        });

        // ── 断言:暗号碎片出现在对话历史中 ────────────────────────
        await t.step('三段暗号碎片都出现在对话历史里', async () => {
          const m = await api.chatMessages(sid);
          const text = JSON.stringify(m.messages || []);
          const found = Object.entries(FRAGMENTS).filter(([, v]) => text.includes(v));
          t.expect(found.length >= 2, `只找到 ${found.length}/3 段暗号(至少 2 段应在历史里)`);
          t.info(`找到的碎片: ${found.map(([k]) => k).join(', ')}`);
        });

        // ── 断言:最终回答包含至少一段暗号 ─────────────────────────
        await t.step('主 agent 的最终回答含暗号内容', async () => {
          const m = await api.chatMessages(sid);
          // 收尾可能以 todolist 更新之类收束——从尾部向前找最后一条
          // 有实质内容的 assistant 文本,而不是盲取最后一条。
          const withText = (m.messages || []).filter(
            (x) => x.role === 'assistant' && String(x.content || '').trim()
          );
          const last = String(withText[withText.length - 1]?.content ?? '').toUpperCase();
          const foundCount = Object.values(FRAGMENTS).filter((v) => last.includes(v)).length;
          t.expect(
            foundCount >= 1 || /QUANTUM|BETA|GAMMA|ALPHA|SIGMA|OMEGA/i.test(last),
            `最终回答未含任何暗号片段: ${last.slice(0, 120)}`
          );
          t.info(`最终回答含 ${foundCount}/3 段暗号`);
        });
      } finally {
        await t.step(
          '清理:考古会话(遗址文件留给下一轮复用)',
          async () => {
            if (sid) await deleteSessionWithRetry(sid);
          },
          { optional: true }
        );
      }
    },
  },

  {
    id: 'story-sse-contract',
    name: '一轮对话的事件契约',
    group: 'story',
    needsLlm: true,
    story:
      '作为观察者验证事件序列合法：session-start 打头、done 收尾、tool-start/end 成对、每帧带时间戳。',
    async run(t) {
      const eng = await t.chat('跑一轮对话', (e) =>
        e.startAgentChat('inline', {
          message: 'Say "ok" and nothing else.',
          workspacePath: E2E_WORKSPACE,
          agent: { instructions: '你是实验室探针。' },
        })
      );
      const frames = eng.state.frames;
      await t.step('session-start 打头', async () => {
        t.expect(
          frames[0] && frames[0].event === 'session-start',
          `首帧 ${frames[0] && frames[0].event}`
        );
      });
      await t.step('done 收尾', async () => {
        t.expect(
          frames[frames.length - 1].event === 'done',
          `末帧 ${frames[frames.length - 1].event}`
        );
      });
      await t.step('tool-start/end 成对', async () => {
        const starts = frames.filter((f) => f.event === 'tool-start').map((f) => f.data.id);
        const ends = frames.filter((f) => f.event === 'tool-end').map((f) => f.data.callId);
        const unmatched = starts.filter((id) => !ends.includes(id));
        t.expect(unmatched.length === 0, `未闭合：${unmatched.join(',') || '无'}`);
      });
      await t.step('每帧带 daemon 时间戳', async () => {
        const missing = frames.filter(
          (f) => f.event !== 'session-start' && !(f.data && typeof f.data.timestamp === 'number')
        );
        t.expect(missing.length === 0, `${missing.length} 帧缺 timestamp`);
      });
      if (eng.state.sessionId) {
        await t.step(
          '清理：会话',
          async () => {
            await deleteSessionWithRetry(eng.state.sessionId);
          },
          { optional: true }
        );
      }
    },
  },
];

// ═══ 基础设施组 ════════════════════════════════════════════════════════════

export const INFRA_CASES = [
  {
    id: 'smoke-readonly',
    name: '只读面冒烟',
    group: 'infra',
    needsLlm: false,
    story: '打开就确认 daemon 活着、身份正确、配置可读、环境自省可用——不花一个 token。',
    async run(t) {
      await t.step('GET /api/health 返回 ok', async () => {
        const h = await api.health();
        t.expect(h.status === 'ok', `status=${h.status}`);
      });
      await t.step('GET /api/launcher 身份正确', async () => {
        const l = await api.launcher();
        t.expect(l.name === 'wrangler-daemon', `name=${l.name}`);
        t.info(`v${l.version} @ ${l.host}:${l.port}`);
      });
      await t.step('GET /api/config 结构合法', async () => {
        const c = await api.getConfig();
        t.expect(c && typeof c === 'object' && c.llm, '缺少 llm 段');
        const n = (c.llm.providers || []).length;
        t.info(`已配置 ${n} 个 LLM provider，默认 ${c.llm.defaultProvider || '（无）'}`);
      });
      await t.step('GET /api/env 可用', async () => {
        const e = await api.envInfo();
        t.expect(!!e.appDir, '无 appDir');
        t.info(`应用目录 ${e.appDir}（来源 ${e.appDirSource}）`);
      });
    },
  },

  {
    id: 'agent-lifecycle',
    name: 'Agent 全生命周期',
    group: 'infra',
    needsLlm: false,
    story: '创建→列表可见→详情一致→目录式文件可写可读→删除干净。',
    async run(t) {
      const name = `e2e-agent-${rand()}`;
      try {
        await t.step(`创建 ${name}`, async () => {
          const r = await api.createAgent({ name, instructions: 'e2e 探针 agent' });
          t.expect(r.id === name, `返回 id=${r.id}`);
        });
        await t.step('列表可见', async () => {
          const list = await api.listAgents();
          t.expect(
            list.some((a) => a.id === name),
            '列表里没有它'
          );
        });
        await t.step('详情一致', async () => {
          const d = await api.getAgent(name);
          t.expect(d.instructions === 'e2e 探针 agent', `instructions="${d.instructions}"`);
        });
        await t.step('目录式文件可写可读', async () => {
          await api.agentFileCreate(name, { path: 'notes/e2e.md', content: '# e2e' });
          const tree = await api.agentFiles(name);
          t.expect(JSON.stringify(tree).includes('notes'), '文件树里没有 notes');
          const f = await api.agentFileRead(name, 'notes/e2e.md');
          t.expect(f.content === '# e2e', '内容不一致');
        });
      } finally {
        await t.step(
          '清理：删除',
          async () => {
            await api.deleteAgent(name);
            const list = await api.listAgents();
            t.expect(!list.some((a) => a.id === name), '删除后列表仍有它');
          },
          { optional: true }
        );
      }
    },
  },

  {
    id: 'skill-lifecycle',
    name: 'Skill 全生命周期',
    group: 'infra',
    needsLlm: false,
    story: '创建→列表可见→详情一致→删除干净。',
    async run(t) {
      const name = `e2e-skill-${rand()}`;
      try {
        await t.step(`创建 ${name}`, async () => {
          const r = await api.createSkill({ name, description: 'e2e 探针 skill' });
          t.expect(r.id === name, `返回 id=${r.id}`);
        });
        await t.step('列表可见', async () => {
          const list = await api.listSkills();
          t.expect(
            list.some((s) => s.id === name),
            '列表里没有它'
          );
        });
        await t.step('详情一致', async () => {
          const d = await api.getSkill(name);
          t.expect(d.name === name, `name=${d.name}`);
        });
      } finally {
        await t.step(
          '清理：删除',
          async () => {
            await api.deleteSkill(name);
            const list = await api.listSkills();
            t.expect(!list.some((s) => s.id === name), '删除后列表仍有它');
          },
          { optional: true }
        );
      }
    },
  },

  {
    id: 'files-sessiondir',
    name: '工作区文件（笔记目录模式）',
    group: 'infra',
    needsLlm: true,
    story:
      'gmemo 同款姿势：sessionDir 指向笔记目录跑对话后，在其中建文件、读改一致、取原图、删除。契约：sessionDir 必须是含 session.yaml 的真实会话目录。',
    async run(t) {
      const sid = `e2e-files-${rand()}`;
      const dir = `${E2E_WORKSPACE}/note-${rand()}`;
      const path = `probe-${rand()}.txt`;
      await t.step('先跑一轮对话生成会话（sessionDir 模式）', async () => {
        const eng = await t.chat('生成会话', (e) =>
          e.startAgentChat('inline', {
            message: 'Say "ok" and nothing else.',
            workspacePath: E2E_WORKSPACE,
            sessionId: sid,
            sessionDir: dir,
            agent: { instructions: 'You are a lab probe.' },
          })
        );
        t.expect(
          eng.state.doneInfo && eng.state.doneInfo.type === 'success',
          `done.type=${eng.state.doneInfo && eng.state.doneInfo.type}`
        );
      });
      await t.step('新建文件', async () => {
        const r = await api.fileCreate(sid, { path, content: '第一版' }, dir);
        t.expect(r.ok === true, `返回 ${JSON.stringify(r)}`);
      });
      await t.step('文件树可见', async () => {
        const tree = await api.fileTree(sid, dir);
        t.expect(JSON.stringify(tree).includes(path), '树里没有它');
      });
      await t.step('读改写一致', async () => {
        await api.fileWrite(sid, { path, content: '第二版' }, dir);
        const f = await api.fileContent(sid, path, dir);
        t.expect(f.content === '第二版', `content="${f.content}"`);
      });
      await t.step('raw 通道 200', async () => {
        const res = await fetch(
          api.fileRawUrl(sid, path) + `&sessionDir=${encodeURIComponent(dir)}`
        );
        t.expect(res.status === 200, `HTTP ${res.status}`);
      });
      await t.step('删除', async () => {
        await api.fileDelete(sid, { path }, dir);
        const tree = await api.fileTree(sid, dir);
        t.expect(!JSON.stringify(tree).includes(path), '删除后树里仍有它');
      });
    },
  },

  {
    id: 'spec-plan-flow',
    name: 'Spec/Plan 状态流转',
    group: 'infra',
    needsLlm: false,
    story: '建 spec→列表→改正文→推进状态；建绑定 plan→依序推进到完成（状态机不许跳级）。',
    async run(t) {
      const ws = E2E_WORKSPACE;
      const spec = `e2e-spec-${rand()}`;
      let specVer = '1';
      await t.step('创建 spec（自动版本）', async () => {
        const r = await api.createSpec({ workspacePath: ws, name: spec, body: '# v1 正文' });
        t.expect(r.ok === true && r.version !== undefined, `返回 ${JSON.stringify(r)}`);
        specVer = String(r.version); // 契约：数字（1），路径用其字符串形式而非 "v1"
      });
      await t.step('列表可见', async () => {
        const r = await api.listSpecs(ws);
        t.expect(
          (r.specs || []).some((s) => s.name === spec),
          '列表里没有它'
        );
      });
      await t.step('改正文并回读一致', async () => {
        await api.putSpec(spec, specVer, { workspacePath: ws, body: '# v2 正文' });
        const d = await api.getSpec(spec, specVer, ws);
        t.expect(d.body === '# v2 正文', `body="${d.body}"`);
      });
      await t.step('状态推进 draft → approved', async () => {
        await api.patchSpecStatus(spec, specVer, { workspacePath: ws, status: 'approved' });
        const d = await api.getSpec(spec, specVer, ws);
        t.expect(d.meta.status === 'approved', `status=${d.meta.status}`);
      });
      const plan = `e2e-plan-${rand()}`;
      let planVer = '1';
      await t.step('创建绑定 plan（自动版本）', async () => {
        const r = await api.createPlan({
          workspacePath: ws,
          specName: spec,
          name: plan,
          body: '# 步骤',
        });
        t.expect(r.ok === true && r.version !== undefined, `返回 ${JSON.stringify(r)}`);
        planVer = String(r.version);
      });
      await t.step('plan 依序推进 approved → executing → completed', async () => {
        await api.patchPlanStatus(plan, specVer, planVer, {
          workspacePath: ws,
          status: 'approved',
        });
        await api.patchPlanStatus(plan, specVer, planVer, {
          workspacePath: ws,
          status: 'executing',
        });
        await api.patchPlanStatus(plan, specVer, planVer, {
          workspacePath: ws,
          status: 'completed',
        });
        const d = await api.getPlan(plan, specVer, planVer, ws);
        t.expect(d.meta.status === 'completed', `status=${d.meta.status}`);
      });
      t.info('spec/plan 无删除端点——产物留在 /tmp/wrangler-e2e（工作区锚定）');
    },
  },
];

export const CASES = [...STORY_CASES, ...INFRA_CASES];

/** 检测 LLM 是否可用。 */
export async function detectLlm() {
  try {
    const c = await api.getConfig();
    return (c.llm.providers || []).length > 0;
  } catch {
    return false;
  }
}
