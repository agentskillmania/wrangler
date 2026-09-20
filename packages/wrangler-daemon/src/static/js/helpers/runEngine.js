/**
 * run-engine — the single state machine behind RunLab.
 *
 * Run entrypoints:
 *   POST /api/agents/:name/onetake  (一次性:响应即本轮 SSE 流)
 *   POST /api/chat/:session_id      (ack;crew 创建/续聊都走这里,帧在
 *                                    GET /api/chat/:id/events 常驻流上收)
 *   POST /api/chat/:session_id/respond (ack;HITL 应答,续跑帧同样在 events 上)
 *
 * onetake 之外的动作不发流:引擎为每个 sessionId 维护一条 events 常驻
 * 订阅(ensureEvents),帧统一从那里进状态机;POST 只拿 ack/错误码。
 *
 * It keeps two parallel projections of the same stream:
 *   - frames: every raw SSE frame verbatim (ring buffer) — the "真实" view;
 *   - items:  an incrementally-reduced rendered view (user / assistant /
 *             thinking / tool / subagent / error / compressed ...).
 * plus phases (phase-change sequence), todoList, the pending human-input
 * interrupt, and run status.
 *
 * Publish/subscribe: subscribe(fn) → unsubscribe. The page re-renders on
 * every notify; high-frequency token frames coalesce naturally because
 * preact diffs cheaply — RunLab additionally throttles via requestAnimationFrame
 * when it subscribes.
 */

import { startChatStream, openEventsStream } from './runSse.js';
import { BASE } from '../api.js';

const FRAMES_CAP = 3000;

/** Map `done` frame type → engine status. */
function statusOfDone(type) {
  switch (type) {
    case 'success': return 'done';
    case 'waiting_human': return 'waiting-human';
    case 'error': return 'error';
    case 'abort':
    case 'stopped': return 'aborted';
    case 'max_steps': return 'max-steps';
    default: return 'done';
  }
}

