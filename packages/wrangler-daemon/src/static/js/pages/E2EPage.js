/**
 * 自动测试页 —— 一键跑用户故事与基础设施用例。
 * 运行时过程完全可见：每个用例卡自动展开三个实时区——
 *   步骤（✓/✗ 与断言详情）/ SSE 事件流（聊天用例内嵌 RunLab 同款
 *   EventStream，token·工具·相位实时滚动）/ HTTP 调用（该用例期间的
 *   每个请求，点击展开请求体与响应原文；按全局请求日志水位归属）。
 */
import { html, useState, useEffect } from '../utils.js';
import { STORY_CASES, INFRA_CASES, detectLlm, waitTerminal } from '../e2e/cases.js';
import { createRunEngine } from '../helpers/runEngine.js';
import { requestLog, onRequestLogChange } from '../api.js';
import { EventStream } from '../components/EventStream.js';
import { JsonTree } from '../components/JsonTree.js';

const CASE_TIMEOUT_MS = 180000;
const STATUS_LABELS = {
  pending: '未跑',
  running: '运行中',
  pass: '通过',
  fail: '失败',
  skipped: '已跳过',
};

/** 执行单个用例。onEvent 用于逐步实时上报（步骤/流/水位都可能触发）。 */
async function runCase(def, { onEvent, markHttpStart, markHttpEnd }) {
  const started = performance.now();
  const steps = [];
  const streams = []; // [{label, engine}] —— 卡片内嵌直播
  let aborted = false;

  const poke = () => onEvent({ steps: [...steps], streams: [...streams] });
  const unsubLog = onRequestLogChange(poke);

  const t = {
    info: (msg) => {
      const cur = steps[steps.length - 1];
      if (cur) (cur.info = cur.info || []).push(msg);
      poke();
    },
    expect: (cond, msg) => {
      if (!cond) throw new Error(msg);
    },
    /** 发起一轮对话并等终态；引擎注册进卡片直播区。
     * 注意:不在这里关 events 流——异步委派的消费轮在主轮 done 之后
     * 才发生,帧要继续流入引擎。流在整个用例结束时统一关闭(见
     * runCase 的 finally)。
     */
    chat: async (label, starter, timeoutMs) => {
      const eng = createRunEngine();
      streams.push({ label, engine: eng });
      poke();
      const unsub = eng.subscribe(poke);
      try {
        // 步骤的完成判据是 RUN 终态（waiting-human 也算可推进——TS 的
        // HITL 是轮内挂起，onetake 流在挂起期间不关（Rust 以
        // waiting_human 轮终态关流）；await starter 会等到流关闭才返回，
        // 在 TS 语义下等于等 respond 完成——步骤卡死。starter 发起即
        // 返回，终态交给 waitTerminal；传输层错误经 responseError →
        // error 终态同样收敛。
        void Promise.resolve(starter(eng)).catch(() => {
          /* 传输错误已进引擎 responseError */
        });
        await waitTerminal(eng, timeoutMs);
        return eng;
      } finally {
        unsub();
        poke();
      }
    },
    step: async (name, fn, opts = {}) => {
      if (aborted) {
        steps.push({ name, status: 'skipped' });
        poke();
        return undefined;
      }
      const entry = { name, status: 'running' };
      steps.push(entry);
      poke();
      try {
        const r = await fn();
        entry.status = 'pass';
        poke();
        return r;
      } catch (e) {
        entry.status = opts.optional ? 'warn' : 'fail';
        entry.detail = String((e && e.message) || e);
        poke();
        if (!opts.optional) {
          aborted = true;
          throw e;
        }
        return undefined;
      }
    },
  };

  markHttpStart();
  try {
    await Promise.race([
      def.run(t),
      new Promise((_, rej) =>
        setTimeout(() => rej(new Error(`用例超时（>${CASE_TIMEOUT_MS / 1000}s）`)), CASE_TIMEOUT_MS)
      ),
    ]);
    return {
      status: 'pass',
      steps,
      streams,
      durationMs: Math.round(performance.now() - started),
      httpEnd: markHttpEnd(),
    };
  } catch (e) {
    return {
      status: 'fail',
      error: String((e && e.message) || e),
      steps,
      streams,
      durationMs: Math.round(performance.now() - started),
      httpEnd: markHttpEnd(),
    };
  } finally {
    // 用例结束统一释放全部在途连接——events 流 + onetake 请求流（reset
    // 会 abort 在途 POST/流并 closeEvents）。用例内保持连接(异步委派的
    // 消费轮在主轮 done 之后才发生),用例间释放:TS 的 HITL 轮内挂起时
    // 服务器不关 onetake 流(Rust 以 waiting_human 轮终态关流),不主动
    // abort 会泄漏连接——同源 6 条上限下后续用例全体排队"卡死"。
    for (const { engine } of streams) {
      try {
        engine.reset();
      } catch {
        /* already reset */
      }
    }
    unsubLog();
  }
}

