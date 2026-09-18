/* eslint-disable */
// ── 常驻 events 流客户端（R2P-153，TS 版对齐 Rust c48fda0 的 openEventsStream，
//    并补齐任务要求的重连 lastSeq 续传）──
//
// GET /api/chat/:id/events —— 会话级常驻事件流（会话 API 的主接口）：
// 建连先重放 `seq > lastSeq` 的历史帧 + 一帧 history-end 分界，之后全序
// 直播（轮帧/子智能体/消费轮），不随 done 关闭。send 的 ack 化意味着
// 聊天页的帧来源全面迁到这条流上。
//
// 本模块职责：
//  - 帧解析（fetch + ReadableStream，POST 流同构的逐块解析）；
//  - seq 去重：data.seq ≤ 已见的帧丢弃（重放/直播交界的重复由服务端
//    lastSeq 门控压掉大半，这里再兜一层；跨 transport 的总去重在宿主的
//    ingest 层做——同一条帧可能同时到达 POST 流与本流）；
//  - 断线重连：流中断（网络断开/服务端关流）按退避重连，重连带
//    ?lastSeq=续传（断线期间的帧由建连重放补齐）；
//  - 终态不重连：HTTP 错误（404 会话不存在/410 过期——冷首发时挂流早于
//    发送属预期，由宿主决定重试时机）与 session-evicted 帧（会话被驱逐，
//    seq 空间已重启，续传无意义）都交回调收束。onOpen 在建连成功（200）
//    时回调一次——宿主据此区分「在途」与「已挂上」。
//
// handlers: { onFrame({event,data}), onOpen(), onError(err), onTerminal(frame) }
// opts:
//   - lastSeq: 建连门控（重放/直播都以它为界——服务端的直播守卫同样从它
//     起步，必须是真实见过的 seq，不可用大数「只要直播」）。
//   - suppressReplay: 首连接在 history-end 分界帧之前的重放段不投递
//     （宿主已从磁盘历史对账过过去；分界之后的直播照常）。重连不抑制
//     ——重连的重放段是断线补洞，恰是要补进 UI 的帧。
// 返回 { close() } —— 主动关闭（换会话/重置），不触发重连。

var BASE = location.origin;

var RECONNECT_BASE_MS = 1000;
var RECONNECT_MAX_MS = 10000;

/** 解析一个 SSE 块（多行）为 {event, data}；无 data 行返回 null。 */
function parseFrame(block) {
  var event = 'message';
  var dataLines = [];
  var lines = block.split('\n');
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i];
    if (line.indexOf(':') === 0) continue; // keep-alive 注释行
    if (line.indexOf('event:') === 0) event = line.slice(6).trim();
    else if (line.indexOf('data:') === 0) dataLines.push(line.slice(5).trim());
  }
  if (dataLines.length === 0) return null;
  var text = dataLines.join('\n');
  var data = text;
  try {
    data = JSON.parse(text);
  } catch (_) {
    /* 保留原文 */
  }
  return { event: event, data: data };
}

export function openEventsStream(sessionId, handlers, opts) {
  handlers = handlers || {};
  var initialLastSeq = opts && typeof opts.lastSeq === 'number' ? opts.lastSeq : 0;
  var lastSeq = initialLastSeq;
  // 抑制只作用于首连接的重放段（磁盘对账过的过去）；自动重连的补洞段
  // 恰是要补进 UI 的帧，不抑制。
  var suppressFirstReplay = !!(opts && opts.suppressReplay);
  var closed = false;
  var ctrl = null;
  var attempt = 0;

  function connect() {
    if (closed) return;
    var suppressing = suppressFirstReplay;
    suppressFirstReplay = false;
    ctrl = new AbortController();
    // 响应自带 Cache-Control: no-cache，重连同 URL 也会重新拉取；lastSeq
    // 随已见帧推进，URL 天然区分断点。
    fetch(BASE + '/api/chat/' + encodeURIComponent(sessionId) + '/events?lastSeq=' + lastSeq, {
      signal: ctrl.signal,
    })
      .then(function (res) {
        if (closed) return;
        if (!res.ok) {
          // 404/410 等：会话不存在或已过期——终端态交宿主决策（冷首发的
          // 「先挂流会 404」是预期路径，宿主在 ack 后重挂）。
          handlers.onError &&
            handlers.onError(new Error('events attach failed: HTTP ' + res.status));
          return;
        }
        attempt = 0;
        handlers.onOpen && handlers.onOpen();
        return pump(res, suppressing);
      })
      .catch(function (e) {
        if (closed || (e && e.name === 'AbortError')) return;
        // 建连阶段网络失败：与中断流同款退避重连。
        scheduleReconnect();
      });
  }

  function pump(res, suppressing) {
    var reader = res.body.getReader();
    var dec = new TextDecoder();
    var buf = '';
    var divided = false;
    function step() {
      return reader.read().then(function (r) {
        if (r.done) {
          // 流被服务端/网络收束（非主动关闭）——退避重连，lastSeq 续传。
          scheduleReconnect();
          return;
        }
        buf += dec.decode(r.value, { stream: true });
        var idx;
        while ((idx = buf.indexOf('\n\n')) !== -1) {
          var block = buf.slice(0, idx);
          buf = buf.slice(idx + 2);
          var frame = parseFrame(block);
          if (!frame) continue;
          if (frame.event === 'session-evicted') {
            // 会话被驱逐/重建：seq 空间重启，续传无意义——终端回调收束。
            handlers.onTerminal && handlers.onTerminal(frame);
            return;
          }
          if (frame.event === 'history-end') {
            divided = true;
            handlers.onFrame && handlers.onFrame(frame);
            continue;
          }
          if (frame.data && typeof frame.data === 'object' && typeof frame.data.seq === 'number') {
            if (frame.data.seq <= lastSeq) continue; // 交界重复兜底
            // seq 记账不受抑制影响——重连续传与去重都以真实进度为准。
            lastSeq = frame.data.seq;
            if (suppressing && !divided) continue; // 重放段抑制投递
          }
          handlers.onFrame && handlers.onFrame(frame);
        }
        return step();
      });
    }
    return step().catch(function (e) {
      if (closed || (e && e.name === 'AbortError')) return;
      scheduleReconnect();
    });
  }

  function scheduleReconnect() {
    if (closed) return;
    attempt = Math.min(attempt + 1, 5);
    setTimeout(connect, Math.min(RECONNECT_BASE_MS * attempt, RECONNECT_MAX_MS));
  }

  connect();
  return {
    close: function () {
      closed = true;
      if (ctrl) ctrl.abort();
    },
  };
}
