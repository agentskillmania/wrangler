/**
 * RunLab —— 引擎驾驶舱。先组装 ChatRequest（发送前可预览将发出的完整
 * 请求体），跑 agent/crew/resume 三种入口，然后以三种方式观察结果：
 *   渲染视图 —— 归约后的对话视图（正文/思考/工具/子代理/HITL）
 *   原始帧   —— 每一帧 SSE 原样呈现（EventStream）
 *   相位     —— phase-change 序列
 * HITL 中断就地作答；/respond 的响应本身就是续跑流。
 */
import { html, useState, useEffect, useRef } from '../utils.js';
import { api } from '../api.js';
import { createRunEngine } from '../helpers/runEngine.js';
import { EventStream } from '../components/EventStream.js';
import { JsonTree } from '../components/JsonTree.js';

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

// ── 消息渲染 ────────────────────────────────────────────────────────────────

function ToolMsg({ item }) {
  const [showDetail, setShowDetail] = useState(false);
  return html`
    <div class="msg msg-tool">
      <div class="msg-meta">🛠 ${item.name} ${item.done ? '· ✓' : '· 运行中'}</div>
      <div class="msg-body">${JSON.stringify(item.args, null, 2)}</div>
      ${item.result !== null && item.result !== undefined && html`
        <div>
          <button class="btn btn-sm" onClick=${() => setShowDetail(!showDetail)}>${showDetail ? '收起结果' : '结果'}</button>
          ${showDetail && html`<pre class="msg-body" style="margin-top:6px">${String(item.result)}</pre>`}
        </div>
      `}
    </div>
  `;
}

function SubMsg({ item }) {
  return html`
    <div class="msg msg-sub">
      <div class="msg-meta">⑂ ${item.name} · ${item.done ? (item.status || '完成') : '运行中'}${item.error ? ' · 出错' : ''}</div>
      ${item.task && html`<div class="dim small">任务：${String(item.task).slice(0, 200)}</div>`}
      ${item.text && html`<div class="msg-body">${item.text}</div>`}
      ${item.done && item.answer && html`<div class="msg-body" style="border-top:1px dashed var(--border);margin-top:6px;padding-top:6px">最终回答：${String(item.answer)}</div>`}
      ${item.error && html`<div class="msg-meta" style="color:var(--error)">${String(item.error)}</div>`}
      ${item.events && item.events.length > 0 && html`<div class="dim small">${item.events.length} 条内部事件（见原始帧视图）</div>`}
    </div>
  `;
}

function HitlCard({ interrupt, onRespond }) {
  const [answers, setAnswers] = useState(() => (interrupt.questions || []).map(() => ''));
  const [rawMode, setRawMode] = useState(false);
  const [rawText, setRawText] = useState('');
  const [custom, setCustom] = useState('');

  const isConfirm = !!interrupt.confirm;
  const questions = interrupt.questions || [];

  const sendQuestion = () => {
    if (rawMode) {
      try { onRespond(JSON.parse(rawText)); } catch { /* JSON 非法时不发送 */ }
    } else {
      onRespond(questions.length === 1 ? answers[0] : answers);
    }
  };
  const sendConfirm = (approved) => onRespond({ approved });

  return html`
    <div class="hitl-card">
      <div class="msg-meta">⏸ 等待人工输入 · requestId=${interrupt.requestId}</div>
      ${isConfirm ? html`
        <div class="hitl-q">
          <div class="hitl-q-label">确认执行工具</div>
          <pre class="msg-body">${interrupt.confirm.toolName}
${JSON.stringify(interrupt.confirm.arguments, null, 2)}</pre>
        </div>
        <div style="display:flex;gap:8px;margin-top:8px;align-items:center">
          <button class="btn btn-primary btn-sm" onClick=${() => sendConfirm(true)}>批准</button>
          <button class="btn btn-danger btn-sm" onClick=${() => sendConfirm(false)}>拒绝</button>
        </div>
      ` : html`
        ${questions.map((q, i) => html`
          <div class="hitl-q" key=${i}>
            <div class="hitl-q-label">${q && typeof q === 'object' ? (q.question || q.id || JSON.stringify(q)) : String(q)}</div>
            <input class="input" value=${answers[i] || ''}
                   onInput=${(e) => { const next = answers.slice(); next[i] = e.target.value; setAnswers(next); }} />
          </div>
        `)}
        <div style="display:flex;gap:8px;margin-top:8px;align-items:center;flex-wrap:wrap">
          <button class="btn btn-primary btn-sm" onClick=${sendQuestion}>提交回答</button>
          <label class="small dim" style="display:flex;gap:4px;align-items:center;cursor:pointer">
            <input type="checkbox" checked=${rawMode} onChange=${(e) => setRawMode(e.target.checked)} /> 原始 JSON
          </label>
          ${rawMode && html`<textarea class="input mono" style="flex:1;min-width:200px" rows="2" value=${rawText}
              onInput=${(e) => setRawText(e.target.value)} placeholder='{"任意":"形状"} —— 会原样透传给 daemon'></textarea>`}
        </div>
      `}
      ${interrupt.context && html`<div class="dim small" style="margin-top:6px">上下文：${JSON.stringify(interrupt.context).slice(0, 300)}</div>`}
    </div>
  `;
}

