/**
 * CrewLab —— crew 协作观察页。三件套：
 *   结构图（运行前）：主 agent / workers / 私有 skills / MCP，跑之前
 *                    就知道这个 crew 是怎么搭的；
 *   交接序列（运行中）：你 → primary ⇄ worker ⇄ primary → 完成，
 *                    谁在什么时候接手一目了然；
 *   泳道视图（运行中）：每个 agent 一列，按时间排活动卡——primary 列
 *                    是消息/思考/delegate 调用，worker 列是被委派的
 *                    任务、流式输出与最终答案（含耗时）。
 * 复用 run-engine 与 EventStream；与 RunLab 的区别：这里是"看协作结构"，
 * RunLab 是"看请求与事件契约"。
 */
import { html, useState, useEffect, useRef } from '../utils.js';
import { api } from '../api.js';
import { createRunEngine } from '../helpers/runEngine.js';
import { EventStream } from '../components/EventStream.js';

// api 门面适配（Rust 版 api.js 的具名助手 → TS 版通用 REST 风格）
function listCrews() {
  return api.get('/api/crews').then(function (r) {
    var list = (r && (r.crews || r.list)) || [];
    return Array.isArray(list) ? list : [];
  });
}
function getCrew(id) {
  return api.get('/api/crews/' + encodeURIComponent(id));
}
function listAgents() {
  return api.get('/api/agents').then(function (r) {
    var list = (r && (r.agents || r.list)) || [];
    return Array.isArray(list) ? list : [];
  });
}
function listSessions() {
  return api.get('/api/sessions').then(function (r) {
    var list = (r && (r.sessions || r.list)) || [];
    return Array.isArray(list) ? list : [];
  });
}
function chatDiagnostics(sid) {
  return api.get('/api/chat/' + encodeURIComponent(sid));
}

/** 委托配色板：第 n 次委托取第 n 色，循环。 */
const DELEG_COLORS = [
  '#6cb2ff', '#4bd07a', '#e3b341', '#b78cf2',
  '#56d4c8', '#ff8a7a', '#9acd32', '#f06bb3',
];

/**
 * 单遍扫描 items，给委托链配色。颜色按 worker 【名字】分配——不同
 * worker 不同色（一眼区分 researcher 和 writer）；同名多次被委派保持
 * 同色、以序号区分（delegate 卡与其 sub 运行卡按名字计数锁步配对：
 * delegate 卡总在其 sub 之前到达，assign/read 两个计数器同步递增）。
 */
function decorate(items) {
  const nameColor = {};  // name -> 专属色（首次见到该名字时从色板领取）
  let colorCursor = 0;
  const colorOf = (name) =>
    (nameColor[name] ??= DELEG_COLORS[colorCursor++ % DELEG_COLORS.length]);
  const assign = {};   // name -> 已发生的委派次数（delegate 卡侧）
  const read = {};     // name -> 已配对的运行次数（sub 卡侧）
  const primaryDeco = [];
  const subDeco = [];
  for (const it of items) {
    if (it.kind === 'tool' && /delegate/i.test(it.name || '')) {
      const target = it.args && (it.args.agent || it.args.subagent || it.args.name);
      const name = typeof target === 'string' ? target : (target && target.name) || '';
      const occ = (assign[name] = (assign[name] ?? 0) + 1);
      // 首次委派不带后缀（最常见情形零噪音），重复委派一律 #n。
      primaryDeco.push({ item: it, color: name ? colorOf(name) : null, target: occ > 1 ? `${name} #${occ}` : name });
    } else if (it.kind === 'sub') {
      const occ = (read[it.name] = (read[it.name] ?? 0) + 1);
      subDeco.push({ item: it, color: colorOf(it.name), occ });
    } else {
      primaryDeco.push({ item: it, color: null, target: '' });
    }
  }
  return { primaryDeco, subDeco, firstColor: nameColor };
}

function colorStyle(color) {
  return color ? { borderLeft: `4px solid ${color}`, background: `${color}1a` } : undefined;
}

