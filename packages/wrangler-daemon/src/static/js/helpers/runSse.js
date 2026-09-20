/**
 * Unified SSE readers for the daemon's two stream flavours.
 *
 *  - readPostSse(response, handlers): chat streams (agent chat / crew chat /
 *    resume / respond) are POST endpoints, so EventSource cannot be used. The
 *    response body is split on blank lines into frames of shape
 *    {event, data, raw, at}. data is JSON.parsed best-effort. Keep-alive
 *    comments (":...") are skipped. The daemon stamps `timestamp` into every
 *    data payload.
 *
 *  - openEventsStream(sessionId, handlers, opts): GET /api/chat/:id/events
 *    via fetch(AbortController 可关)—— 会话级常驻事件流:重放 +
 *    history-end 分界 + 直播,不随 done 关闭。
 */

import { BASE } from '../api.js';

/** Parse one raw SSE block (lines) into {event, data, raw}. */
function parseFrame(rawBlock) {
  let event = 'message';
  const dataLines = [];
  for (const line of rawBlock.split('\n')) {
    if (line.startsWith(':')) continue; // keep-alive comment
    if (line.startsWith('event:')) event = line.slice(6).trim();
    else if (line.startsWith('data:')) dataLines.push(line.slice(5).trimStart());
  }
  if (dataLines.length === 0) return null;
  const dataText = dataLines.join('\n');
  let data = dataText;
  try { data = JSON.parse(dataText); } catch { /* keep text */ }
  return { event, data, raw: dataText, at: new Date() };
}

/**
 * Read a POST-based SSE stream from an already-created fetch Response.
 * handlers: { onFrame({event,data,raw,at}), onError(err), onClose() }.
 * Exactly one of onClose/onError fires at the end.
 */
export async function readPostSse(response, handlers = {}) {
  if (!response.ok) {
    let data;
    try { data = await response.json(); } catch { /* ignore */ }
    const err = new Error(
      (data && data.error) || `HTTP ${response.status} ${response.statusText}`,
    );
    err.status = response.status;
    err.body = data;
    handlers.onError && handlers.onError(err);
    return;
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let idx;
      while ((idx = buf.indexOf('\n\n')) !== -1) {
        const block = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        const frame = parseFrame(block);
        if (frame) handlers.onFrame && handlers.onFrame(frame);
      }
    }
    // Flush a trailing frame without terminator.
    if (buf.trim()) {
      const frame = parseFrame(buf);
      if (frame) handlers.onFrame && handlers.onFrame(frame);
    }
    handlers.onClose && handlers.onClose();
  } catch (e) {
    // 主动 close()(AbortController)不是错误:静默收束,不回调 onError——
    // 否则换会话/手动断开时旧流的 AbortError 会异步污染新状态。
    if (e && e.name === 'AbortError') {
      handlers.onClose && handlers.onClose();
      return;
    }
    handlers.onError && handlers.onError(e);
  }
}

/**
 * Start a run against any of the four chat SSE endpoints and pipe it through
 * readPostSse. `path`/`body` define the request; optional `signal` aborts the
 * POST (e.g. the engine's reset). Returns an object with response promise +
 * the same handlers semantics as readPostSse.
 */
export function startChatStream(path, body, handlers, signal) {
  return fetch(BASE + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body, null, 2),
    signal,
  }).then((response) => readPostSse(response, handlers));
}

/**
 * GET /api/chat/:id/events —— 会话级常驻事件流(会话 API 的主接口)。
 * 建连先重放历史 + 一帧 `history-end` 分界,之后全序直播(轮帧/
 * 子智能体/投递/消费轮)。流不因 done 关闭:只在服务器回收会话、
 * 网络中断,或调用方 close() 时结束。返回 { close() }。
 * handlers 与 readPostSse 同构({ onFrame, onError, onClose })。
 */
export function openEventsStream(sessionId, handlers = {}, opts = {}) {
  const ctrl = new AbortController();
  const q = opts.sessionDir ? `?sessionDir=${encodeURIComponent(opts.sessionDir)}` : '';
  fetch(`${BASE}/api/chat/${encodeURIComponent(sessionId)}/events${q}`, { signal: ctrl.signal })
    .then((res) => readPostSse(res, handlers))
    .catch((e) => {
      if (e && e.name === 'AbortError') return;
      handlers.onError && handlers.onError(e);
    });
  return { close: () => ctrl.abort() };
}