function RenderedItems({ items }) {
  return html`
    <div class="chat-view">
      ${items.map((item, i) => {
        switch (item.kind) {
          case 'user': return html`<div key=${i} class="msg msg-user">${item.text}</div>`;
          case 'assistant': return html`<div key=${i} class="msg msg-assistant">${item.text || '…'}</div>`;
          case 'thinking': return html`<div key=${i} class="msg msg-thinking"><div class="msg-meta">思考</div>${item.text}</div>`;
          case 'tool': return html`<${ToolMsg} key=${i} item=${item} />`;
          case 'sub': return html`<${SubMsg} key=${i} item=${item} />`;
          case 'error': return html`
            <div key=${i} class="msg msg-error">
              <div class="msg-meta">错误${item.step !== undefined ? ` · 第 ${item.step} 步` : ''}${item.toolName ? ` · ${item.toolName}` : ''}</div>
              ${item.message}
            </div>`;
          case 'abort': return html`<div key=${i} class="msg msg-error dim">⏹ 已中止 · 第 ${item.step}/${item.totalSteps} 步</div>`;
          case 'compressed': return html`
            <div key=${i} class="msg msg-thinking">
              <div class="msg-meta">已压缩 · 移除 ${item.removedCount} 条消息</div>
              ${item.summary || ''}
            </div>`;
          case 'hitl-mark': return html`<div key=${i} class="dim small" style="text-align:center">── ⏸ 等待人工输入 ──</div>`;
          default: return null;
        }
      })}
    </div>
  `;
}

// ── 页面 ────────────────────────────────────────────────────────────────────

function parseJsonOr(text, fallback) {
  const t = (text || '').trim();
  if (!t) return fallback;
  return { ok: true, value: JSON.parse(t) };
}