// ── 卡片子组件 ──────────────────────────────────────────────────────────────

function StepRow({ step }) {
  const icon = { pass: '✓', fail: '✗', running: '…', warn: '⚠' }[step.status] || '-';
  const color =
    { pass: 'var(--success)', fail: 'var(--error)', warn: 'var(--warning)' }[step.status] ||
    'var(--text-faint)';
  return html`
    <div class="e2e-step">
      <span class="mono" style=${{ color, width: '16px', flexShrink: 0 }}>${icon}</span>
      <span style=${{ flexShrink: 0 }}>${step.name}</span>
      ${step.detail &&
      html`<span class="mono small" style="color:var(--error);word-break:break-all"
        >${step.detail}</span
      >`}
      ${(step.info || []).map(
        (m, i) =>
          html`<span class="mono small dim" key=${i} style="word-break:break-all">ℹ ${m}</span>`
      )}
    </div>
  `;
}

function HttpRow({ entry }) {
  const [open, setOpen] = useState(false);
  const statusCls = !entry.status ? 'st-net' : entry.status >= 400 ? 'st-4xx' : 'st-2xx';
  return html`
    <div
      class="ev-row ${open ? 'open' : ''}"
      style="cursor:pointer"
      onClick=${() => setOpen(!open)}
    >
      <div class="ev-head">
        <span class="method m-${entry.method}">${entry.method}</span>
        <span
          class="mono"
          style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;direction:rtl;text-align:left"
          >${entry.path}</span
        >
        <span class="status ${statusCls}">${entry.status || '…'}</span>
        ${entry.durationMs !== null &&
        html`<span class="dim small mono">${entry.durationMs}ms</span>`}
      </div>
      ${open &&
      html`
        <div class="ev-detail">
          <div class="dim small mono">请求体</div>
          ${entry.requestBody !== undefined && entry.requestBody !== null
            ? typeof entry.requestBody === 'object'
              ? html`<${JsonTree} data=${entry.requestBody} open=${2} />`
              : html`<pre>${String(entry.requestBody)}</pre>`
            : html`<div class="dim small">（无）</div>`}
          <div class="dim small mono" style="margin-top:6px">响应体</div>
          ${entry.responseBody !== undefined && entry.responseBody !== null
            ? typeof entry.responseBody === 'object'
              ? html`<${JsonTree} data=${entry.responseBody} open=${2} />`
              : html`<pre>${String(entry.responseBody).slice(0, 4000)}</pre>`
            : html`<div class="dim small">（无）</div>`}
        </div>
      `}
    </div>
  `;
}

function CaseCard({ def, result, onRun, disabled }) {
  const status = result ? result.status : 'pending';
  const [collapsed, setCollapsed] = useState(false);
  const open = result && (status === 'running' || !collapsed);
  const httpEntries =
    result && result.httpStart !== undefined
      ? requestLog.slice(result.httpStart, result.httpEnd ?? undefined)
      : [];
  const badge = { pass: 'tag-ok', fail: 'tag-warn' }[status] || '';
  return html`
    <div class="panel e2e-case ${status === 'fail' ? 'is-error' : ''}">
      <div class="panel-header">
        <span class="panel-title">${def.name}</span>
        ${def.needsLlm && html`<span class="tag tag-warn">需 LLM</span>`}
        <span class="tag ${badge}">${STATUS_LABELS[status]}</span>
        ${result &&
        result.durationMs !== undefined &&
        html`<span class="dim small mono">${result.durationMs}ms</span>`}
        <span class="spacer" style="flex:1" />
        ${result &&
        result.status !== 'running' &&
        result.status !== 'pending' &&
        html`
          <button class="btn btn-sm" onClick=${() => setCollapsed(!collapsed)}>
            ${collapsed ? '展开过程' : '收起过程'}
          </button>
        `}
        <button class="btn btn-sm" disabled=${disabled || status === 'running'} onClick=${onRun}>
          ${status === 'running' ? '运行中…' : '单跑'}
        </button>
      </div>
      <div class="dim small" style="margin-bottom:6px">${def.story}</div>
      ${result && result.reason && html`<div class="note-banner">${result.reason}</div>`}
      ${result && result.error && html`<div class="error-banner">${result.error}</div>`}
      ${open &&
      html`
        <div class="e2e-steps">
          ${result.steps.map((s, i) => html`<${StepRow} key=${i} step=${s} />`)}
        </div>
        ${(result.streams || []).map(
          (s, i) => html`
            <div key=${i} style="margin-top:10px">
              <div class="detail-label dim small" style="margin-bottom:4px">
                SSE · ${s.label}（${s.engine.state.frames.length} 帧）
              </div>
              <${EventStream} frames=${s.engine.state.frames} height="220px" />
            </div>
          `
        )}
        ${httpEntries.length > 0 &&
        html`
          <div style="margin-top:10px">
            <div class="detail-label dim small" style="margin-bottom:4px">
              HTTP 调用（${httpEntries.length} 个，点击展开请求/响应）
            </div>
            <div class="event-stream">
              ${httpEntries.map((e) => html`<${HttpRow} key=${e.id} entry=${e} />`)}
            </div>
          </div>
        `}
      `}
    </div>
  `;
}

