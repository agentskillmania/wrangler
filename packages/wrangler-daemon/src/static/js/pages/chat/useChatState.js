/* eslint-disable */
// ── Hook: useChatState ──
// Manages all state and business logic for the ChatPage.

import { useState, useEffect, useRef } from '../../utils.js';
import { api } from '../../api.js';
import { eventToTag, formatEventData } from './EventCard.js';
import { sessionEntryToChatLine } from '../../helpers/sessionEntryToChatLine.js';

var BASE = location.origin;

export function useChatState() {
  // ── Agents ──
  var _sAg = useState([]),
    agents = _sAg[0],
    setAgents = _sAg[1];

  // ── Selection ──
  var _sSA = useState(''),
    selectedAgent = _sSA[0],
    setSelectedAgent = _sSA[1];
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
      .get('/api/agents')
      .then(function (list) {
        setAgents(Array.isArray(list) ? list : []);
      })
      .catch(function () {
        setAgents([]);
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
      api.get('/api/chat/' + resumeSessionId + '/messages').then(function (res) {
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
      }).catch(function () {
        // Silently fail — empty chat is acceptable
      });
      return function () { cancelled = true; };
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

  useEffect(
    function () {
      if (cockpitEsRef.current) {
        cockpitEsRef.current.close();
        cockpitEsRef.current = null;
      }

      if (!sessionId) {
        setCockpitEvents([]);
        setDiagnosticsData(null);
        setRightFileTree([]);
        setRightFilePath(null);
        setRightFileContent('');
        return;
      }

      var es = new EventSource(BASE + '/api/agent/' + sessionId + '/state');
      es.addEventListener('agent-diagnostics', function (e) {
        try {
          setDiagnosticsData(JSON.parse(e.data));
        } catch (_) {}
      });
      es.onmessage = function (e) {
        try {
          var parsed = JSON.parse(e.data);
          var evtType = parsed.event || parsed.type || 'message';
          var data = parsed.data || parsed;
          var tag = eventToTag(evtType);
          var text = formatEventData(evtType, data);
          appendCockpitEvent(evtType, tag, text, data);
        } catch (_) {
          setCockpitEvents(function (prev) {
            return prev.concat([
              {
                type: 'raw',
                tag: 'step',
                text: e.data,
                data: { raw: e.data },
                id: Date.now() + Math.random(),
              },
            ]);
          });
        }
      };
      es.onerror = function () {};
      cockpitEsRef.current = es;

      api
        .get('/api/files/' + sessionId + '/tree')
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
      };
    },
    [sessionId]
  );

  // ── Chat Functions ──
  var ACCUMULATE_TAGS = { token: true, think: true };

  function appendLine(tag, text) {
    setChatLines(function (prev) {
      if (ACCUMULATE_TAGS[tag] && prev.length > 0 && prev[prev.length - 1].tag === tag) {
        var last = prev[prev.length - 1];
        return prev
          .slice(0, -1)
          .concat([{ tag: tag, text: last.text + text, id: last.id }]);
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

  function handleStreamEvent(ev, data) {
    try {
      var p = typeof data === 'string' ? JSON.parse(data) : data;
      if (ev === 'session-start') {
        setSessionId(p.sessionId);
      }
      if (ev === 'done') {
        setStreaming(false);
      } else if (ev === 'error') {
        setStreaming(false);
      }
      var tag = eventToTag(ev);
      var text = formatEventData(ev, p);

      if (tag === 'token') {
        appendLine('token', text);
      } else if (tag === 'think') {
        appendLine('think', text);
      } else if (ev === 'error') {
        appendLine('error', text);
      }
    } catch (_) {}
  }

  function buildRunnerConfig() {
    var result = {
      sandbox: cfgSandbox,
      enableSession: cfgSession,
      enableTodolist: cfgTodolist,
      enableCommands: cfgCommands,
      builtinTools: {
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
      a2ui: {
        enabled: cfgA2ui,
      },
    };
    if (cfgSkillDirs.trim()) {
      result.skillDirs = cfgSkillDirs
        .split(',')
        .map(function (s) {
          return s.trim();
        })
        .filter(Boolean);
    }
    if (cfgMcpPaths.trim()) {
      result.mcpConfigPaths = cfgMcpPaths
        .split(',')
        .map(function (s) {
          return s.trim();
        })
        .filter(Boolean);
    }
    return result;
  }

  function doStream(url, body) {
    if (chatCtrlRef.current) chatCtrlRef.current.abort();
    var ctrl = new AbortController();
    chatCtrlRef.current = ctrl;
    setStreaming(true);

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
              setStreaming(false);
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
              setStreaming(false);
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
                handleStreamEvent(ev, data);
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
        setStreaming(false);
      });
  }

  function sendMessage() {
    if (!message.trim()) return;
    var msg = message;
    var perRequestModel = msgModel.trim() || undefined;

    if (sessionId) {
      appendLine('user', msg);
      doStream('/api/chat/' + sessionId, {
        message: msg,
        thinkingEnabled: msgThinking,
        model: perRequestModel,
      });
    } else if (resumeSessionId) {
      setSessionId(resumeSessionId);
      appendLine('user', msg);
      doStream('/api/chat/' + resumeSessionId, {
        message: msg,
        thinkingEnabled: msgThinking,
        model: perRequestModel,
      });
    } else if (selectedAgent && workspacePath) {
      setCockpitEvents([]);
      appendLine('user', msg);
      doStream('/api/agents/' + selectedAgent + '/chat', {
        message: msg,
        workspacePath: workspacePath,
        thinkingEnabled: msgThinking,
        model: perRequestModel,
        config: buildRunnerConfig(),
      });
    } else {
      appendLine('error', 'Select an agent and set workspace path to start.');
      return;
    }
    setMessage('');
  }

  function stopChat() {
    if (chatCtrlRef.current) chatCtrlRef.current.abort();
    if (sessionId) api.post('/api/chat/' + sessionId + '/stop');
    setStreaming(false);
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
      .get('/api/files/' + sessionId + '/content?path=' + encodeURIComponent(path))
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
      .put('/api/files/' + sessionId + '/content', {
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
    // Agents
    agents,
    selectedAgent,
    setSelectedAgent,
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