export function createRunEngine() {
  const state = {
    status: 'idle',        // idle | running | waiting-human | done | error | aborted | max-steps
    sessionId: null,
    sessionMeta: null,     // session-start payload
    endpoint: null,
    requestBody: null,
    startedAt: null,
    endedAt: null,
    frames: [],            // raw frames, verbatim
    items: [],             // rendered projection
    phases: [],            // phase-change sequence
    todo: null,            // todo-list items
    interrupt: null,       // pending human-input payload
    doneInfo: null,        // done frame data
    error: null,           // terminal error (stream or event)
    responseError: null,   // transport-level error (e.g. 409 busy)
    // ── 常驻 events 流的内部簿记(下划线 = 非投影状态)──
    _eventsSid: null,      // 当前挂的会话
    _eventsHandle: null,   // { close() } 句柄
    _eventsLive: false,    // 已过 history-end(直播段)
    _lastSeq: null,        // 已应用的最高帧序号(重连去重/补洞)
    _reconnectRetries: 0,  // 连续重连失败计数(任一帧即清零)
    // ── 代际:reset 自增,在途异步回调先比对再落地(reset 后的迟到
    // 回调不得复活旧会话/污染新视图)──
    _gen: 0,
    _postAbort: null,      // 在途 POST 的 AbortController
  };

  const listeners = new Set();
  const notify = () => listeners.forEach((fn) => fn());

  // ── rendered-projection helpers ────────────────────────────────────────

  function pushItem(item) {
    state.items.push(item);
    if (state.items.length > FRAMES_CAP) state.items.splice(0, state.items.length - FRAMES_CAP);
  }

  function ensureAssistant() {
    const last = state.items[state.items.length - 1];
    if (!last || last.kind !== 'assistant' || last.closed) {
      pushItem({ kind: 'assistant', text: '', closed: false });
    }
    return state.items[state.items.length - 1];
  }

  function findTool(id) {
    for (let i = state.items.length - 1; i >= 0; i--) {
      const it = state.items[i];
      if (it.kind === 'tool' && (it.callId === id || it.id === id)) return it;
    }
    return null;
  }

  function findSub(id) {
    for (let i = state.items.length - 1; i >= 0; i--) {
      const it = state.items[i];
      if (it.kind === 'sub' && it.subtaskId === id) return it;
    }
    return null;
  }

  // ── frame application ──────────────────────────────────────────────────

  function applyFrame(frame) {
    state.frames.push(frame);
    if (state.frames.length > FRAMES_CAP) state.frames.splice(0, state.frames.length - FRAMES_CAP);

    const { event, data } = frame;
    switch (event) {
      case 'session-start':
        state.sessionId = data.sessionId;
        state.sessionMeta = data;
        break;
      case 'token':
        ensureAssistant().text += data.delta;
        break;
      case 'thinking': {
        const last = state.items[state.items.length - 1];
        if (!last || last.kind !== 'thinking' || last.closed) {
          pushItem({ kind: 'thinking', text: '', closed: false });
        }
        state.items[state.items.length - 1].text += data.content;
        break;
      }
      case 'tool-start':
        pushItem({ kind: 'tool', callId: data.id, id: data.id, name: data.name, args: data.args, result: null, done: false, at: frame.at });
        break;
      case 'tool-end': {
        const tool = findTool(data.callId);
        if (tool) { tool.result = data.result; tool.done = true; }
        else pushItem({ kind: 'tool', callId: data.callId, name: '(unknown)', args: null, result: data.result, done: true, at: frame.at });
        break;
      }
      case 'subagent-start':
        pushItem({ kind: 'sub', subtaskId: data.subtaskId, name: data.name, task: data.task, text: '', events: [], done: false, startedAt: frame.at, endedAt: null });
        break;
      case 'subagent-token': {
        const sub = findSub(data.subtaskId);
        if (sub) sub.text += data.delta;
        break;
      }
      case 'subagent-thinking':
      case 'subagent-tool-start':
      case 'subagent-tool-end': {
        const sub = findSub(data.subtaskId);
        if (sub) sub.events.push({ event, data });
        break;
      }
      case 'subagent-end': {
        const sub = findSub(data.subtaskId);
        if (sub) { sub.done = true; sub.status = data.status; sub.answer = data.answer; sub.error = data.error; sub.endedAt = frame.at; }
        break;
      }
      case 'phase-change':
        state.phases.push(data);
        break;
      case 'todo-list':
        state.todo = data.items;
        break;
      case 'human-input':
        state.interrupt = data;
        state.status = 'waiting-human';
        pushItem({ kind: 'hitl-mark', requestId: data.requestId });
        break;
      case 'human-input-resolved':
        state.interrupt = null;
        break;
      case 'compressed':
        pushItem({ kind: 'compressed', ...data });
        break;
      case 'error':
        state.error = data;
        pushItem({ kind: 'error', message: data.message, step: data.step, toolName: data.toolName });
        break;
      case 'abort':
        pushItem({ kind: 'abort', ...data });
        break;
      case 'done': {
        // Close open text items.
        for (const it of state.items) if (!it.closed && (it.kind === 'assistant' || it.kind === 'thinking')) it.closed = true;
        state.doneInfo = data;
        state.endedAt = frame.at;
        state.status = statusOfDone(data.type);
        break;
      }
      default:
        // llm-request / llm-response / step-* / compressing / session-cleared /
        // subagent events for unknown ids: raw-frames view only.
        break;
    }
    notify();
  }

  // ── run entrypoints ────────────────────────────────────────────────────

  function begin(endpoint, body) {
    const gen = state._gen;
    const postAbort = new AbortController();
    state._postAbort = postAbort;
    state.status = 'running';
    state.endpoint = endpoint;
    state.requestBody = body;
    state.startedAt = new Date();
    state.endedAt = null;
    state.error = null;
    state.responseError = null;
    state.doneInfo = null;
    state.interrupt = null;
    state.phases = [];
    pushItem({ kind: 'user', text: body.message || '(no message)' });
    notify();
    return startChatStream(endpoint, body, {
      onFrame: (frame) => { if (state._gen === gen) applyFrame(frame); },
      onError: (e) => {
        if (state._gen !== gen) return;
        state.responseError = e;
        if (state.status === 'running') state.status = 'error';
        notify();
      },
      onClose: () => {
        if (state._gen !== gen) return;
        // A stream may end without a done frame if the connection drops.
        if (state.status === 'running') state.status = 'error';
        state.endedAt = state.endedAt || new Date();
        notify();
      },
    }, postAbort.signal);
  }

  // 会话级常驻事件订阅:ack 类动作的帧来源。同 sessionId 复用,换会话
  // 或 reset 时关旧流。
  //
  // 重放去重按帧序号 seq(服务端逐帧分配,重放/直播同空间):≤ 已见
  // 跳过(去重),> 已见应用(断线补洞)。旧 daemon 无 seq 的帧退化为
  // history-end 分界(分界前不推)。
  function ensureEvents(sessionId) {
    if (state._eventsSid === sessionId && state._eventsHandle) return;
    closeEvents();
    state._eventsSid = sessionId;
    const handle = openEventsStream(sessionId, {
      onFrame: (frame) => {
        // 任一帧成功收到:重连退避清零。
        state._reconnectRetries = 0;
        const seq = frame.data && typeof frame.data.seq === 'number' ? frame.data.seq : null;
        if (frame.event === 'events-gap') {
          // 通道滞后丢帧:断流重连,重放按 seq 补洞。
          scheduleReconnect(sessionId, 'events-gap');
          return;
        }
        if (frame.event === 'history-end') {
          state._eventsLive = true;
          return;
        }
        if (!state._eventsLive) {
          // 重放段门控:新引擎(_lastSeq 为 null)全放行;已消费过帧的
          // 引擎按 seq 去重(≤ 已见跳过,> 已见补洞)。daemon 的重放
          // 只含未落盘的活动(活动落定即清缓冲)——安静会话的重放为
          // 空、进行中轮从活动起点整段补齐;已完成的旧轮不在重放里,
          // 由调用方自行读磁盘历史打底(playground 无打底,接受只在
          // 线渲染)。旧 daemon 无 seq 的重放帧在首次挂流时放行,后续
          // 由 history-end 分界。
          if (seq === null && state._lastSeq !== null) return;
          if (state._lastSeq !== null && seq !== null && seq <= state._lastSeq) return;
        }
        if (seq !== null) {
          state._lastSeq = state._lastSeq === null ? seq : Math.max(state._lastSeq, seq);
        }
        applyFrame(frame);
      },
      onError: (e) => {
        // 410(会话不存在/过期)在 resume 老会话时不算致命——发消息后
        // 会话才会被建出来;记一笔,POST 的 ack 才是权威。其余错误在
        // 轮在飞时是断流:重连(带 seq 补洞),连续失败才置错。
        state.responseError = e;
        if (state.status === 'running' && e && e.status !== 410) {
          scheduleReconnect(sessionId, 'stream error');
        }
        notify();
      },
      onClose: () => {
        // 只清自己的句柄——旧流若在新流赋值后自然结束,不能误清新流。
        if (state._eventsHandle === handle) state._eventsHandle = null;
        // 常驻流收尾(会话被冷却回收/网络断)而轮还在飞:重连补洞,
        // 连续失败才置错。迁移前 ack 路径没有这张安全网,断流会永久
        // 卡在"运行中"。
        if (state._eventsHandle === null && state.status === 'running') {
          scheduleReconnect(sessionId, 'stream closed');
        }
      },
    });
    state._eventsHandle = handle;
  }

  /// 断流重连:1s 起指数退避封顶 30s;任一帧成功收到即清零。重连的
  /// 重放段按 seq 去重/补洞,断口期间的帧不丢。
  function scheduleReconnect(sessionId, why) {
    if (state._eventsSid !== sessionId) return;
    closeEvents();
    state._reconnectRetries = (state._reconnectRetries || 0) + 1;
    if (state._reconnectRetries > 3) {
      state._reconnectRetries = 0;
      if (state.status === 'running') {
        state.status = 'error';
        state.endedAt = state.endedAt || new Date();
      }
      state.responseError = new Error(`events stream lost (${why}) after retries`);
      notify();
      return;
    }
    const delay = Math.min(1000 * 2 ** (state._reconnectRetries - 1), 30000);
    setTimeout(() => {
      if (state._eventsSid === sessionId && !state._eventsHandle) {
        ensureEvents(sessionId);
      }
    }, delay);
  }

  /// 关闭常驻流(reset/换会话/卸载时调用;幂等)。
  function closeEvents() {
    if (state._eventsHandle) state._eventsHandle.close();
    state._eventsHandle = null;
    state._eventsLive = false;
  }

  // ack 类动作:先 POST(此时会话必然已存在/已建)再挂 events——反过来
  // 会在新会话上先吃 410 并复用死句柄(CR P0)。帧经 ensureEvents 的常驻
  // 流进状态机(建连重放补齐 POST 与挂之间的早帧);done 帧由 applyFrame
  // 收口(流本身不再关闭)。
  function beginAck(label, path, body) {
    const gen = state._gen;
    const postAbort = new AbortController();
    state._postAbort = postAbort;
    state.status = 'running';
    state.endpoint = label;
    state.requestBody = body;
    state.startedAt = new Date();
    state.endedAt = null;
    state.error = null;
    state.responseError = null;
    state.doneInfo = null;
    state.interrupt = null;
    state.phases = [];
    const sid = state.sessionId;
    return fetch(`${BASE}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body, null, 2),
      signal: postAbort.signal,
    }).then(async (res) => {
      if (state._gen !== gen) return; // reset 期间的迟到回执:直接丢弃
      if (!res.ok) {
        let data;
        try { data = await res.json(); } catch { /* ignore */ }
        const err = new Error((data && data.error) || `HTTP ${res.status}`);
        err.status = res.status;
        err.body = data;
        state.responseError = err;
        // 409(busy/HITL 未答)同样是失败终态——不会有 done 来收口。
        if (state.status === 'running') state.status = 'error';
        notify();
        return;
      }
      // 受理后才入渲染视图、才挂流(早帧由建连重放补齐)。
      pushItem({ kind: 'user', text: (body && body.message) || '(no message)' });
      notify();
      ensureEvents(sid);
    }).catch((e) => {
      if (state._gen !== gen) return;
      state.responseError = e;
      if (state.status === 'running') state.status = 'error';
      notify();
    });
  }

  return {
    state,
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },

    startAgentChat(name, body) {
      // onetake:响应就是本轮的 SSE 流(done 即关)。要看后续(子任务/
      // 投递/消费轮)可在 done 后经 resume 续聊——那时 events 已挂上。
      return begin(`/api/agents/${encodeURIComponent(name)}/onetake`, body);
    },
    startCrewChat(id, body) {
      // crew 会话经统一发送端点创建:ack 语义,帧在 events 流上收。
      const sid = (body && body.sessionId) || (crypto.randomUUID ? crypto.randomUUID() : `crew-${Date.now()}`);
      state.sessionId = sid;
      return beginAck(`POST /api/chat/:id {crew}`, `/api/chat/${encodeURIComponent(sid)}`, {
        ...(body || {}), crew: id, sessionId: sid,
      });
    },
    resume(sessionId, body) {
      state.sessionId = sessionId;
      return beginAck(`POST /api/chat/:id`, `/api/chat/${encodeURIComponent(sessionId)}`, body);
    },
    respond(requestId, response) {
      const sid = state.sessionId;
      if (!sid) {
        state.responseError = new Error('no active session to respond on');
        notify();
        return Promise.resolve();
      }
      state.interrupt = null;
      pushItem({ kind: 'user', text: typeof response === 'string' ? response : JSON.stringify(response) });
      notify();
      return beginAck(`POST /api/chat/:id/respond`, `/api/chat/${encodeURIComponent(sid)}/respond`, { requestId, response });
    },

    async stop() {
      const sid = state.sessionId;
      if (!sid) return;
      try {
        const res = await fetch(`${BASE}/api/chat/${encodeURIComponent(sid)}/stop`, { method: 'POST' });
        const data = await res.json().catch(() => ({}));
        if (!data.stopped) {
          state.responseError = new Error(data.error || 'stop returned stopped:false (no active run?)');
          notify();
        }
      } catch (e) {
        state.responseError = e;
        notify();
      }
    },

    truncate(keepTurns) {
      const sid = state.sessionId;
      if (!sid) return Promise.resolve(null);
      return fetch(`${BASE}/api/sessions/${encodeURIComponent(sid)}/truncate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keepTurns }),
      }).then((r) => r.json());
    },

    /// 关闭常驻 events 流(页面卸载/换故事时调用;reset 内部也会调)。
    closeEvents,

    reset() {
      // 代际自增:在途 POST/流的迟到回调按代际丢弃,不再复活旧会话。
      state._gen += 1;
      state._postAbort?.abort();
      state._postAbort = null;
      closeEvents();
      state._eventsSid = null;
      state._lastSeq = null;
      state._reconnectRetries = 0;
      Object.assign(state, {
        status: 'idle', sessionId: null, sessionMeta: null, endpoint: null,
        requestBody: null, startedAt: null, endedAt: null,
        frames: [], items: [], phases: [], todo: null,
        interrupt: null, doneInfo: null, error: null, responseError: null,
      });
      notify();
    },
  };
}