// ── 页面 ────────────────────────────────────────────────────────────────────

export function E2EPage() {
  const [results, setResults] = useState({});
  const [hasLlm, setHasLlm] = useState(null);
  const [running, setRunning] = useState(false);

  useEffect(() => {
    detectLlm().then(setHasLlm);
  }, []);

  async function execute(defs) {
    setRunning(true);
    try {
      for (const def of defs) {
        setResults((prev) => ({
          ...prev,
          [def.id]: { status: 'running', steps: [], streams: [] },
        }));
        let httpStart = null;
        const markStart = () => {
          httpStart = requestLog.length;
        };
        const markEnd = () => requestLog.length;
        const r = await runCase(def, {
          onEvent: (ev) =>
            setResults((prev) => ({
              ...prev,
              [def.id]: { status: 'running', httpStart, ...ev },
            })),
          markHttpStart: markStart,
          markHttpEnd: markEnd,
        });
        setResults((prev) => ({ ...prev, [def.id]: { ...r, httpStart } }));
      }
    } finally {
      setRunning(false);
    }
  }

  const storyDefs = hasLlm ? STORY_CASES : [];
  const counts = [...STORY_CASES, ...INFRA_CASES].reduce((acc, c) => {
    const s = results[c.id] ? results[c.id].status : 'pending';
    acc[s] = (acc[s] || 0) + 1;
    return acc;
  }, {});

  return html`
    <div class="page">
      <div class="page-header">
        <div class="page-title">自动测试 · 端到端用户故事</div>
        <div class="page-desc">
          用户故事组是多环节闭环（真实对话、工具落盘、跨会话、HITL、多模态）；基础设施组是管线健全性。运行时每个用例卡实时展示步骤、SSE
          事件流与全部 HTTP 调用。
        </div>
      </div>
      <div class="toolbar">
        <button
          class="btn btn-primary"
          disabled=${running}
          onClick=${() => execute([...storyDefs, ...INFRA_CASES])}
        >
          ${running ? '运行中…' : '▶ 全部运行'}
        </button>
        <button class="btn" disabled=${running} onClick=${() => execute(INFRA_CASES)}>
          只跑基础设施
        </button>
        <span class="spacer" />
        ${hasLlm !== null &&
        html`<span class="tag ${hasLlm ? 'tag-ok' : 'tag-warn'}"
          >LLM ${hasLlm ? '已配置' : '未配置'}</span
        >`}
        ${counts.pass ? html`<span class="tag tag-ok">通过 ${counts.pass}</span>` : ''}
        ${counts.fail ? html`<span class="tag tag-warn">失败 ${counts.fail}</span>` : ''}
        ${counts.running ? html`<span class="tag">运行中 ${counts.running}</span>` : ''}
      </div>
      <div class="dim small" style="margin-bottom:10px">
        产物带 e2e- 前缀、工作区固定 /tmp/wrangler-e2e，失败也尽量清理；spec/plan
        无删除端点，其产物留在工作区。故事组会消耗真实 token。
      </div>

      <div class="detail-label dim" style="margin:6px 0">
        用户故事（${STORY_CASES.length} 个${hasLlm ? '' : '，未配置 LLM 时不可跑'}）
      </div>
      ${STORY_CASES.map(
        (def) => html`
          <${CaseCard}
            key=${def.id}
            def=${def}
            result=${results[def.id]}
            disabled=${running}
            onRun=${() => execute([def])}
          />
        `
      )}

      <div class="detail-label dim" style="margin:14px 0 6px">
        基础设施（${INFRA_CASES.length} 个，无需 LLM）
      </div>
      ${INFRA_CASES.map(
        (def) => html`
          <${CaseCard}
            key=${def.id}
            def=${def}
            result=${results[def.id]}
            disabled=${running}
            onRun=${() => execute([def])}
          />
        `
      )}
    </div>
  `;
}

export default E2EPage;
