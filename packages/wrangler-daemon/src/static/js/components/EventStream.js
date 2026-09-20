/**
 * EventStream — raw SSE frame timeline. Every frame verbatim: timestamp,
 * event name (colour-coded), one-line summary; click to expand the full data
 * JSON. Event-type filter chips and auto-scroll.
 */
import { html, useState, useEffect, useRef, useMemo } from '../utils.js';
import { JsonTree } from './JsonTree.js';

const EVENT_CLASSES = [
  ['token', 'token'], ['thinking', 'thinking'],
  ['tool-start', 'tool'], ['tool-end', 'tool'],
  ['step-start', 'step'], ['step-end', 'step'],
  ['llm-request', 'llm'], ['llm-response', 'llm'],
  ['error', 'error'], ['abort', 'error'],
  ['session-start', 'session'], ['session-cleared', 'session'],
  ['human-input', 'human'], ['human-input-resolved', 'human'],
  ['subagent-start', 'subagent'], ['subagent-token', 'subagent'], ['subagent-thinking', 'subagent'],
  ['subagent-tool-start', 'subagent'], ['subagent-tool-end', 'subagent'], ['subagent-end', 'subagent'],
  ['todo-list', 'todo'],
  ['phase-change', 'phase'], ['compressing', 'phase'], ['compressed', 'phase'],
  ['done', 'done'],
];
const CLASS_BY_EVENT = Object.fromEntries(EVENT_CLASSES);
const CLASS_LABELS = {
  token: '正文', thinking: '思考', tool: '工具', step: '步骤', llm: 'LLM',
  error: '错误', session: '会话', human: '人工', subagent: '子代理',
  todo: '任务', phase: '相位', done: '完成',
};

function classOf(event) {
  return CLASS_BY_EVENT[event] || 'phase';
}

function fmtMs(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${String(d.getMilliseconds()).padStart(3, '0')}`;
}

function summarize(event, data) {
  if (!data || typeof data !== 'object') return data === undefined ? '' : String(data);
  switch (event) {
    case 'token': return JSON.stringify(data.delta);
    case 'thinking': return (data.content || '').slice(0, 120);
    case 'tool-start': return `${data.name} ${JSON.stringify(data.args).slice(0, 120)}`;
    case 'tool-end': return String(data.result).slice(0, 120);
    case 'llm-request': return `${(data.messages || []).length} msgs, ${(data.tools || []).length} tools, model=${data.model}`;
    case 'llm-response': return `text=${(data.text || '').length}ch, toolCalls=${(data.toolCalls || []).length}, tokens=${JSON.stringify(data.tokens || null)}`;
    case 'phase-change': return `${data.from && data.from.type} → ${data.to && data.to.type}`;
    case 'todo-list': return `${(data.items || []).length} items`;
    case 'done': return `type=${data.type} steps=${data.totalSteps} tokens=${JSON.stringify(data.tokens || null)}${data.answer ? ' answer=' + String(data.answer).slice(0, 80) : ''}`;
    case 'error': return data.message;
    case 'human-input': return `requestId=${data.requestId}${data.questions ? ' questions=' + data.questions.length : ''}${data.confirm ? ' confirm=' + data.confirm.toolName : ''}`;
    case 'subagent-start': return `${data.name}: ${String(data.task).slice(0, 100)}`;
    case 'subagent-end': return `${data.name} status=${data.status}`;
    default: return JSON.stringify(data).slice(0, 140);
  }
}

function EventRow({ frame, index }) {
  const [open, setOpen] = useState(false);
  const cls = classOf(frame.event);
  return html`
    <div class="ev-row ev-${cls} ${open ? 'open' : ''}" onClick=${() => setOpen(!open)}>
      <div class="ev-head">
        <span class="ev-time">${frame.seq ?? index}</span>
        <span class="ev-time">${fmtMs(frame.at)}</span>
        <span class="ev-name">${frame.event}</span>
        <span class="ev-summary">${summarize(frame.event, frame.data)}</span>
      </div>
      ${open && html`
        <div class="ev-detail">
          ${typeof frame.data === 'object'
            ? html`<${JsonTree} data=${frame.data} open=${3} />`
            : html`<pre>${String(frame.data)}</pre>`}
        </div>
      `}
    </div>
  `;
}

export function EventStream({ frames, height }) {
  const [hidden, setHidden] = useState(() => ({})); // class → bool
  const [autoScroll, setAutoScroll] = useState(true);
  const boxRef = useRef(null);

  const presentClasses = useMemo(() => {
    const set = new Set();
    for (const f of frames) set.add(classOf(f.event));
    return [...set];
  }, [frames.length]);

  useEffect(() => {
    if (autoScroll && boxRef.current) {
      boxRef.current.scrollTop = boxRef.current.scrollHeight;
    }
  }, [frames.length]);

  const visible = frames.filter((f) => !hidden[classOf(f.event)]);
  const style = height ? { maxHeight: height } : undefined;

  return html`
    <div>
      <div class="event-filter">
        ${presentClasses.map((c) => html`
          <span key=${c}
                class="tag ${hidden[c] ? '' : 'on'}"
                onClick=${() => setHidden({ ...hidden, [c]: !hidden[c] })}>
            ${CLASS_LABELS[c] || c}
          </span>
        `)}
        <span class="spacer" style="flex:1" />
        <label class="small dim" style="display:flex;align-items:center;gap:4px;cursor:pointer">
          <input type="checkbox" checked=${autoScroll} onChange=${(e) => setAutoScroll(e.target.checked)} />
          自动滚动
        </label>
        <span class="small dim">${visible.length}/${frames.length} 帧</span>
      </div>
      <div class="event-stream" ref=${boxRef} style=${style}>
        ${visible.map((f, i) => html`<${EventRow} key=${f.seq ?? i} frame=${f} index=${i} />`)}
        ${visible.length === 0 && html`<div class="dim" style="padding:10px">${frames.length ? '帧都被过滤了' : '还没有帧'}。</div>`}
      </div>
    </div>
  `;
}