export function RunLabPage() {
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
    // 卸载时关掉常驻 events 流——否则连接随引擎对象泄漏,同源 6 连接
    // 上限会让第 7 条常驻流排队挂起。
    return () => { unsub(); eng.closeEvents(); };
  }, []);

  // 请求配置
  const [mode, setMode] = useState('agent-chat');
  const [agents, setAgents] = useState([]);
  const [crews, setCrews] = useState([]);
  const [agentName, setAgentName] = useState('');
  const [inlineAgent, setInlineAgent] = useState(false);
  const [inlineInstructions, setInlineInstructions] = useState('');
  const [crewId, setCrewId] = useState('');
  const [resumeId, setResumeId] = useState('');
  const [message, setMessage] = useState('');
  const [workspacePath, setWorkspacePath] = useState('');
  const [model, setModel] = useState('');
  const [thinking, setThinking] = useState(false);
  const [configJson, setConfigJson] = useState('');
  const [attachmentsJson, setAttachmentsJson] = useState('');
  const [formError, setFormError] = useState('');
  const [view, setView] = useState('rendered');
  const [followUp, setFollowUp] = useState('');
  const [keepTurns, setKeepTurns] = useState('2');

  useEffect(() => {
    listAgents().then(setAgents).catch(() => {});
    listCrews().then(setCrews).catch(() => {});
  }, []);

  function buildBody() {
    const body = { message: message.trim() };
    if (mode === 'agent-chat') {
      if (inlineAgent) body.agent = { instructions: inlineInstructions };
      if (workspacePath.trim()) body.workspacePath = workspacePath.trim();
    } else if (mode === 'crew-chat') {
      body.workspacePath = workspacePath.trim();
    }
    if (model.trim()) body.model = model.trim();
    body.thinkingEnabled = thinking;
    const cfg = parseJsonOr(configJson, null);
    if (cfg) body.config = cfg;
    const att = parseJsonOr(attachmentsJson, null);
    if (att) body.attachments = att;
    return body;
  }

  let bodyPreview = null;
  let bodyError = '';
  try { bodyPreview = buildBody(); } catch (e) { bodyError = e.message; }

  function send() {
    setFormError('');
    if (bodyError) { setFormError('请求 JSON 非法：' + bodyError); return; }
    if (!message.trim()) { setFormError('消息不能为空'); return; }
    const body = buildBody();
    if (mode === 'agent-chat') {
      const name = inlineAgent ? 'inline' : agentName.trim();
      if (!name) { setFormError('需要填 agent 名（或勾选内联 agent）'); return; }
      eng.startAgentChat(name, body);
    } else if (mode === 'crew-chat') {
      if (!crewId.trim()) { setFormError('需要填 crew id'); return; }
      if (!body.workspacePath) { setFormError('crew 对话必须带 workspacePath'); return; }
      eng.startCrewChat(crewId.trim(), body);
    } else {
      if (!resumeId.trim()) { setFormError('需要填会话 id'); return; }
      delete body.workspacePath; // resume 忽略它
      eng.resume(resumeId.trim(), body);
    }
    setFollowUp('');
  }

  function sendFollowUp() {
    if (!followUp.trim() || !st.sessionId) return;
    const body = buildBody();
    body.message = followUp.trim();
    setFollowUp('');
    eng.resume(st.sessionId, body);
  }

  const running = st.status === 'running' || st.status === 'waiting-human';
  const dotClass = st.status === 'running' ? 'running'
    : st.status === 'waiting-human' ? 'waiting'
    : (st.status === 'error' ? 'error' : '');

  const STATUS_LABELS = {
    'idle': '空闲', 'running': '运行中', 'waiting-human': '等待人工输入',
    'done': '已完成', 'error': '出错', 'aborted': '已中止', 'max-steps': '步数上限',
  };
  const phaseChips = st.phases.map((p) => p.to && p.to.type);
  const currentPhase = phaseChips.length ? phaseChips[phaseChips.length - 1] : null;
  const VIEW_LABELS = { rendered: '渲染视图', raw: '原始帧', phases: '相位' };

  return html`
    <div class="page">
      <div class="page-header">
        <div class="page-title">RunLab · 运行实验</div>
        <div class="page-desc">组装确切的 ChatRequest 并运行，然后观察每一帧。agent/crew/resume/respond 共用一个引擎——你看到的就是 daemon 和底层 wrangler 实际做的事。</div>
      </div>
      <div class="runlab-layout">
        <div class="runlab-config">
          <div class="panel">
            <div class="panel-header"><span class="panel-title">请求</span></div>
            <div class="field">
              <label>入口</label>
              <select class="input" value=${mode} onChange=${(e) => setMode(e.target.value)}>
                <option value="agent-chat">POST /api/agents/:name/onetake（一次性问答）</option>
                <option value="crew-chat">POST /api/chat/:id + {crew}（crew 会话,ack + events）</option>
                <option value="resume">POST /api/chat/:session_id（发消息,ack + events）</option>
              </select>
            </div>
            ${mode === 'agent-chat' && html`
              <div class="field">
                <label>agent 名 ${agents.length ? `（已定义 ${agents.length} 个）` : ''}</label>
                <input class="input mono" list="agent-list" value=${agentName}
                       onInput=${(e) => setAgentName(e.target.value)} placeholder="agent" />
                <datalist id="agent-list">
                  ${agents.map((a) => html`<option key=${a.id} value=${a.id} />`)}
                </datalist>
                <label style="display:flex;gap:6px;align-items:center;margin-top:6px;cursor:pointer">
                  <input type="checkbox" checked=${inlineAgent} onChange=${(e) => setInlineAgent(e.target.checked)} />
                  内联 agent（body.agent —— daemon 将不读 agents/*.md）
                </label>
              </div>
              ${inlineAgent && html`
                <div class="field">
                  <label>内联 instructions</label>
                  <textarea class="input mono" rows="3" value=${inlineInstructions}
                            onInput=${(e) => setInlineInstructions(e.target.value)}
                            placeholder="You are a helpful assistant."></textarea>
                </div>
              `}
            `}
            ${mode === 'crew-chat' && html`
              <div class="field">
                <label>crew id ${crews.length ? `（已定义 ${crews.length} 个）` : ''}</label>
                <input class="input mono" list="crew-list" value=${crewId}
                       onInput=${(e) => setCrewId(e.target.value)} placeholder="my-crew" />
                <datalist id="crew-list">
                  ${crews.map((c) => html`<option key=${c.id} value=${c.id} />`)}
                </datalist>
                <div class="dim small" style="margin-top:4px">crew 对话读的是目录式布局（<id>/CREW.md）</div>
              </div>
            `}
            ${mode === 'resume' && html`
              <div class="field">
                <label>会话 id</label>
                <input class="input mono" value=${resumeId}
                       onInput=${(e) => setResumeId(e.target.value)} placeholder="ULID / uuid" />
              </div>
            `}
            <div class="field">
              <label>消息 *</label>
              <textarea class="input" rows="3" value=${message}
                        onInput=${(e) => setMessage(e.target.value)}></textarea>
            </div>
            ${mode !== 'resume' && html`
              <div class="field">
                <label>workspacePath ${mode === 'crew-chat' ? '（必填）' : '（可选）'}</label>
                <input class="input mono" value=${workspacePath}
                       onInput=${(e) => setWorkspacePath(e.target.value)} placeholder="/tmp/lab" />
              </div>
            `}
            <div class="split-2">
              <div class="field">
                <label>模型（可选覆盖）</label>
                <input class="input mono" value=${model}
                       onInput=${(e) => setModel(e.target.value)} placeholder="缺省用 config.yaml" />
              </div>
              <div class="field">
                <label>思考模式</label>
                <label style="display:flex;gap:6px;align-items:center;cursor:pointer;padding:6px 0">
                  <input type="checkbox" checked=${thinking} onChange=${(e) => setThinking(e.target.checked)} />
                  thinkingEnabled
                </label>
              </div>
            </div>
            <div class="field">
              <label>config（可选 JSON —— body.config）</label>
              <textarea class="input mono" rows="3" value=${configJson}
                        onInput=${(e) => setConfigJson(e.target.value)}
                        placeholder='${'{ "tools": { "builtinFilter": {} } }'}'></textarea>
            </div>
            <div class="field">
              <label>attachments（可选 JSON —— body.attachments）</label>
              <textarea class="input mono" rows="2" value=${attachmentsJson}
                        onInput=${(e) => setAttachmentsJson(e.target.value)}
                        placeholder='${'[{"kind":"image","url":"file:relative.png"}]'}'></textarea>
            </div>
            ${formError && html`<div class="error-banner">${formError}</div>`}
            <div style="display:flex;gap:8px;margin-top:8px">
              <button class="btn btn-primary" disabled=${running} onClick=${send}>运行</button>
              <button class="btn" disabled=${!running} onClick=${() => eng.stop()}>停止</button>
              <button class="btn" onClick=${() => eng.reset()}>重置</button>
            </div>
          </div>
          <div class="panel">
            <div class="panel-header"><span class="panel-title">请求体预览</span></div>
            ${bodyError
              ? html`<div class="error-banner">${bodyError}</div>`
              : html`<${JsonTree} data=${bodyPreview} open=${3} />`}
          </div>
        </div>

        <div class="runlab-main">
          <div class="panel">
            <div class="run-status-line">
              <span class="run-dot ${dotClass}"></span>
              <span>${STATUS_LABELS[st.status] || st.status}</span>
              ${st.sessionId && html`<span>会话 <span class="mono">${st.sessionId}</span></span>`}
              ${st.endpoint && html`<span class="mono dim">${st.endpoint}</span>`}
              ${currentPhase && html`<span>相位 <span class="mono">${currentPhase}</span></span>`}
              ${st.doneInfo && html`<span>步数 ${st.doneInfo.totalSteps ?? '—'} · token ${JSON.stringify(st.doneInfo.tokens ?? null)}</span>`}
              <span class="spacer" style="flex:1" />
              <div class="view-toggle">
                ${['rendered', 'raw', 'phases'].map((v) => html`
                  <button key=${v} class=${view === v ? 'active' : ''} onClick=${() => setView(v)}>${VIEW_LABELS[v]}</button>
                `)}
              </div>
            </div>
            ${(st.error || st.responseError) && html`
              <div class="error-banner">${st.error ? (st.error.message || JSON.stringify(st.error)) : ''}${st.responseError ? (st.responseError.message || String(st.responseError)) : ''}</div>
            `}
            ${view === 'rendered' && html`
              <div style="max-height:52vh;overflow-y:auto;padding-right:4px">
                <${RenderedItems} items=${st.items} />
                ${st.interrupt && html`<${HitlCard} interrupt=${st.interrupt} onRespond=${(response) => eng.respond(st.interrupt.requestId, response)} />`}
              </div>
              ${st.todo && html`
                <div style="margin-top:10px">
                  <div class="dim small" style="margin-bottom:4px">任务清单 todo-list（共 ${(st.todo || []).length} 项）</div>
                  ${(st.todo || []).map((t, i) => html`
                    <div key=${i} class="small mono ${t.status === 'completed' ? 'dim' : ''}" style=${t.status === 'completed' ? 'text-decoration:line-through' : ''}>${t.status === 'completed' ? '☑' : '☐'} ${t.content || JSON.stringify(t)}</div>
                  `)}
                </div>
              `}
              ${st.sessionId && !running && html`
                <div class="chat-input-row">
                  <textarea class="input" rows="2" placeholder="追问消息 → 恢复会话续跑"
                            value=${followUp} onInput=${(e) => setFollowUp(e.target.value)}></textarea>
                  <div style="display:flex;flex-direction:column;gap:6px">
                    <button class="btn btn-primary btn-sm" onClick=${sendFollowUp} disabled=${!followUp.trim()}>发送续跑</button>
                    <div style="display:flex;gap:4px;align-items:center">
                      <input class="input mono" style="width:52px;padding:2px 6px" value=${keepTurns}
                             onInput=${(e) => setKeepTurns(e.target.value)} title="keepTurns 保留轮数" />
                      <button class="btn btn-sm" title="截断历史（truncate）" onClick=${() => eng.truncate(parseInt(keepTurns, 10) || 1)}>✂</button>
                    </div>
                  </div>
                </div>
              `}
            `}
            ${view === 'raw' && html`<${EventStream} frames=${st.frames} height="56vh" />`}
            ${view === 'phases' && html`
              <div class="phase-bar" style="margin-top:6px">
                ${phaseChips.length === 0 && html`<span class="dim">还没有相位变化。</span>`}
                ${phaseChips.map((p, i) => html`
                  <span key=${i} class="phase-chip ${i === phaseChips.length - 1 ? 'current' : ''}">${p}</span>
                  ${i < phaseChips.length - 1 && html`<span class="phase-arrow">→</span>`}
                `)}
              </div>
              <div class="dim small">phase-change 序列 · 共 ${st.phases.length} 次迁移。完整载荷在原始帧视图里。</div>
            `}
          </div>
        </div>
      </div>
    </div>
  `;
}

export default RunLabPage;
