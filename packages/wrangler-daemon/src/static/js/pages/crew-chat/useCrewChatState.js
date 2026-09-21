/* eslint-disable */
// ── Hook: useCrewChatState ──
// Manages all state and business logic for the CrewChatPage.
//
// Mirrors useChatState; crew 新会话经统一发送端点创建（POST /api/chat/:id
// 带 crew 字段 + client 生成的 sessionId——/api/crews/:id/chat 已并入，
// 对齐 Rust 65732f3/c48fda0）。
// Extends handleStreamEvent to surface sub-agent tokens/thinking/tools
// in the main chat column — agent chat silently discards these.

import { useState, useEffect, useRef } from '../../utils.js';
import { api } from '../../api.js';
import { openEventsStream } from '../../helpers/chatEventsStream.js';
import { eventToTag, formatEventData } from '../chat/EventCard.js';
import { sessionEntryToChatLine } from '../../helpers/sessionEntryToChatLine.js';

var BASE = location.origin;

export function useCrewChatState() {
  // ── Crews ──
  var _sCr = useState([]),
    crews = _sCr[0],
    setCrews = _sCr[1];

  // ── Selection ──
  var _sSC = useState(''),
    selectedCrew = _sSC[0],
    setSelectedCrew = _sSC[1];
  var _sWP = useState('/tmp/foobar'),
    workspacePath = _sWP[0],
    setWorkspacePath = _sWP[1];

  // ── Message Input ──
  var _sMsg = useState(''),
    message = _sMsg[0],
    setMessage = _sMsg[1];
  var _sDT = useState(false),
    msgThinking = _sDT[0],
    setMsgThinking = _sDT[1];
  var _sMsgModel = useState(''),
    msgModel = _sMsgModel[0],
    setMsgModel = _sMsgModel[1];
  var _sModelInfo = useState(null),
    modelInfo = _sModelInfo[0],
    setModelInfo = _sModelInfo[1];

  // ── Session ──
  var _sSid = useState(''),
    sessionId = _sSid[0],
    setSessionId = _sSid[1];
  var _sRSid = useState(''),
    resumeSessionId = _sRSid[0],
    setResumeSessionId = _sRSid[1];

  // ── Chat Display ──
  var _sCL = useState([]),
    chatLines = _sCL[0],
    setChatLines = _sCL[1];
  var _sSt = useState(false),
    streaming = _sSt[0],
    setStreaming = _sSt[1];

  // ── Refs ──
  var chatCtrlRef = useRef(null);
  var messagesEndRef = useRef(null);
  // ── 常驻 events 流（R2P-153 迁移，与 useChatState 同款）──
  var eventsRef = useRef(null);
  var lastSeqRef = useRef(0);
  // sessionId 的 ref 镜像：常驻流回调跨渲染周期读现值。
  var sessionIdRef = useRef(null);
  // 重挂兜底的判活/节流状态（返修 P2-1）：streamingRef 是 streaming 的 ref
  // 镜像——定时器回调若读渲染期闭包里的 streaming，拿到的是创建该函数实例
  // 那一帧的快照（主冷路径上恒为 false，兜底重试成死代码）；mountedRef 拦
  // 卸载后的未决定时器；reattach 两 ref 给 404 兜底重试封顶（会话被删的
  // 持续 404 不再无限打）。
  var streamingRef = useRef(false);
  var mountedRef = useRef(true);
  var reattachTimerRef = useRef(null);
  var reattachAttemptsRef = useRef(0);

  // ── Runner Config ──
  var _sSB = useState(true),
    cfgSandbox = _sSB[0],
    setCfgSandbox = _sSB[1];
  var _sES = useState(true),
    cfgSession = _sES[0],
    setCfgSession = _sES[1];
  var _sTD = useState(true),
    cfgTodolist = _sTD[0],
    setCfgTodolist = _sTD[1];
  var _sEC = useState(true),
    cfgCommands = _sEC[0],
    setCfgCommands = _sEC[1];
  var _sBShell = useState(true),
    cfgBShell = _sBShell[0],
    setCfgBShell = _sBShell[1];
  var _sBWS = useState(true),
    cfgBWebSearch = _sBWS[0],
    setCfgBWebSearch = _sBWS[1];
  var _sBWF = useState(true),
    cfgBWebFetch = _sBWF[0],
    setCfgBWebFetch = _sBWF[1];
  var _sBPy = useState(true),
    cfgBPython = _sBPy[0],
    setCfgBPython = _sBPy[1];
  var _sBGit = useState(true),
    cfgBGit = _sBGit[0],
    setCfgBGit = _sBGit[1];
  var _sBFileRead = useState(true),
    cfgBFileRead = _sBFileRead[0],
    setCfgBFileRead = _sBFileRead[1];
  var _sBFileWrite = useState(true),
    cfgBFileWrite = _sBFileWrite[0],
    setCfgBFileWrite = _sBFileWrite[1];
  var _sBFileEdit = useState(true),
    cfgBFileEdit = _sBFileEdit[0],
    setCfgBFileEdit = _sBFileEdit[1];
  var _sBGlob = useState(true),
    cfgBGlob = _sBGlob[0],
    setCfgBGlob = _sBGlob[1];
  var _sBGrep = useState(true),
    cfgBGrep = _sBGrep[0],
    setCfgBGrep = _sBGrep[1];
  var _sA2ui = useState(false),
    cfgA2ui = _sA2ui[0],
    setCfgA2ui = _sA2ui[1];
  var _sSkillDirs = useState(''),
    cfgSkillDirs = _sSkillDirs[0],
    setCfgSkillDirs = _sSkillDirs[1];
  var _sMcpPaths = useState(''),
    cfgMcpPaths = _sMcpPaths[0],
    setCfgMcpPaths = _sMcpPaths[1];
  var _sCfgOpen = useState(true),
    configOpen = _sCfgOpen[0],
    setConfigOpen = _sCfgOpen[1];
  var _sAdvOpen = useState(false),
    advOpen = _sAdvOpen[0],
    setAdvOpen = _sAdvOpen[1];

  // ── AskHuman ──
  var _sAskId = useState(''),
    askRequestId = _sAskId[0],
    setAskRequestId = _sAskId[1];
  var _sAskResp = useState(''),
    askResponse = _sAskResp[0],
    setAskResponse = _sAskResp[1];

  // ── Right Panel ──
  var _sRTab = useState('events'),
    rightTab = _sRTab[0],
    setRightTab = _sRTab[1];
  var _sEvts = useState([]),
    cockpitEvents = _sEvts[0],
    setCockpitEvents = _sEvts[1];
  var _sDiag = useState(null),
    diagnosticsData = _sDiag[0],
    setDiagnosticsData = _sDiag[1];
  var _sFT = useState([]),
    rightFileTree = _sFT[0],
    setRightFileTree = _sFT[1];
  var _sFP = useState(null),
    rightFilePath = _sFP[0],
    setRightFilePath = _sFP[1];
  var _sFC = useState(''),
    rightFileContent = _sFC[0],
    setRightFileContent = _sFC[1];
  var _sRSS = useState(''),
    rightSaveStatus = _sRSS[0],
    setRightSaveStatus = _sRSS[1];
  var cockpitEsRef = useRef(null);
  var evtLogRef = useRef(null);

  // ── Helpers ──
  function formatTokens(n) {
    if (!n) return '—';
    if (n >= 1000) return Math.round(n / 1000) + 'K';
    return String(n);
  }

  function fetchModelInfo(modelId) {
    if (!modelId || !modelId.trim()) {
      setModelInfo(null);
      return;
    }
    api
      .get('/api/models/' + encodeURIComponent(modelId.trim()) + '/metadata')
      .then(function (info) {
        setModelInfo(info);
      })
      .catch(function () {
        setModelInfo(null);
      });
  }

  // ── Effects ──
  useEffect(function () {
    api
      .get('/api/crews')
      .then(function (list) {
        setCrews(Array.isArray(list) ? list : []);
      })
      .catch(function () {
        setCrews([]);
      });
  }, []);

  useEffect(
    function () {
      if (messagesEndRef.current) {
        messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
      }
    },
    [chatLines]
  );

  // Load conversation history when resuming a session, clear when switching away
  useEffect(
    function () {
      if (!resumeSessionId) {
        setChatLines([]);
        return;
      }
      var cancelled = false;
      api
        .get('/api/chat/' + resumeSessionId + '/messages')
        .then(function (res) {
          if (cancelled) return;
          if (res && res.messages && res.messages.length > 0) {
            var historyLines = res.messages.map(function (entry) {
              return sessionEntryToChatLine(entry);
            });
            setChatLines(historyLines);
            setTimeout(function () {
              if (messagesEndRef.current) messagesEndRef.current.scrollIntoView();
            }, 50);
          }
        })
        .catch(function () {
          // Silently fail — empty chat is acceptable
        });
      return function () {
        cancelled = true;
      };
    },
    [resumeSessionId]
  );

  var prevEvtLenRef = useRef(0);
  useEffect(
    function () {
      if (!evtLogRef.current) return;
      if (cockpitEvents.length > prevEvtLenRef.current) {
        evtLogRef.current.scrollTop = evtLogRef.current.scrollHeight;
      }
      prevEvtLenRef.current = cockpitEvents.length;
    },
    [cockpitEvents]
  );

  // 卸载守卫（返修 P2-1）：组件卸载后未决的兜底定时器不得再触发重挂。
  useEffect(function () {
    return function () {
      mountedRef.current = false;
    };
  }, []);

  useEffect(
    function () {
      sessionIdRef.current = sessionId;
    },
    [sessionId]
  );

  /** 诊断快照拉取：GET /api/chat/:id 一次性 JSON（温/冷两态，404 静默）。 */
  function refreshDiagnostics(sid) {
    api
      .get('/api/chat/' + encodeURIComponent(sid))
      .then(setDiagnosticsData)
      .catch(function () {
        setDiagnosticsData(null);
      });
  }

  useEffect(
    function () {
      if (cockpitEsRef.current) {
        cockpitEsRef.current.close();
        cockpitEsRef.current = null;
      }

      if (!sessionId) {
        closeEvents();
        setCockpitEvents([]);
        setDiagnosticsData(null);
        setRightFileTree([]);
        setRightFilePath(null);
        setRightFileContent('');
        return;
      }

      // 常驻 events 流（R2P-153）：会话确定即挂；crew 创建轮帧从此流进
      // （统一端点 ack 化）。session-title 等轮外帧同流到达（agent-state
      // 专用流已退役）。
      ensureEvents(sessionId, 'live');

      // 诊断快照（对齐 Rust StatePage）：建连即拉一次，done 帧自动刷新。
      refreshDiagnostics(sessionId);

      api
        .get('/api/sessions/' + sessionId + '/files/tree')
        .then(function (data) {
          setRightFileTree(Array.isArray(data) ? data : data ? [data] : []);
        })
        .catch(function () {
          setRightFileTree([]);
        });

      return function () {
        if (cockpitEsRef.current) {
          cockpitEsRef.current.close();
          cockpitEsRef.current = null;
        }
        // 卸载/换会话收束常驻流与未决兜底定时器（返修 P2-1）。
        closeEvents();
      };
    },
    [sessionId]
  );

  // ── Chat Functions ──
  // token / think accumulate into the previous line of the same tag.
  // subagent-token:<name> / subagent-think:<name> are namespaced per
  // sub-agent so multiple workers streaming concurrently don't tangle,
  // AND each namespaced tag accumulates so a single sub-agent's stream
  // forms one bubble rather than one line per token.
  function isAccumulatingTag(tag) {
    return (
      tag === 'token' ||
      tag === 'think' ||
      tag.indexOf('subagent-token:') === 0 ||
      tag.indexOf('subagent-think:') === 0
    );
  }

  function appendLine(tag, text) {
    setChatLines(function (prev) {
      if (isAccumulatingTag(tag) && prev.length > 0 && prev[prev.length - 1].tag === tag) {
        var last = prev[prev.length - 1];
        return prev.slice(0, -1).concat([{ tag: tag, text: last.text + text, id: last.id }]);
      }
      return prev.concat([{ tag: tag, text: text, id: Date.now() + Math.random() }]);
    });
  }

  function appendCockpitEvent(ev, tag, text, data) {
    setCockpitEvents(function (prev) {
      return prev.concat([
        {
          type: ev,
          tag: tag,
          text: text,
          data: data,
          id: Date.now() + Math.random(),
        },
      ]);
    });
  }

  // 经会话通道到达的轮外观测帧（原 agent-state 专用流退役后与轮帧同流）。
  var COCKPIT_EVENTS = [
    'session-title',
    'session-cleared',
    'subagent-start',
    'subagent-end',
    'subagent-delivery',
    'compressed',
    'run-resumed',
    'human-input-resolved',
  ];

  function handleStreamEvent(ev, data) {
    try {
      var p = typeof data === 'string' ? JSON.parse(data) : data;
      if (ev === 'session-start') {
        setSessionId(p.sessionId);
      }
      if (ev === 'done') {
        updateStreaming(false);
        // done 帧到达自动刷新诊断快照（对齐 Rust StatePage）。
        if (sessionIdRef.current) refreshDiagnostics(sessionIdRef.current);
      } else if (ev === 'error') {
        updateStreaming(false);
      }
      var tag = eventToTag(ev);
      var text = formatEventData(ev, p);

      if (tag === 'token') {
        appendLine('token', text);
      } else if (tag === 'think') {
        appendLine('think', text);
      } else if (ev === 'error') {
        appendLine('error', text);
      } else if (COCKPIT_EVENTS.indexOf(ev) !== -1) {
        appendCockpitEvent(ev, tag, text, p);
      } else if (ev === 'subagent-token') {
        // Namespace per sub-agent name so each worker gets its own bubble.
        // Falls back to 'subagent' when name missing (shouldn't happen).
        var name = p.subagentName || p.name || 'subagent';
        appendLine('subagent-token:' + name, text);
      } else if (ev === 'subagent-thinking') {
        var thinkName = p.subagentName || p.name || 'subagent';
        appendLine('subagent-think:' + thinkName, text);
      } else if (ev === 'subagent-tool-start') {
        var toolName = p.subagentName || p.name || 'subagent';
        appendLine('tool-call', '[' + toolName + '] ' + text);
      } else if (ev === 'subagent-tool-end') {
        var toolEndName = p.subagentName || p.name || 'subagent';
        appendLine('tool-result', '[' + toolEndName + '] ' + text);
      } else if (ev === 'subagent-start') {
        appendLine('session', text);
      } else if (ev === 'subagent-end') {
        appendLine('session', text);
      }
    } catch (_) {}
  }

  // ── 常驻 events 流接线（R2P-153，send ack 化的客户端面）──

  /** streaming 状态 + ref 镜像双写（返修 P2-1：定时器回调读 ref 拿现值）。 */
  function updateStreaming(v) {
    streamingRef.current = v;
    setStreaming(v);
  }

  /** 常驻流收束（返修 P2-1）：关柄 + 摘未决兜底定时器（卸载/换会话）。 */
  function closeEvents() {
    if (reattachTimerRef.current) {
      clearTimeout(reattachTimerRef.current);
      reattachTimerRef.current = null;
    }
    if (eventsRef.current && eventsRef.current.handle) eventsRef.current.handle.close();
    eventsRef.current = null;
  }

  /**
   * 全 transport 的帧收口：data.seq 是会话内全序（POST 创建流、respond
   * 流、events 常驻流共享同一空间）——按它去重后进 UI 状态机。没有 seq
   * 的帧（session-start 等合成帧）只有单一 transport，直通。
   */
  function ingestFrame(ev, data) {
    var p = data;
    if (typeof data === 'string') {
      try {
        p = JSON.parse(data);
      } catch (_) {
        p = data; // 非 JSON 载荷原样进状态机（handleStreamEvent 自带兜底）
      }
    }
    if (p && typeof p === 'object' && typeof p.seq === 'number') {
      if (p.seq <= lastSeqRef.current) return;
      lastSeqRef.current = p.seq;
    }
    handleStreamEvent(ev, p);
  }

  /**
   * 挂/复用会话的常驻 events 订阅（同 sid 且柄存活时幂等；换 sid 关旧流）。
   * mode:
   *  - 'live'   （默认）预挂——见过帧则从断点续传（重放段早于断点）；
   *             没见过帧（resume 旧会话，历史已从磁盘读入）以 lastSeq=0
   *             建连但抑制重放段投递（history-end 分界前不进状态机），
   *             避免滚动历史把旧轮帧重复进对话区；
   *  - 'replay' 要重放——冷首发（会话被 POST 物化后）补 ack 与挂流之间
   *             已发生的帧：lastSeq=0 全量重放（此刻滚动历史恰为本轮），
   *             或断点续传（见过帧的重挂场景）。
   * 挂流失败（冷会话 404）是预期路径：柄作废后由 sendAck 的 ack 成功分支
   * 以 'replay' 重挂（ack 返回时会话已被物化，重挂确定性成功）；ack 未回
   * 期间的失败由 onError 的兜底重试（带延迟防 404 紧循环）接管。
   */
  function ensureEvents(sid, mode) {
    if (eventsRef.current && eventsRef.current.sid === sid && eventsRef.current.handle) return;
    if (eventsRef.current && eventsRef.current.handle) eventsRef.current.handle.close();
    // lastSeq 必须是真实见过的 seq——服务端的直播守卫同样从它起步，大数
    // 哨兵会把直播帧一并门掉。「没见过帧的预挂」改用 suppressReplay：重放
    // 段（磁盘已对账的过去）不投递，history-end 分界后的直播照常。
    var initial = lastSeqRef.current;
    var suppressReplay = mode !== 'replay' && lastSeqRef.current === 0;
    var me = null;
    var handle = openEventsStream(
      sid,
      {
        onOpen: function () {
          if (eventsRef.current && eventsRef.current.handle === me) {
            eventsRef.current.open = true;
            // 成功挂上即重置兜底预算（返修 P2-1：每次成功建连都是新回合）。
            reattachAttemptsRef.current = 0;
          }
        },
        onFrame: function (f) {
          ingestFrame(f.event, f.data);
        },
        onError: function () {
          // 柄失效（冷会话 404 等）——只处理「本柄仍是当前柄」的失效
          // （ack 分支可能已换成新柄）。错误本身不进对话区（POST 的
          // ack/错误码才是权威）。兜底重挂交给 scheduleReattach（返修
          // P2-1：判活读 ref 现值 + 次数封顶 + 可被卸载清理摘除）。
          if (eventsRef.current && eventsRef.current.handle === me) {
            eventsRef.current = { sid: sid, handle: null, open: false };
            scheduleReattach(sid);
          }
        },
        onTerminal: function () {
          // session-evicted：seq 空间已随旧会话对象终结，本柄作废。
          if (eventsRef.current && eventsRef.current.handle === me) {
            eventsRef.current = { sid: sid, handle: null, open: false };
          }
        },
      },
      { lastSeq: initial, suppressReplay: suppressReplay }
    );
    me = handle;
    eventsRef.current = { sid: sid, handle: handle, open: false };
  }

  /**
   * 挂流失败的有界兜底重挂（返修 P2-1）：只在发送在飞（ack 可能仍未
   * 回、帧需要补）时重试——判活读 streamingRef/mountedRef 的现值；连续
   * 失败 5 次终态放弃（会话被删的持续 404 不再打）；定时器句柄留在 ref
   * 上，卸载/换会话由 closeEvents 摘除。ack 成功分支的重挂先到则空转。
   */
  function scheduleReattach(sid) {
    if (!mountedRef.current) return;
    if (reattachTimerRef.current) return;
    if (reattachAttemptsRef.current >= 5) return;
    reattachAttemptsRef.current += 1;
    reattachTimerRef.current = setTimeout(function () {
      reattachTimerRef.current = null;
      if (!mountedRef.current) return;
      if (!streamingRef.current) return;
      if (eventsRef.current && eventsRef.current.sid === sid && eventsRef.current.handle) {
        return;
      }
      ensureEvents(sid, 'replay');
    }, 400);
  }

  /**
   * ack 语义发送（R2P-153）：先挂流再 POST（订阅早于发送，本轮帧全走
   * 直播——对齐 Rust e2e drive_turn 的次序纪律）；POST 只取 ack/错误码，
   * 轮帧与错误 error 帧全部从常驻 events 流进状态机。本轮完结的客户端
   * 判据是流上的 done 帧：服务端 busy 串行化保证一轮一 done，任意 done
   * 即本轮（返修 P3-2 注释对齐——done 帧 wire 上带 turnSeq，按
   * data.turnSeq === ack.turnSeq 的精确认领留作后续强化）。
   */
  function sendAck(sid, body) {
    updateStreaming(true);
    // 新的用户发送 = 新的兜底回合（返修 P2-1）。
    reattachAttemptsRef.current = 0;
    ensureEvents(sid, 'live');
    fetch(BASE + '/api/chat/' + encodeURIComponent(sid), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
      .then(function (res) {
        return res
          .json()
          .catch(function () {
            return { error: 'HTTP ' + res.status };
          })
          .then(function (ack) {
            return { ok: res.ok, ack: ack };
          });
      })
      .then(function (r) {
        if (!r.ok) {
          appendLine('error', JSON.stringify(r.ack));
          updateStreaming(false);
          return;
        }
        // ack 成功：若预挂流在冷会话上 404 了，此刻会话已被 POST 物化——
        // 以 'replay' 重挂补本轮早帧（ack 与挂流之间的帧经建连重放到达）。
        ensureEvents(sid, 'replay');
      })
      .catch(function (e) {
        if (e && e.name !== 'AbortError') {
          appendLine('error', 'Connection error: ' + e.message);
        }
        updateStreaming(false);
      });
  }

  function buildRunnerConfig() {
    var config = {
      sandbox: cfgSandbox,
      session: { enabled: cfgSession },
      todolist: { enabled: cfgTodolist },
      commands: { enabled: cfgCommands },
      tools: {
        builtinFilter: {
          shell: cfgBShell,
          webSearch: cfgBWebSearch,
          webFetch: cfgBWebFetch,
          python: cfgBPython,
          git: cfgBGit,
          fileRead: cfgBFileRead,
          fileWrite: cfgBFileWrite,
          fileEdit: cfgBFileEdit,
          glob: cfgBGlob,
          grep: cfgBGrep,
        },
      },
      a2ui: { enabled: cfgA2ui },
    };
    if (cfgSkillDirs.trim()) {
      config.skills = {
        dirs: cfgSkillDirs
          .split(',')
          .map(function (s) {
            return s.trim();
          })
          .filter(Boolean),
      };
    }
    if (cfgMcpPaths.trim()) {
      config.tools.mcpConfigPaths = cfgMcpPaths
        .split(',')
        .map(function (s) {
          return s.trim();
        })
        .filter(Boolean);
    }
    return config;
  }

  function doStream(url, body) {
    if (chatCtrlRef.current) chatCtrlRef.current.abort();
    var ctrl = new AbortController();
    chatCtrlRef.current = ctrl;
    updateStreaming(true);

    fetch(BASE + url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    })
      .then(function (res) {
        if (!res.ok) {
          return res
            .json()
            .catch(function () {
              return { error: res.statusText };
            })
            .then(function (err) {
              appendLine('error', JSON.stringify(err));
              updateStreaming(false);
            });
        }
        var reader = res.body.getReader();
        var dec = new TextDecoder();
        var buf = '';
        var ev = '';
        var data = '';

        function processChunk() {
          return reader.read().then(function (_ref) {
            var done = _ref.done;
            var value = _ref.value;
            if (done) {
              updateStreaming(false);
              return;
            }
            buf += dec.decode(value, { stream: true });
            var lines = buf.split('\n');
            buf = lines.pop() || '';
            for (var i = 0; i < lines.length; i++) {
              var line = lines[i];
              if (line.startsWith('event: ')) {
                ev = line.slice(7);
              } else if (line.startsWith('data: ')) {
                data = line.slice(6);
              } else if (line === '' && ev && data) {
                // 经 ingest 收口：POST 流的帧与常驻 events 流同 seq 空间，
                // 去重后进状态机（两路同帧只记一次）。
                ingestFrame(ev, data);
                ev = '';
                data = '';
              }
            }
            return processChunk();
          });
        }
        return processChunk();
      })
      .catch(function (e) {
        if (e.name !== 'AbortError') {
          appendLine('error', 'Connection error: ' + e.message);
        }
        updateStreaming(false);
      });
  }

  function sendMessage() {
    if (!message.trim()) return;
    var msg = message;
    var perRequestModel = msgModel.trim() || undefined;

    if (sessionId) {
      // Continue active session (session-keyed, shared with agent chat)
      appendLine('user', msg);
      // R2P-153：续发走 ack 语义——帧从常驻 events 流进（doStream 的
      // send-即流旧轨不再使用；创建端点仍是 POST 流）。
      sendAck(sessionId, {
        message: msg,
        thinkingEnabled: msgThinking,
        model: perRequestModel,
      });
    } else if (resumeSessionId) {
      setSessionId(resumeSessionId);
      appendLine('user', msg);
      sendAck(resumeSessionId, {
        message: msg,
        thinkingEnabled: msgThinking,
        model: perRequestModel,
      });
    } else if (selectedCrew && workspacePath) {
      // New crew session：统一发送端点首次即建（POST /api/chat/:id 带
      // crew 字段 + client 生成的 sessionId，ack 语义——对齐 Rust
      // 65732f3/c48fda0 的 startCrewChat；/api/crews/:id/chat 已并入）。
      var crewSid =
        typeof crypto !== 'undefined' && crypto.randomUUID
          ? crypto.randomUUID()
          : 'crew-' + Date.now() + '-' + Math.random().toString(36).slice(2);
      setCockpitEvents([]);
      appendLine('user', msg);
      setSessionId(crewSid);
      sendAck(crewSid, {
        message: msg,
        workspacePath: workspacePath,
        crew: selectedCrew,
        sessionId: crewSid,
        thinkingEnabled: msgThinking,
        model: perRequestModel,
        config: buildRunnerConfig(),
      });
    } else {
      appendLine('error', 'Select a crew and set workspace path to start.');
      return;
    }
    setMessage('');
  }

  function stopChat() {
    if (chatCtrlRef.current) chatCtrlRef.current.abort();
    if (sessionId) api.post('/api/chat/' + sessionId + '/stop');
    updateStreaming(false);
  }

  function sendAskResponse() {
    if (!sessionId || !askRequestId || !askResponse) return;
    api
      .post('/api/chat/' + sessionId + '/respond', {
        requestId: askRequestId,
        response: askResponse,
      })
      .then(function (res) {
        appendLine('session', 'Responded: ' + JSON.stringify(res));
        setAskRequestId('');
        setAskResponse('');
      });
  }

  function openRightFile(path) {
    setRightFilePath(path);
    api
      .get('/api/sessions/' + sessionId + '/files/content?path=' + encodeURIComponent(path))
      .then(function (res) {
        if (typeof res === 'object' && res.content) {
          setRightFileContent(res.content);
        } else {
          setRightFileContent(typeof res === 'string' ? res : JSON.stringify(res, null, 2));
        }
      })
      .catch(function () {
        setRightFileContent('Error loading file.');
      });
  }

  function saveRightFile() {
    if (!sessionId || !rightFilePath) return;
    setRightSaveStatus('saving...');
    api
      .put('/api/sessions/' + sessionId + '/files/content', {
        path: rightFilePath,
        content: rightFileContent,
      })
      .then(function (res) {
        if (res && res.error) {
          setRightSaveStatus('Error: ' + res.error);
        } else {
          setRightSaveStatus('Saved');
          setTimeout(function () {
            setRightSaveStatus('');
          }, 2000);
        }
      })
      .catch(function () {
        setRightSaveStatus('Error: save failed');
      });
  }

  return {
    // Crews
    crews,
    selectedCrew,
    setSelectedCrew,
    workspacePath,
    setWorkspacePath,

    // Message
    message,
    setMessage,
    msgThinking,
    setMsgThinking,
    msgModel,
    setMsgModel,
    modelInfo,
    formatTokens,
    fetchModelInfo,

    // Session
    sessionId,
    setSessionId,
    resumeSessionId,
    setResumeSessionId,

    // Chat
    chatLines,
    setChatLines,
    streaming,
    setStreaming,
    sendMessage,
    stopChat,

    // Refs
    messagesEndRef,

    // Config
    configOpen,
    setConfigOpen,
    advOpen,
    setAdvOpen,
    cfgSandbox,
    setCfgSandbox,
    cfgSession,
    setCfgSession,
    cfgTodolist,
    setCfgTodolist,
    cfgCommands,
    setCfgCommands,
    cfgBShell,
    setCfgBShell,
    cfgBWebSearch,
    setCfgBWebSearch,
    cfgBWebFetch,
    setCfgBWebFetch,
    cfgBPython,
    setCfgBPython,
    cfgBGit,
    setCfgBGit,
    cfgBFileRead,
    setCfgBFileRead,
    cfgBFileWrite,
    setCfgBFileWrite,
    cfgBFileEdit,
    setCfgBFileEdit,
    cfgBGlob,
    setCfgBGlob,
    cfgBGrep,
    setCfgBGrep,
    cfgA2ui,
    setCfgA2ui,
    cfgSkillDirs,
    setCfgSkillDirs,
    cfgMcpPaths,
    setCfgMcpPaths,

    // AskHuman
    askRequestId,
    setAskRequestId,
    askResponse,
    setAskResponse,
    sendAskResponse,

    // Right Panel
    rightTab,
    setRightTab,
    cockpitEvents,
    diagnosticsData,
    rightFileTree,
    rightFilePath,
    rightFileContent,
    rightSaveStatus,
    openRightFile,
    saveRightFile,
    setRightFileContent,
    evtLogRef,
  };
}