function fmtDur(ms) {
  if (ms === null || ms === undefined) return '…';
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

/** 交接序列：把关键节点抽成一条链；worker 芯片用它首次委派的颜色。 */
function HandoffStrip({ items, firstColor }) {
  const chips = [];
  for (const it of items) {
    if (it.kind === 'user') chips.push({ t: '你', cls: 'ho-user', color: null });
    else if (it.kind === 'sub') chips.push({ t: `⇄ ${it.name}${it.done ? ' ✓' : ''}`, cls: 'ho-worker', color: firstColor[it.name] || null });
    else if (it.kind === 'hitl-mark') chips.push({ t: '⏸ 等人', cls: 'ho-hitl', color: null });
  }
  if (chips.length === 0) return null;
  return html`
    <div class="handoff">
      <span class="handoff-chip ho-primary">primary</span>
      ${chips.map((c, i) => html`
        <span key=${i} class="handoff-arrow">→</span>
        <span key=${c.t + i} class="handoff-chip ${c.cls}" style=${c.color ? { borderColor: c.color, color: c.color } : undefined}>${c.t}</span>
      `)}
    </div>
  `;
}

/** primary 泳道的活动卡（复用 RunLab 的卡片语义，紧凑版）。 */
function PrimaryCard({ item, color, target }) {
  switch (item.kind) {
    case 'user': return html`<div class="lane-card lc-user">${item.text}</div>`;
    case 'assistant': return html`<div class="lane-card lc-answer">${item.text || '…'}</div>`;
    case 'thinking': return html`<div class="lane-card lc-think">💭 ${item.text.slice(0, 160)}${item.text.length > 160 ? '…' : ''}</div>`;
    case 'tool':
      if (/delegate/i.test(item.name)) {
        return html`<div class="lane-card lc-delegate" style=${colorStyle(color)}>📤 delegate → <b>${target || '?'}</b>${item.done ? '' : ' …'}</div>`;
      }
      return html`<div class="lane-card lc-tool">🛠 ${item.name} ${item.done ? '✓' : '…'}</div>`;
    case 'hitl-mark': return html`<div class="lane-card lc-hitl">⏸ 等待人工输入</div>`;
    case 'error': return html`<div class="lane-card lc-error">✗ ${item.message}</div>`;
    default: return null;
  }
}

/** worker 泳道的活动卡（用对应委托的颜色）。 */
function WorkerCard({ item, color, occ }) {
  const dur = item.endedAt && item.startedAt ? item.endedAt - item.startedAt : null;
  return html`
    <div class="lane-card lc-worker ${item.done ? '' : 'running'}" style=${colorStyle(color)}>
      <div class="lane-card-head">
        <b>${occ > 1 ? `${item.name} #${occ}` : item.name}</b>
        <span class="dim small">${item.done ? `✓ ${fmtDur(dur)}` : '运行中…'}</span>
      </div>
      ${item.task && html`<div class="dim small" style="margin:2px 0">任务：${String(item.task).slice(0, 140)}</div>`}
      ${item.text && html`<div class="lane-card-body">${item.text}</div>`}
      ${item.answer && html`<div class="lane-card-body" style="border-top:1px dashed var(--border);margin-top:4px;padding-top:4px">↩ ${String(item.answer).slice(0, 400)}</div>`}
      ${item.error && html`<div class="lc-error">${String(item.error)}</div>`}
      ${item.events && item.events.length > 0 && html`<div class="faint small">${item.events.length} 次内部调用（见原始帧）</div>`}
    </div>
  `;
}

export function CrewLabPage() {
  const engineRef = useRef(null);
  if (!engineRef.current) engineRef.current = createRunEngine();
  const eng = engineRef.current;
  const st = eng.state;

  const [, force] = useState(0);
  useEffect(() => {
    let queued = false;
    const unsub = eng.subscribe(() => {
      if (queued) return;
      queued = true;
      requestAnimationFrame(() => { queued = false; force((n) => n + 1); });
    });
    return unsub;
  }, []);

  const [crews, setCrews] = useState([]);
  const [detail, setDetail] = useState(null);
  const [crewId, setCrewId] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [showRaw, setShowRaw] = useState(false);

  function loadCrews() {
    listCrews().then(setCrews).catch(() => {});
  }
  useEffect(loadCrews, []);

  useEffect(() => {
    if (!crewId.trim()) { setDetail(null); return; }
    getCrew(crewId.trim()).then(setDetail).catch((e) => { setDetail(null); setError(e.message); });
  }, [crewId]);

  function run() {
    setError('');
    if (!crewId.trim()) { setError('先选一个 crew'); return; }
    if (!message.trim()) { setError('消息不能为空'); return; }
    eng.startCrewChat(crewId.trim(), {
      message: message.trim(),
      workspacePath: '/tmp/crew-lab',
    });
  }

  const workers = detail ? (detail.agents || []).filter((a) => a !== detail.primaryAgent) : [];
  const running = st.status === 'running' || st.status === 'waiting-human';
  // 委托配色：delegate 卡与对应 sub 运行卡同色（见 decorate 的配对法）
  const { primaryDeco, subDeco, firstColor } = decorate(st.items);
  // worker 泳道按出现的 agent 分组（保持首现顺序，带首色点）
  const laneOrder = [];
  for (const d of subDeco) if (!laneOrder.includes(d.item.name)) laneOrder.push(d.item.name);
  const lanes = [
    { name: detail ? `${detail.primaryAgent}（主）` : 'primary（主）', wide: true, deco: primaryDeco, color: null },
    ...laneOrder.map((n) => ({ name: n, wide: false, deco: subDeco.filter((d) => d.item.name === n), color: firstColor[n] || null })),
  ];

  return html`
    <div class="page">
      <div class="page-header">
        <div class="page-title">CrewLab · 协作观察</div>
        <div class="page-desc">选一个 crew，看主 agent 怎么把活分给子 agent、子 agent 怎么交回——结构图、交接序列、泳道三件套。与 RunLab 的分工：这里看协作结构，RunLab 看请求与事件契约。</div>
      </div>

      <div class="panel">
        <div class="console-form">
          <div class="field" style="flex:2;min-width:220px">
            <label>crew ${crews.length ? `（${crews.length} 个）` : ''}</label>
            <select class="input" value=${crewId} onChange=${(e) => setCrewId(e.target.value)}>
              <option value="">— 选择 —</option>
              ${crews.map((c) => html`<option key=${c.id} value=${c.id}>${c.id}（主：${c.primaryAgent}）</option>`)}
            </select>
          </div>
          <div class="field" style="flex:3;min-width:260px">
            <label>消息 *</label>
            <input class="input" value=${message} placeholder="比如：请让 researcher 算 17*23，再让 writer 总结"
                   onInput=${(e) => setMessage(e.target.value)}
                   onKeyDown=${(e) => { if (e.key === 'Enter' && !running) run(); }} />
          </div>
          <button class="btn btn-primary" style="margin-bottom:2px" disabled=${running} onClick=${run}>${running ? '运行中…' : '▶ 运行'}</button>
          <button class="btn" style="margin-bottom:2px" disabled=${!running} onClick=${() => eng.stop()}>停止</button>
          <button class="btn" style="margin-bottom:2px" onClick=${() => { eng.reset(); setMessage(''); }}>重置</button>
        </div>
        ${error && html`<div class="error-banner">${error}</div>`}
      </div>

      ${detail && html`
        <div class="panel">
          <div class="panel-header"><span class="panel-title">结构 · ${detail.id}</span></div>
          <div class="crew-structure">
            <div class="crew-node cn-primary">
              <div class="crew-node-role">主 agent</div>
              <div class="crew-node-name">${detail.primaryAgent}</div>
            </div>
            ${workers.length > 0 && html`<div class="crew-structure-links">↓ 可委派 ${workers.length} 个</div>`}
            <div class="crew-structure-row">
              ${workers.map((w) => html`
                <div key=${w} class="crew-node cn-worker">
                  <div class="crew-node-role">worker</div>
                  <div class="crew-node-name">${w}</div>
                </div>
              `)}
              ${workers.length === 0 && html`<div class="dim small">没有 worker——这个 crew 只有主 agent 单干。</div>`}
            </div>
          </div>
          <div class="dim small" style="margin-top:8px">
            私有 skills：${(detail.skills || []).map((s) => s.replace(/.*\//, '')).join('、') || '（无）'}
            · MCP：${(detail.mcpPaths || []).length ? 'mcp.json' : '（无）'}
            · 正文任务书：${(detail.body || '（空）').slice(0, 80)}…
          </div>
        </div>
      `}

      ${st.items.length > 0 && html`
        <div class="panel">
          <div class="run-status-line">
            <span class="run-dot ${st.status === 'running' ? 'running' : st.status === 'waiting-human' ? 'waiting' : ''}"></span>
            <span>${st.status}</span>
            ${st.sessionId && html`<span>会话 <span class="mono">${st.sessionId.slice(0, 8)}…</span></span>`}
            ${st.doneInfo && html`<span>步数 ${st.doneInfo.totalSteps ?? '—'}</span>`}
            <span class="spacer" style="flex:1" />
            <button class="btn btn-sm" onClick=${() => setShowRaw(!showRaw)}>${showRaw ? '收起原始帧' : `原始帧（${st.frames.length}）`}</button>
          </div>
          <${HandoffStrip} items=${st.items} firstColor=${firstColor} />
          <div class="crew-lanes">
            ${lanes.map((lane) => html`
              <div key=${lane.name} class="crew-lane ${lane.wide ? 'wide' : ''}">
                <div class="crew-lane-title">
                  ${lane.color && html`<span class="lane-dot" style=${{ background: lane.color }} />`}
                  ${lane.name}
                </div>
                ${lane.deco.map((d, i) => (lane.wide
                  ? html`<${PrimaryCard} key=${i} item=${d.item} color=${d.color} target=${d.target || ''} />`
                  : html`<${WorkerCard} key=${i} item=${d.item} color=${d.color} occ=${d.occ} />`))}
                ${lane.deco.length === 0 && html`<div class="dim small" style="padding:6px 0">（未参与）</div>`}
              </div>
            `)}
          </div>
          ${showRaw && html`<${EventStream} frames=${st.frames} height="300px" />`}
        </div>
      `}
    </div>
  `;
}

export default CrewLabPage;
