/* eslint-disable */
// ── Wrangler Daemon Playground ──
// Single-file Preact application for daemon management.
// Dependencies: preact, preactHooks, htm, JSONFormatter, CodeMirror (loaded as globals)

'use strict';

// ── Preact + HTM Bootstrap ──
var preactRef = preact;
var h = preactRef.h;
var render = preactRef.render;
var useState = preactHooks.useState;
var useEffect = preactHooks.useEffect;
var useRef = preactHooks.useRef;
var useCallback = preactHooks.useCallback;
var useMemo = preactHooks.useMemo;
var html = htm.bind(h);

// ── API Helper ──
var BASE = location.origin;

var api = {
  get: function (path) {
    return fetch(BASE + path).then(function (res) {
      var ct = res.headers.get('content-type') || '';
      return ct.includes('json') ? res.json() : res.text();
    });
  },
  post: function (path, body) {
    return fetch(BASE + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).then(function (res) {
      var ct = res.headers.get('content-type') || '';
      return ct.includes('json') ? res.json() : res.text();
    });
  },
  put: function (path, body) {
    return fetch(BASE + path, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).then(function (res) {
      var ct = res.headers.get('content-type') || '';
      return ct.includes('json') ? res.json() : res.text();
    });
  },
  patch: function (path, body) {
    return fetch(BASE + path, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).then(function (res) {
      var ct = res.headers.get('content-type') || '';
      return ct.includes('json') ? res.json() : res.text();
    });
  },
  del: function (path, body) {
    var opts = { method: 'DELETE', headers: {} };
    if (body !== undefined) {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }
    return fetch(BASE + path, opts).then(function (res) {
      var ct = res.headers.get('content-type') || '';
      return ct.includes('json') ? res.json() : res.text();
    });
  },
};

// ── Utility: escape HTML ──
function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ── Shared Component: StatePanel ──
// Structured display of unified agent diagnostics (runner + agent + llm)
function StatePanel(props) {
  var diagnostics = props.diagnostics;
  var runnerConfig = diagnostics && diagnostics.runner;
  var agentState = diagnostics && diagnostics.agent;
  var llmData = diagnostics && diagnostics.llm ? diagnostics.llm : null;
  var llmContext = llmData ? llmData.messages : null;
  var llmTools = llmData ? llmData.tools : null;
  var llmSkill = llmData ? llmData.skill : null;
  var _sOpen = useState({ raw: false, sysprompt: false, llmtools: false, tools: false, skills: false }),
    open = _sOpen[0],
    setOpen = _sOpen[1];

  function toggle(key) {
    setOpen(function (prev) {
      var next = {};
      for (var k in prev) next[k] = prev[k];
      next[key] = !prev[key];
      return next;
    });
  }

  // ── Runner ──
  function renderRunner() {
    if (!runnerConfig || typeof runnerConfig !== 'object') return null;

    return html`
      <div class="sp-card">
        <div class="sp-head">Runner</div>
        <div class="sp-row">
          <div class="sp-label">Model</div>
          <div class="sp-val">${runnerConfig.model || 'default'}</div>
        </div>
        <div class="sp-grid">
          <div class="sp-cell"><div class="sp-label">Sandbox</div><div class="sp-val">${runnerConfig.sandbox ? 'on' : 'off'}</div></div>
          <div class="sp-cell"><div class="sp-label">Session</div><div class="sp-val">${runnerConfig.enableSession !== false ? 'on' : 'off'}</div></div>
          <div class="sp-cell"><div class="sp-label">Todolist</div><div class="sp-val">${runnerConfig.enableTodolist !== false ? 'on' : 'off'}</div></div>
          <div class="sp-cell"><div class="sp-label">Commands</div><div class="sp-val">${runnerConfig.enableCommands !== false ? 'on' : 'off'}</div></div>
          <div class="sp-cell"><div class="sp-label">Thinking</div><div class="sp-val">${runnerConfig.thinkingEnabled !== false ? 'on' : 'off'}</div></div>
          <div class="sp-cell"><div class="sp-label">A2UI</div><div class="sp-val">${runnerConfig.a2ui && runnerConfig.a2ui.enabled ? 'on' : 'off'}</div></div>
        </div>
        <div class="sp-row">
          <div class="sp-label">Builtin Tools</div>
          <div class="sp-val">${(function () {
            var t = runnerConfig.builtinTools;
            if (!t || typeof t !== 'object') return 'all';
            var on = [];
            for (var k in t) { if (t[k]) on.push(k); }
            return on.length ? on.join(', ') : 'all';
          })()}</div>
        </div>
        <div class="sp-row">
          <div class="sp-label">Skill Dirs</div>
          <div class="sp-val">${runnerConfig.skillDirs && runnerConfig.skillDirs.length > 0 ? runnerConfig.skillDirs.length + ' dirs' : 'none'}</div>
        </div>
        <div class="sp-row">
          <div class="sp-label">MCP</div>
          <div class="sp-val">${runnerConfig.mcpConfigPaths && runnerConfig.mcpConfigPaths.length > 0 ? runnerConfig.mcpConfigPaths.length + ' configs' : 'none'}</div>
        </div>
        <div class="sp-grid" style="margin-top:8px">
          <div class="sp-cell"><div class="sp-label">Builtin</div><div class="sp-val">${runnerConfig.builtinToolCount ?? '-'}</div></div>
          <div class="sp-cell"><div class="sp-label">MCP</div><div class="sp-val">${runnerConfig.mcpToolCount ?? '-'}</div></div>
          <div class="sp-cell"><div class="sp-label">Session</div><div class="sp-val">${runnerConfig.sessionToolCount ?? '-'}</div></div>
          <div class="sp-cell"><div class="sp-label">Todolist</div><div class="sp-val">${runnerConfig.todolistToolCount ?? '-'}</div></div>
          <div class="sp-cell"><div class="sp-label">Compression</div><div class="sp-val">${runnerConfig.compressorEnabled ? 'on' : 'off'}</div></div>
          <div class="sp-cell"><div class="sp-label">Middleware</div><div class="sp-val">${(runnerConfig.middlewareNames || []).join(', ') || 'none'}</div></div>
        </div>
      </div>
    `;
  }

  // ── Tool & Skill Registry ──
  function renderRegistries() {
    var tools = diagnostics.tools;
    var skills = diagnostics.skills;
    if ((!tools || tools.length === 0) && (!skills || skills.length === 0)) return null;

    return html`
      <div class="sp-card">
        ${tools && tools.length > 0 ? html`
          <div class="sp-head sp-click" onClick=${function () { toggle('tools'); }}>
            Tools (${tools.length}) ${open.tools ? '▾' : '▸'}
          </div>
          ${open.tools && html`<div class="sp-list">
            ${tools.map(function (t) {
              return html`<div class="sp-list-item">
                <div class="sp-list-name">${t.name}</div>
                <div class="sp-list-desc">${(t.description || '').substring(0, 120)}</div>
              </div>`;
            })}
          </div>`}
        ` : ''}
        ${skills && skills.length > 0 ? html`
          <div class="sp-head sp-click" style="margin-top:6px" onClick=${function () { toggle('skills'); }}>
            Skills (${skills.length}) ${open.skills ? '▾' : '▸'}
          </div>
          ${open.skills && html`<div class="sp-list">
            ${skills.map(function (s) {
              return html`<div class="sp-list-item">
                <div class="sp-list-name">${s.name}</div>
                <div class="sp-list-desc">${(s.description || '').substring(0, 120)}</div>
              </div>`;
            })}
          </div>`}
        ` : ''}
      </div>
    `;
  }

  // ── Agent ──
  function renderAgent() {
    if (!agentState || typeof agentState !== 'object') return null;
    var name = agentState.name || (agentState.config && agentState.config.name) || 'Untitled';
    var instr = agentState.config && agentState.config.instructions
      ? String(agentState.config.instructions)
      : '';

    return html`
      <div class="sp-card">
        <div class="sp-head">Agent</div>
        <div class="sp-row">
          <div class="sp-label">Name</div>
          <div class="sp-val">${name}</div>
        </div>
        ${instr && html`
          <div class="sp-row">
            <div class="sp-label">Instructions</div>
            <div class="sp-pre">${instr}</div>
          </div>
        `}
      </div>
    `;
  }

  // ── Context + LLM (merged) ──
  function renderContextAndLLM() {
    // Agent context state
    var ctx = (agentState && agentState.context) || {};
    var msgs = ctx.messages || [];
    var msgCount = msgs.length;
    var todoItems = ctx.todoList && ctx.todoList.items ? ctx.todoList.items.length : 0;
    var activeSkill = ctx.skillState && ctx.skillState.current ? ctx.skillState.current : 'none';
    var compression = ctx.compression;
    var compressionText = compression && compression.summary
      ? compression.anchor + ' msgs summarized'
      : 'none';

    // LLM request snapshot
    var llmMsgCount = Array.isArray(llmContext) ? llmContext.length : 0;
    var llmToolCount = Array.isArray(llmTools) ? llmTools.length : 0;
    var systemMsg = Array.isArray(llmContext) && llmContext.length > 0 ? llmContext[0] : null;
    var systemPrompt = systemMsg && systemMsg.content ? String(systemMsg.content) : '';

    return html`
      <div class="sp-card">
        <div class="sp-head">Context</div>

        <div class="sp-grid">
          <div class="sp-cell">
            <div class="sp-label">State Msgs</div>
            <div class="sp-val">${msgCount}</div>
          </div>
          <div class="sp-cell">
            <div class="sp-label">LLM Msgs</div>
            <div class="sp-val">${llmMsgCount}</div>
          </div>
          <div class="sp-cell">
            <div class="sp-label">Todo</div>
            <div class="sp-val">${todoItems}</div>
          </div>
          <div class="sp-cell">
            <div class="sp-label">Active Skill</div>
            <div class="sp-val">${activeSkill}</div>
          </div>
          <div class="sp-cell">
            <div class="sp-label">LLM Tools</div>
            <div class="sp-val">${llmToolCount}</div>
          </div>
          <div class="sp-cell">
            <div class="sp-label">LLM Skill</div>
            <div class="sp-val">${llmSkill || 'none'}</div>
          </div>
          <div class="sp-cell">
            <div class="sp-label">Compression</div>
            <div class="sp-val">${compressionText}</div>
          </div>
        </div>

        ${systemPrompt && html`
          <div class="sp-head sp-click" style="margin-top:8px" onClick=${function () { toggle('sysprompt'); }}>
            System Prompt ${open.sysprompt ? '▾' : '▸'}
          </div>
          ${open.sysprompt && html`<div class="sp-pre">${systemPrompt}</div>`}
        `}

        ${llmTools && html`
          <div class="sp-head sp-click" style="margin-top:6px" onClick=${function () { toggle('llmtools'); }}>
            LLM Tool Schemas ${open.llmtools ? '▾' : '▸'}
          </div>
          ${open.llmtools && html`<${JsonTree} data=${llmTools} open=${1} />`}
        `}

        <div class="sp-head sp-click" style="margin-top:6px" onClick=${function () { toggle('raw'); }}>
          Raw State ${open.raw ? '▾' : '▸'}
        </div>
        ${open.raw && html`<${JsonTree} data=${agentState} open=${1} />`}

        ${llmContext && html`
          <div class="sp-head sp-click" style="margin-top:6px" onClick=${function () { toggle('raw'); }}>
            LLM Messages ${open.raw ? '▾' : '▸'}
          </div>
          ${open.raw && html`<${JsonTree} data=${llmContext} open=${1} />`}
        `}
      </div>
    `;
  }

  return html`
    <div class="state-panel">
      ${renderRunner()}
      ${renderRegistries()}
      ${renderAgent()}
      ${renderContextAndLLM()}
    </div>
  `;
}

// ── Shared Component: JsonTree ──
// Thin wrapper around json-formatter-js. Mounts into a ref'd container.
function JsonTree(props) {
  var containerRef = useRef(null);
  var data = props.data;
  var open = props.open || 1;

  useEffect(
    function () {
      if (!containerRef.current || data === undefined || data === null) return;
      containerRef.current.innerHTML = '';
      try {
        var formatter = new window.JSONFormatter(data, open, { theme: 'dark' });
        containerRef.current.appendChild(formatter.render());
      } catch (e) {
        containerRef.current.textContent = String(data);
      }
    },
    [data, open]
  );

  return html`<div ref=${containerRef} class="json-tree-container" />`;
}

// ── Shared Component: CodeMirrorWrapper ──
// Mounts a CodeMirror 5 instance. Syncs value in (props.value → editor)
// and value out (editor change → props.onChange).
function CodeMirrorWrapper(props) {
  var containerRef = useRef(null);
  var cmRef = useRef(null);
  var value = props.value;
  var onChange = props.onChange;
  var mode = props.mode || 'markdown';
  var readOnly = props.readOnly || false;

  // Create CM instance on mount
  useEffect(function () {
    if (!containerRef.current || !window.CodeMirror) return;
    var cm = window.CodeMirror(containerRef.current, {
      value: value || '',
      mode: mode,
      theme: 'monokai',
      lineNumbers: true,
      lineWrapping: true,
      readOnly: readOnly,
      indentWithTabs: false,
      tabSize: 2,
    });
    cm.on('change', function () {
      if (onChange) onChange(cm.getValue());
    });
    cmRef.current = cm;
    return function () {
      if (cmRef.current) {
        cmRef.current = null;
        containerRef.current.innerHTML = '';
      }
    };
  }, []);

  // Sync external value changes into the editor
  useEffect(
    function () {
      var cm = cmRef.current;
      if (!cm) return;
      if (cm.getValue() !== (value || '')) {
        cm.setValue(value || '');
      }
    },
    [value]
  );

  // Update readOnly when prop changes
  useEffect(
    function () {
      if (cmRef.current) cmRef.current.setOption('readOnly', readOnly);
    },
    [readOnly]
  );

  return html`<div ref=${containerRef} style="flex:1;min-height:200px;overflow:hidden" />`;
}

// ── Shared Component: DetailDrawer ──
// Right sliding panel with title, tabs, and close button.
function DetailDrawer(props) {
  var open = props.open;
  var title = props.title;
  var tabs = props.tabs || [];
  var activeTab = props.activeTab || (tabs[0] && tabs[0].key);
  var onTabChange = props.onTabChange;
  var onClose = props.onClose;
  var children = props.children;
  var _useState = useState(activeTab),
    currentTab = _useState[0],
    setCurrentTab = _useState[1];

  useEffect(
    function () {
      if (activeTab) setCurrentTab(activeTab);
    },
    [activeTab]
  );

  if (!open) return null;

  return html`
    <div>
      <div class="drawer-backdrop" onClick=${onClose} />
      <div class="drawer">
        <div class="drawer-header">
          <h3>${title}</h3>
          <button class="btn btn-ghost btn-sm" onClick=${onClose}>Close</button>
        </div>
        ${tabs.length > 0 &&
        html`
          <div class="drawer-tabs">
            ${tabs.map(
              function (tab) {
                return html`
                  <button
                    key=${tab.key}
                    class=${'drawer-tab' + (currentTab === tab.key ? ' active' : '')}
                    onClick=${function () {
                      setCurrentTab(tab.key);
                      if (onTabChange) onTabChange(tab.key);
                    }}
                  >
                    ${tab.label}
                  </button>
                `;
              }
            )}
          </div>
        `}
        <div class="drawer-body">${children}</div>
      </div>
    </div>
  `;
}

// ── Shared Component: ResourceList ──
// Reusable table with columns, items, onSelect, onCreate.
function ResourceList(props) {
  var columns = props.columns || [];
  var items = props.items || [];
  var onSelect = props.onSelect;
  var onCreate = props.onCreate;
  var onCreateLabel = props.onCreateLabel || 'Create';
  var selectedId = props.selectedId;
  var emptyMessage = props.emptyMessage || 'No items found.';
  var actions = props.actions;

  return html`
    <div>
      <div class="page-toolbar">
        ${onCreate &&
        html`
          <button class="btn btn-primary btn-sm" onClick=${onCreate}>
            + ${onCreateLabel}
          </button>
        `}
      </div>
      <table class="table">
        <thead>
          <tr>
            ${columns.map(
              function (col) {
                return html`
                  <th key=${col.key} style=${col.width ? 'width:' + col.width : ''}>
                    ${col.label}
                  </th>
                `;
              }
            )}
            ${actions &&
            html`<th style="width:120px"></th>`}
          </tr>
        </thead>
        <tbody>
          ${items.length === 0
            ? html`
                <tr class="table-empty">
                  <td colspan=${columns.length + (actions ? 1 : 0)}>${emptyMessage}</td>
                </tr>
              `
            : items.map(
                function (item) {
                  return html`
                    <tr
                      key=${item.id}
                      class=${selectedId === item.id ? 'selected' : ''}
                      onClick=${function () {
                        if (onSelect) onSelect(item);
                      }}
                    >
                      ${columns.map(
                        function (col) {
                          return html`
                            <td key=${col.key} class=${col.mono ? 'mono' : ''}>
                              ${col.render
                                ? col.render(item)
                                : String(item[col.key] || '-')}
                            </td>
                          `;
                        }
                      )}
                      ${actions &&
                      html`
                        <td class="actions">
                          ${actions(item)}
                        </td>
                      `}
                    </tr>
                  `;
                }
              )}
        </tbody>
      </table>
    </div>
  `;
}

// ── Shared Component: FileTree ──
// Recursive directory tree with expand/collapse.
function FileTree(props) {
  var nodes = props.nodes || [];
  var onSelect = props.onSelect;
  var selectedPath = props.selectedPath;

  var _useState2 = useState({}),
    expanded = _useState2[0],
    setExpanded = _useState2[1];

  function toggleDir(path) {
    setExpanded(function (prev) {
      var next = Object.assign({}, prev);
      next[path] = !prev[path];
      return next;
    });
  }

  function renderNode(node, depth) {
    if (!node) return null;
    var isDir = node.type === 'directory' || (node.children && node.children.length > 0);
    var path = node.path || node.name;
    var indent = { paddingLeft: (depth || 0) * 16 + 'px' };

    if (isDir) {
      var isExpanded = expanded[path] !== false;
      return html`
        <div key=${path}>
          <div
            class="ft-item ft-dir"
            style=${indent}
            onClick=${function (e) {
              e.stopPropagation();
              toggleDir(path);
            }}
          >
            ${isExpanded ? '▾' : '▸'} ${node.name}/
          </div>
          <div class=${'ft-children' + (isExpanded ? '' : ' collapsed')}>
            ${(node.children || []).map(
              function (child) {
                return renderNode(child, (depth || 0) + 1);
              }
            )}
          </div>
        </div>
      `;
    }

    return html`
      <div
        key=${path}
        class=${'ft-item ft-file' + (selectedPath === path ? ' selected' : '')}
        style=${indent}
        onClick=${function (e) {
          e.stopPropagation();
          if (onSelect) onSelect(path);
        }}
      >
        ${node.name}
      </div>
    `;
  }

  if (Array.isArray(nodes)) {
    return html`
      <div class="file-tree">
        ${nodes.map(
          function (n) {
            return renderNode(n, 0);
          }
        )}
      </div>
    `;
  }

  return html`<div class="file-tree">${renderNode(nodes, 0)}</div>`;
}

// ── Shared Component: SessionSelector ──
// Fetches sessions from /api/sessions, groups by workspacePath,
// and renders a select with optgroup labels.
function SessionSelector(props) {
  var value = props.value;
  var onChange = props.onChange;
  var placeholder = props.placeholder || 'Choose a session...';
  var _sSess = useState([]),
    sessions = _sSess[0],
    setSessions = _sSess[1];

  // Fetch sessions on mount
  useEffect(function () {
    api.get('/api/sessions').then(function (list) {
      setSessions(Array.isArray(list) ? list : []);
    }).catch(function () {
      setSessions([]);
    });
  }, []);

  // Group sessions by workspacePath
  var groups = {};
  for (var i = 0; i < sessions.length; i++) {
    var s = sessions[i];
    var wp = s.workspacePath || '(unknown workspace)';
    if (!groups[wp]) groups[wp] = [];
    groups[wp].push(s);
  }

  var groupKeys = Object.keys(groups);

  return html`
    <select
      class="input"
      value=${value}
      onChange=${function (e) {
        if (onChange) onChange(e.target.value);
      }}
    >
      <option value="">${placeholder}</option>
      ${groupKeys.map(
        function (gk) {
          return html`
            <optgroup key=${gk} label=${gk}>
              ${groups[gk].map(
                function (sess) {
                  var shortId = sess.id ? sess.id.substring(0, 8) + '...' : '-';
                  var label = (sess.agentName || 'unknown') + ' — ' + shortId;
                  return html`
                    <option key=${sess.id} value=${sess.id}>
                      ${label}
                    </option>
                  `;
                }
              )}
            </optgroup>
          `;
        }
      )}
    </select>
  `;
}

// ── Page: Chat ──
// Three-column layout: left (config), middle (chat), right (events/state/files).
function ChatPage() {
  var _sAg = useState([]),
    agents = _sAg[0],
    setAgents = _sAg[1];
  var _sSA = useState(''),
    selectedAgent = _sSA[0],
    setSelectedAgent = _sSA[1];
  var _sWP = useState('/tmp/foobar'),
    workspacePath = _sWP[0],
    setWorkspacePath = _sWP[1];
  var _sMsg = useState(''),
    message = _sMsg[0],
    setMessage = _sMsg[1];
  var _sDT = useState(false),
    msgThinking = _sDT[0],
    setMsgThinking = _sDT[1];
  var _sSid = useState(''),
    sessionId = _sSid[0],
    setSessionId = _sSid[1];
  var _sCL = useState([]),
    chatLines = _sCL[0],
    setChatLines = _sCL[1];
  var _sSt = useState(false),
    streaming = _sSt[0],
    setStreaming = _sSt[1];
  var _sRSid = useState(''),
    resumeSessionId = _sRSid[0],
    setResumeSessionId = _sRSid[1];
  var chatCtrlRef = useRef(null);
  var messagesEndRef = useRef(null);
  var tokenBlockRef = useRef(null);

  // Runner config state
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
  var _sModel = useState(''),
    cfgModel = _sModel[0],
    setCfgModel = _sModel[1];
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

  // AskHuman state
  var _sAskId = useState(''),
    askRequestId = _sAskId[0],
    setAskRequestId = _sAskId[1];
  var _sAskResp = useState(''),
    askResponse = _sAskResp[0],
    setAskResponse = _sAskResp[1];

  // Right panel state
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

  // Load agents on mount
  useEffect(function () {
    api.get('/api/agents').then(function (list) {
      setAgents(Array.isArray(list) ? list : []);
    }).catch(function () {
      setAgents([]);
    });
  }, []);

  // Auto-scroll chat messages to bottom
  useEffect(
    function () {
      if (messagesEndRef.current) {
        messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
      }
    },
    [chatLines]
  );

  // Auto-scroll cockpit event log to bottom only when new events arrive
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

  // Manage cockpit EventSource when sessionId changes
  useEffect(
    function () {
      // Close previous connection
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

      // Open new SSE connection for cockpit events
      var es = new EventSource(BASE + '/api/agent/' + sessionId + '/state');
      es.addEventListener('agent-diagnostics', function (e) {
        try {
          setDiagnosticsData(JSON.parse(e.data));
        } catch (_) {
          // Ignore parse errors
        }
      });
      es.onmessage = function (e) {
        try {
          var parsed = JSON.parse(e.data);
          // Generic SSE message: payload is { event: string, data: unknown }
          var evtType = parsed.event || parsed.type || 'message';
          var data = parsed.data || parsed;
          var tag = eventToTag(evtType);
          var text = formatEventData(evtType, data);
          appendCockpitEvent(evtType, tag, text, data);
        } catch (_) {
          setCockpitEvents(function (prev) {
            return prev.concat([{
              type: 'raw', tag: 'step', text: e.data, data: { raw: e.data }, id: Date.now() + Math.random(),
            }]);
          });
        }
      };
      es.onerror = function () {
        // SSE connection error or close
      };
      cockpitEsRef.current = es;

      // Load file tree for the right panel Files tab
      api.get('/api/files/' + sessionId + '/tree').then(function (data) {
        setRightFileTree(Array.isArray(data) ? data : data ? [data] : []);
      }).catch(function () {
        setRightFileTree([]);
      });

      // Cleanup function
      return function () {
        if (cockpitEsRef.current) {
          cockpitEsRef.current.close();
          cockpitEsRef.current = null;
        }
      };
    },
    [sessionId]
  );

  function appendLine(tag, text) {
    setChatLines(function (prev) {
      if (tag === 'token' && prev.length > 0 && prev[prev.length - 1].tag === 'token') {
        var last = prev[prev.length - 1];
        return prev.slice(0, -1).concat([{ tag: 'token', text: last.text + text, id: last.id }]);
      }
      return prev.concat([{ tag: tag, text: text, id: Date.now() + Math.random() }]);
    });
  }

  function appendCockpitEvent(ev, tag, text, data) {
    setCockpitEvents(function (prev) {
      return prev.concat([{
        type: ev, tag: tag, text: text, data: data, id: Date.now() + Math.random(),
      }]);
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

      // Only chat-relevant events go to the chat panel
      if (tag === 'token') {
        appendLine('token', text);
      } else if (ev === 'error') {
        appendLine('error', text);
      }
    } catch (_) {
      // Ignore parse errors
    }
  }

  // Build the runner config object from checkbox states
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
    if (cfgModel.trim()) result.model = cfgModel.trim();
    if (cfgSkillDirs.trim()) {
      result.skillDirs = cfgSkillDirs.split(',').map(function (s) { return s.trim(); }).filter(Boolean);
    }
    if (cfgMcpPaths.trim()) {
      result.mcpConfigPaths = cfgMcpPaths.split(',').map(function (s) { return s.trim(); }).filter(Boolean);
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
          return res.json().catch(function () {
            return { error: res.statusText };
          }).then(function (err) {
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

    if (sessionId) {
      // Continue existing session — agent remembers conversation history
      appendLine('user', msg);
      doStream('/api/chat/' + sessionId, {
        message: msg,
        thinkingEnabled: msgThinking,
        config: buildRunnerConfig(),
      });
    } else if (resumeSessionId) {
      // Resume a previously saved session
      setSessionId(resumeSessionId);
      appendLine('user', msg);
      doStream('/api/chat/' + resumeSessionId, {
        message: msg,
        thinkingEnabled: msgThinking,
        config: buildRunnerConfig(),
      });
    } else if (selectedAgent && workspacePath) {
      // Start new conversation
      setCockpitEvents([]);
      appendLine('user', msg);
      doStream('/api/agents/' + selectedAgent + '/chat', {
        message: msg,
        workspacePath: workspacePath,
        thinkingEnabled: msgThinking,
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
    api.post('/api/chat/' + sessionId + '/respond', {
      requestId: askRequestId,
      response: askResponse,
    }).then(function (res) {
      appendLine('session', 'Responded: ' + JSON.stringify(res));
      setAskRequestId('');
      setAskResponse('');
    });
  }

  // Right panel: load file content
  function openRightFile(path) {
    setRightFilePath(path);
    api.get('/api/files/' + sessionId + '/content?path=' + encodeURIComponent(path)).then(function (res) {
      if (typeof res === 'object' && res.content) {
        setRightFileContent(res.content);
      } else {
        setRightFileContent(typeof res === 'string' ? res : JSON.stringify(res, null, 2));
      }
    }).catch(function () {
      setRightFileContent('Error loading file.');
    });
  }

  // Right panel: save file
  function saveRightFile() {
    if (!sessionId || !rightFilePath) return;
    setRightSaveStatus('saving...');
    api.put('/api/files/' + sessionId + '/content', {
      path: rightFilePath,
      content: rightFileContent,
    }).then(function (res) {
      if (res && res.error) {
        setRightSaveStatus('Error: ' + res.error);
      } else {
        setRightSaveStatus('Saved');
        setTimeout(function () { setRightSaveStatus(''); }, 2000);
      }
    }).catch(function () {
      setRightSaveStatus('Error: save failed');
    });
  }

  // Event card config — unified tag + color map for ALL daemon event types
  var TAG_COLORS = {
    user: { label: 'you', bg: 'rgba(88,166,255,0.08)', fg: 'var(--accent)' },
    token: { label: 'assistant', bg: 'rgba(63,185,80,0.12)', fg: 'var(--success)' },
    think: { label: 'thinking', bg: 'rgba(139,148,158,0.12)', fg: 'var(--text-secondary)' },
    tool: { label: 'tool', bg: 'rgba(210,153,34,0.12)', fg: 'var(--warning)' },
    error: { label: 'error', bg: 'rgba(248,81,73,0.12)', fg: 'var(--error)' },
    done: { label: 'done', bg: 'rgba(88,166,255,0.12)', fg: 'var(--accent)' },
    session: { label: 'session', bg: 'rgba(88,166,255,0.12)', fg: 'var(--accent)' },
    skill: { label: 'skill', bg: 'rgba(168,85,247,0.12)', fg: '#a855f7' },
    step: { label: 'step', bg: 'rgba(139,148,158,0.06)', fg: 'var(--text-muted)' },
    phase: { label: 'phase', bg: 'rgba(139,148,158,0.06)', fg: 'var(--text-muted)' },
    llm: { label: 'llm', bg: 'rgba(139,148,158,0.06)', fg: 'var(--text-muted)' },
    subagent: { label: 'subagent', bg: 'rgba(168,85,247,0.12)', fg: '#a855f7' },
  };

  // Map raw SSE event name to card tag
  function eventToTag(ev) {
    if (ev === 'session-start') return 'session';
    if (ev === 'token') return 'token';
    if (ev === 'thinking') return 'think';
    if (ev === 'tool-start' || ev === 'tool-end') return 'tool';
    if (ev === 'skill-loading' || ev === 'skill-loaded' || ev === 'skill-start' || ev === 'skill-end') return 'skill';
    if (ev === 'step-start' || ev === 'step-end') return 'step';
    if (ev === 'phase-change') return 'phase';
    if (ev === 'llm-request' || ev === 'llm-response') return 'llm';
    if (ev === 'subagent-start' || ev === 'subagent-end') return 'subagent';
    if (ev === 'error') return 'error';
    if (ev === 'done') return 'done';
    if (ev === 'agent-state') return 'session';
    if (ev === 'runner-config') return 'session';
    if (ev === 'message' || ev === 'raw') return 'step';
    console.warn('[playground] Unmapped SSE event type:', ev);
    return 'step';
  }

  // Format event data into human-readable text
  function formatEventData(ev, p) {
    if (ev === 'session-start') return 'Session started: ' + (p.sessionId || '');
    if (ev === 'token') return p.delta || '';
    if (ev === 'thinking') return p.content || '';
    if (ev === 'tool-start') {
      var argsStr = p.args ? JSON.stringify(p.args, null, 2) : '{}';
      return p.name + '\n' + argsStr;
    }
    if (ev === 'tool-end') {
      var resultStr = p.result != null ? String(p.result) : '(no result)';
      return (p.callId || 'tool') + ' -> result:\n' + resultStr;
    }
    if (ev === 'skill-loading') return 'Loading skill: ' + p.name;
    if (ev === 'skill-loaded') return 'Skill loaded: ' + p.name + (p.tokenCount ? ' (' + p.tokenCount + ' tokens)' : '');
    if (ev === 'skill-start') return 'Skill: ' + p.name + (p.task ? '\n' + p.task : '');
    if (ev === 'skill-end') return 'Skill done: ' + p.name + (p.result ? '\n' + String(p.result) : '');
    if (ev === 'step-start') return 'Step ' + (p.step != null ? p.step : '?');
    if (ev === 'step-end') return 'Step ' + (p.step != null ? p.step : '?') + ' complete';
    if (ev === 'phase-change') {
      var fromType = p.from && p.from.type ? p.from.type : '?';
      var toType = p.to && p.to.type ? p.to.type : '?';
      return fromType + ' -> ' + toType;
    }
    if (ev === 'llm-request') {
      var msgCount = Array.isArray(p.messages) ? p.messages.length : 0;
      return 'Sending ' + msgCount + ' messages to LLM' + (p.skill ? ' (skill: ' + p.skill + ')' : '');
    }
    if (ev === 'llm-response') return 'LLM response received';
    if (ev === 'subagent-start') return 'Sub-agent: ' + p.name + (p.task ? '\n' + p.task : '');
    if (ev === 'subagent-end') return 'Sub-agent done: ' + p.name + (p.result ? '\n' + String(p.result) : '');
    if (ev === 'done') return 'Stream complete' + (p.aborted ? ' (aborted)' : '');
    if (ev === 'error') return p.message || 'Unknown error';
    return JSON.stringify(p, null, 2);
  }

  function tagStyle(tag) {
    var c = TAG_COLORS[tag];
    return c
      ? 'background:' + c.bg + ';color:' + c.fg
      : 'background:rgba(139,148,158,0.06);color:var(--text-muted)';
  }

  function tagLabel(tag) {
    var c = TAG_COLORS[tag];
    return c ? c.label : tag;
  }

  // Expandable card toggle state
  var _sExp = useState({}),
    expandedCards = _sExp[0],
    setExpandedCards = _sExp[1];
  var _sSelEvt = useState(null),
    selectedEventId = _sSelEvt[0],
    setSelectedEventId = _sSelEvt[1];

  function toggleCard(id) {
    setExpandedCards(function (prev) {
      var next = Object.assign({}, prev);
      next[id] = !prev[id];
      return next;
    });
  }

  // Collapse threshold for long content
  var COLLAPSE_THRESHOLD = 300;

  function EventCard(props) {
    var tag = props.tag;
    var text = props.text;
    var id = props.id;
    var data = props.data;
    var isSelected = selectedEventId === id;
    var isLong = text && text.length > COLLAPSE_THRESHOLD;
    var isExpanded = expandedCards[id];
    var displayText = isLong && !isExpanded ? text.substring(0, COLLAPSE_THRESHOLD) : text;

    function onHeaderClick() {
      if (isLong) {
        toggleCard(id);
      } else {
        setSelectedEventId(isSelected ? null : id);
      }
    }

    function onDetailToggle(e) {
      e.stopPropagation();
      setSelectedEventId(isSelected ? null : id);
    }

    return html`
      <div class=${'ev-card ev-card-' + tag + (isSelected ? ' ev-card-selected' : '')}>
        <div class="ev-card-header" onClick=${onHeaderClick}>
          <span class="ev-card-tag" style=${tagStyle(tag)}>${tagLabel(tag)}</span>
          <span class=${'ev-card-body' + (isLong && !isExpanded ? ' ev-card-truncated' : '')}>${displayText}</span>
          ${isLong &&
          html`
            <button
              class="ev-card-toggle"
              onClick=${function (e) { e.stopPropagation(); toggleCard(id); }}
            >
              ${isExpanded ? 'Collapse' : 'Show all (' + text.length + ' chars)'}
            </button>
          `}
          <button
            class="ev-card-detail-btn"
            onClick=${onDetailToggle}
          >
            ${isSelected ? 'Hide detail' : 'Detail'}
          </button>
        </div>
        ${isExpanded && isLong && html`<div class="ev-card-full">${text}</div>`}
        ${isSelected && html`
          <div class="ev-card-detail">
            <div class="ev-card-detail-label">Event Data</div>
            <${JsonTree} data=${data} open=${2} />
          </div>
        `}
      </div>
    `;
  }

  return html`
    <div class="chat-page">
      <div class="page-header">
        <div class="page-title">Chat with Agent</div>
        <div class="page-desc">Start a new conversation or resume an existing one.</div>
      </div>

      <div class="chat-layout">
        <!-- Left Column: Config panel (disabled during active session) -->
        <div class="chat-left" style=${sessionId ? 'opacity:0.5;pointer-events:none;' : ''}>
          <div class="field">
            <label>Agent</label>
            <select
              class="input"
              value=${selectedAgent}
              onChange=${function (e) {
                setSelectedAgent(e.target.value);
              }}
            >
              <option value="">Choose an agent...</option>
              ${agents.map(
                function (a) {
                  return html`
                    <option key=${a.id} value=${a.id}>
                      ${a.name || a.id}
                    </option>
                  `;
                }
              )}
            </select>
          </div>

          <div class="field">
            <label>Workspace Path</label>
            <input
              class="input"
              placeholder="/path/to/your/project"
              value=${workspacePath}
              onInput=${function (e) {
                setWorkspacePath(e.target.value);
              }}
            />
          </div>

          ${!sessionId &&
            html`
              <div class="field">
                <label>Resume Session (optional)</label>
                <${SessionSelector}
                  value=${resumeSessionId}
                  onChange=${function (v) {
                    setResumeSessionId(v);
                  }}
                  placeholder="Leave empty for new session..."
                />
              </div>
            `
          }

          <!-- Collapsible Runner Config -->
          <div
            class="config-toggle"
            onClick=${function () {
              setConfigOpen(!configOpen);
            }}
          >
            <span>Runner Config</span>
            <span>${configOpen ? '▾' : '▸'}</span>
          </div>
          ${configOpen &&
            html`
              <div class="config-grid">
                <label>
                  <input
                    type="checkbox"
                    checked=${cfgSandbox}
                    onChange=${function (e) {
                      setCfgSandbox(e.target.checked);
                    }}
                  />
                  sandbox
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked=${cfgSession}
                    onChange=${function (e) {
                      setCfgSession(e.target.checked);
                    }}
                  />
                  session
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked=${cfgTodolist}
                    onChange=${function (e) {
                      setCfgTodolist(e.target.checked);
                    }}
                  />
                  todolist
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked=${cfgCommands}
                    onChange=${function (e) {
                      setCfgCommands(e.target.checked);
                    }}
                  />
                  commands
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked=${cfgBShell}
                    onChange=${function (e) {
                      setCfgBShell(e.target.checked);
                    }}
                  />
                  shell
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked=${cfgBWebSearch}
                    onChange=${function (e) {
                      setCfgBWebSearch(e.target.checked);
                    }}
                  />
                  webSearch
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked=${cfgBWebFetch}
                    onChange=${function (e) {
                      setCfgBWebFetch(e.target.checked);
                    }}
                  />
                  webFetch
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked=${cfgBPython}
                    onChange=${function (e) {
                      setCfgBPython(e.target.checked);
                    }}
                  />
                  python
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked=${cfgBGit}
                    onChange=${function (e) {
                      setCfgBGit(e.target.checked);
                    }}
                  />
                  git
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked=${cfgA2ui}
                    onChange=${function (e) {
                      setCfgA2ui(e.target.checked);
                    }}
                  />
                  a2ui
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked=${cfgBFileRead}
                    onChange=${function (e) {
                      setCfgBFileRead(e.target.checked);
                    }}
                  />
                  fileRead
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked=${cfgBFileWrite}
                    onChange=${function (e) {
                      setCfgBFileWrite(e.target.checked);
                    }}
                  />
                  fileWrite
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked=${cfgBFileEdit}
                    onChange=${function (e) {
                      setCfgBFileEdit(e.target.checked);
                    }}
                  />
                  fileEdit
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked=${cfgBGlob}
                    onChange=${function (e) {
                      setCfgBGlob(e.target.checked);
                    }}
                  />
                  glob
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked=${cfgBGrep}
                    onChange=${function (e) {
                      setCfgBGrep(e.target.checked);
                    }}
                  />
                  grep
                </label>
              </div>
            `
          }

          <!-- Advanced Config -->
          <div
            class="config-toggle"
            style="margin-top:4px;font-size:12px;color:#94a3b8"
            onClick=${function () {
              setAdvOpen(!advOpen);
            }}
          >
            <span>Advanced</span>
            <span>${advOpen ? '▾' : '▸'}</span>
          </div>
          ${advOpen &&
            html`
              <div style="display:flex;flex-direction:column;gap:6px;margin-top:6px">
                <label style="font-size:12px;color:#94a3b8">
                  model
                  <input
                    type="text"
                    value=${cfgModel}
                    placeholder="e.g. gpt-4o (empty = use agent default)"
                    onChange=${function (e) {
                      setCfgModel(e.target.value);
                    }}
                    style="width:100%;margin-top:2px;padding:4px 6px;border-radius:4px;border:1px solid #334155;background:#0f172a;color:#e2e8f0;font-size:12px"
                  />
                </label>
                <label style="font-size:12px;color:#94a3b8">
                  skillDirs (comma-separated)
                  <input
                    type="text"
                    value=${cfgSkillDirs}
                    placeholder="e.g. ./skills, ./custom-skills"
                    onChange=${function (e) {
                      setCfgSkillDirs(e.target.value);
                    }}
                    style="width:100%;margin-top:2px;padding:4px 6px;border-radius:4px;border:1px solid #334155;background:#0f172a;color:#e2e8f0;font-size:12px"
                  />
                </label>
                <label style="font-size:12px;color:#94a3b8">
                  mcpConfigPaths (comma-separated)
                  <input
                    type="text"
                    value=${cfgMcpPaths}
                    placeholder="e.g. ./mcp.json"
                    onChange=${function (e) {
                      setCfgMcpPaths(e.target.value);
                    }}
                    style="width:100%;margin-top:2px;padding:4px 6px;border-radius:4px;border:1px solid #334155;background:#0f172a;color:#e2e8f0;font-size:12px"
                  />
                </label>
              </div>
            `
          }

          <!-- AskHuman response area -->
          ${sessionId &&
            html`
              <div style="border-top:1px solid var(--border);padding-top:8px">
                <div style="font-size:11px;font-weight:500;color:var(--text-muted);margin-bottom:4px">
                  Respond to AskHuman
                </div>
                <div class="field" style="margin-bottom:4px">
                  <input
                    class="input input-mono"
                    style="font-size:11px"
                    placeholder="request-id"
                    value=${askRequestId}
                    onInput=${function (e) {
                      setAskRequestId(e.target.value);
                    }}
                  />
                </div>
                <div class="field" style="margin-bottom:4px">
                  <input
                    class="input"
                    style="font-size:11px"
                    placeholder="Your response"
                    value=${askResponse}
                    onInput=${function (e) {
                      setAskResponse(e.target.value);
                    }}
                  />
                </div>
                <button
                  class="btn btn-secondary btn-sm"
                  style="width:100%"
                  onClick=${sendAskResponse}
                >
                  Send Response
                </button>
              </div>
            `
          }
        </div>

        <!-- Middle Column: Chat messages + input bar -->
        <div class="chat-middle">
          <div style="display:flex;align-items:center;justify-content:space-between;padding:8px 12px;border-bottom:1px solid var(--border);background:var(--bg-secondary);">
            <span style="font-size:12px;color:var(--text-muted);">
              ${sessionId
                ? html`<span style="font-family:var(--font-mono);color:var(--accent);">${sessionId.substring(0, 8)}</span>`
                : 'No active session'}
            </span>
            <button
              class="btn btn-secondary btn-sm"
              onClick=${function () {
                setChatLines([]);
                setCockpitEvents([]);
                setSessionId('');
              }}
            >
              New Chat
            </button>
          </div>
          <div class="chat-messages">
            ${chatLines.length === 0 &&
            html`
              <div style="text-align:center;padding:40px 20px;color:var(--text-muted)">
                <p>Send a message to start streaming</p>
              </div>
            `}
            ${chatLines.map(
              function (line) {
                if (line.tag === 'user') {
                  return html`
                    <div key=${line.id} class="chat-msg chat-msg-user">
                      <div class="chat-msg-body">${line.text}</div>
                    </div>
                  `;
                }
                if (line.tag === 'token') {
                  return html`
                    <div key=${line.id} class="chat-msg chat-msg-assistant">
                      <div class="chat-msg-body">${line.text}</div>
                    </div>
                  `;
                }
                if (line.tag === 'error') {
                  return html`
                    <div key=${line.id} class="chat-msg chat-msg-error">
                      <div class="chat-msg-body">${line.text}</div>
                    </div>
                  `;
                }
                return html`<${EventCard} key=${line.id} tag=${line.tag} text=${line.text} id=${line.id} data=${line.data} />`;
              }
            )}
            <div ref=${messagesEndRef} />
          </div>
          <div class="chat-bar">
            <input
              class="input"
              style="flex:1"
              placeholder=${sessionId ? 'Type your message...' : 'Configure left panel, then send first message...'}
              value=${message}
              onInput=${function (e) {
                setMessage(e.target.value);
              }}
              onKeyPress=${function (e) {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  sendMessage();
                }
              }}
            />
            <label style=${{ display: 'flex', alignItems: 'center', gap: '4px', cursor: 'pointer', fontSize: '12px', color: 'var(--text-secondary)' }}>
              <input type="checkbox" checked=${msgThinking} onChange=${function (e) {
                setMsgThinking(e.target.checked);
              }} />
              Deep think
            </label>
            <button
              class="btn btn-primary btn-sm"
              disabled=${streaming}
              onClick=${sendMessage}
            >
              Send
            </button>
            ${streaming &&
              html`<button class="btn btn-danger btn-sm" onClick=${stopChat}>Stop</button>`
            }
          </div>
        </div>

        <!-- Right Column: Events / State / Files tabs -->
        <div class="chat-right">
          ${sessionId ? html`
            <div class="right-tabs">
              <button
                class=${'right-tab' + (rightTab === 'events' ? ' active' : '')}
                onClick=${function () { setRightTab('events'); }}
              >
                Events
              </button>
              <button
                class=${'right-tab' + (rightTab === 'state' ? ' active' : '')}
                onClick=${function () { setRightTab('state'); }}
              >
                State
              </button>
              <button
                class=${'right-tab' + (rightTab === 'files' ? ' active' : '')}
                onClick=${function () { setRightTab('files'); }}
              >
                Files
              </button>
            </div>

            <div class="right-content">
              ${rightTab === 'events' && html`
                <div
                  ref=${evtLogRef}
                  class="right-scrollable"
                >
                  ${cockpitEvents.length === 0 &&
                    html`
                      <div class="right-empty">No events yet.</div>
                    `
                  }
                  ${cockpitEvents.map(
                    function (ev) {
                      return html`<${EventCard} key=${ev.id} tag=${ev.tag} text=${ev.text} id=${ev.id} data=${ev.data} />`;
                    }
                  )}
                </div>
              `}

              ${rightTab === 'state' && html`
                <div class="right-scrollable">
                  ${diagnosticsData !== null
                    ? html`<${StatePanel} diagnostics=${diagnosticsData} />`
                    : html`<div class="right-empty">Waiting for agent state...</div>`
                  }
                </div>
              `}

              ${rightTab === 'files' && html`
                <div class="file-editor-layout">
                  <div class="file-tree" style="overflow-y:auto">
                    <${FileTree}
                      nodes=${rightFileTree}
                      selectedPath=${rightFilePath}
                      onSelect=${openRightFile}
                    />
                  </div>
                  <div class="editor-area">
                    <div class="detail-label">${rightFilePath || 'Select a file'}</div>
                    <div class="editor-wrap">
                      <${CodeMirrorWrapper}
                        value=${rightFileContent}
                        onChange=${setRightFileContent}
                        mode=${rightFilePath && rightFilePath.endsWith('.js') ? 'javascript' : 'markdown'}
                      />
                    </div>
                    <div class="editor-toolbar">
                      <button
                        class="btn btn-primary btn-sm"
                        disabled=${!rightFilePath}
                        onClick=${saveRightFile}
                      >
                        Save
                      </button>
                      ${rightSaveStatus && html`
                        <span style=${'font-size:11px;color:' + (rightSaveStatus.startsWith('Error') ? 'var(--error)' : rightSaveStatus === 'saving...' ? 'var(--warning)' : 'var(--success)')}>
                          ${rightSaveStatus}
                        </span>
                      `}
                    </div>
                  </div>
                </div>
              `}
            </div>
          ` : html`
            <div style="color:var(--text-muted);font-size:12px;text-align:center;padding:40px 16px">
              Start a chat session to see cockpit events, agent state, and workspace files.
            </div>
          `}
        </div>
      </div>
    </div>
  `;
}

// ── Shared: Inline file editor for management pages ──
// Renders a file tree and textarea editor for agents/skills/crews.
function InlineFileEditor(props) {
  var resourceType = props.resourceType;
  var resourceId = props.resourceId;
  var _sFT = useState([]),
    tree = _sFT[0],
    setTree = _sFT[1];
  var _sFP = useState(null),
    filePath = _sFP[0],
    setFilePath = _sFP[1];
  var _sFC = useState(''),
    fileContent = _sFC[0],
    setFileContent = _sFC[1];
  var _sSave = useState(''),
    saveStatus = _sSave[0],
    setSaveStatus = _sSave[1];

  var apiBase = '/api/' + resourceType + '/' + resourceId;

  // Load file tree when resourceId changes
  useEffect(
    function () {
      if (!resourceId) return;
      api.get(apiBase + '/files').then(function (data) {
        setTree(Array.isArray(data) ? data : data ? [data] : []);
      }).catch(function () {
        setTree([]);
      });
    },
    [resourceId]
  );

  function openFile(path) {
    setFilePath(path);
    setSaveStatus('');
    api.get(apiBase + '/file?path=' + encodeURIComponent(path)).then(function (res) {
      if (typeof res === 'object' && res.content) {
        setFileContent(res.content);
      } else {
        setFileContent(typeof res === 'string' ? res : JSON.stringify(res, null, 2));
      }
    }).catch(function () {
      setFileContent('Error loading file.');
    });
  }

  function saveFile() {
    if (!filePath) return;
    setSaveStatus('saving...');
    api.put(apiBase + '/file', {
      path: filePath,
      content: fileContent,
    }).then(function (res) {
      if (res && res.error) {
        setSaveStatus('Error: ' + res.error);
      } else {
        setSaveStatus('Saved');
        setTimeout(function () { setSaveStatus(''); }, 2000);
      }
    }).catch(function (e) {
      setSaveStatus('Error: ' + (e.message || 'Save failed'));
    });
  }

  function createFile() {
    var name = prompt('New file path:');
    if (!name) return;
    api.post(apiBase + '/file', { path: name, content: '' }).then(function () {
      // Reload tree
      api.get(apiBase + '/files').then(function (data) {
        setTree(Array.isArray(data) ? data : data ? [data] : []);
      });
    });
  }

  function deleteFile() {
    if (!filePath) return;
    if (!confirm('Delete "' + filePath + '"?')) return;
    api.del(apiBase + '/file', { path: filePath }).then(function () {
      setFilePath(null);
      setFileContent('');
      // Reload tree
      api.get(apiBase + '/files').then(function (data) {
        setTree(Array.isArray(data) ? data : data ? [data] : []);
      });
    });
  }

  return html`
    <div class="file-editor-section">
      <div class="detail-label">Files</div>
      <div class="editor-toolbar">
        <button class="btn btn-secondary btn-sm" onClick=${createFile}>+ New File</button>
        <button class="btn btn-danger btn-sm" disabled=${!filePath} onClick=${deleteFile}>Delete</button>
      </div>
      <div class="file-editor-layout">
        <div class="file-tree">
          <${FileTree}
            nodes=${tree}
            selectedPath=${filePath}
            onSelect=${openFile}
          />
        </div>
        <div class="editor-area">
          <div class="detail-label">${filePath || 'Select a file'}</div>
          <${CodeMirrorWrapper}
            value=${fileContent}
            onChange=${setFileContent}
            mode=${filePath && filePath.endsWith('.js') ? 'javascript' : 'markdown'}
          />
          <div style="display:flex;align-items:center;gap:8px">
            <button
              class="btn btn-primary btn-sm"
              disabled=${!filePath}
              onClick=${saveFile}
            >
              Save
            </button>
            ${saveStatus && html`
              <span style=${'font-size:11px;color:' + (saveStatus.startsWith('Error') ? 'var(--error)' : saveStatus === 'saving...' ? 'var(--warning)' : 'var(--success)')}>
                ${saveStatus}
              </span>
            `}
          </div>
        </div>
      </div>
    </div>
  `;
}

// ── Page: Agents ──
function AgentsPage() {
  var _sAg = useState([]),
    agents = _sAg[0],
    setAgents = _sAg[1];
  var _sSel = useState(null),
    selected = _sSel[0],
    setSelected = _sSel[1];
  var _sSC = useState(false),
    showCreate = _sSC[0],
    setShowCreate = _sSC[1];
  var _sNN = useState(''),
    newName = _sNN[0],
    setNewName = _sNN[1];
  var _sNI = useState(''),
    newInstructions = _sNI[0],
    setNewInstructions = _sNI[1];
  var _sErr = useState(''),
    error = _sErr[0],
    setError = _sErr[1];

  function loadAgents() {
    api.get('/api/agents').then(function (list) {
      setAgents(Array.isArray(list) ? list : []);
    }).catch(function () {
      setAgents([]);
    });
  }

  useEffect(loadAgents, []);

  function handleCreate() {
    if (!newName.trim()) {
      setError('Name is required');
      return;
    }
    api.post('/api/agents', { name: newName, instructions: newInstructions }).then(function () {
      setNewName('');
      setNewInstructions('');
      setError('');
      setShowCreate(false);
      loadAgents();
    });
  }

  function handleDelete(id) {
    if (!confirm('Delete agent "' + id + '"?')) return;
    api.del('/api/agents/' + id).then(function () {
      if (selected && selected.id === id) setSelected(null);
      loadAgents();
    });
  }

  function handleSelect(agent) {
    api.get('/api/agents/' + agent.id).then(function (detail) {
      setSelected(detail);
    });
  }

  var columns = [
    { key: 'name', label: 'Name', render: function (item) {
      return html`
        <span
          class="name-link"
          onClick=${function (e) {
            e.stopPropagation();
            handleSelect(item);
          }}
        >
          ${item.name || item.id}
        </span>
      `;
    }},
    { key: 'path', label: 'Path', mono: true },
  ];

  return html`
    <div class="page">
      <div class="page-header">
        <div class="page-title">Agents</div>
        <div class="page-desc">Manage agent definitions. Each agent is a directory with an AGENT.md file.</div>
      </div>

      ${showCreate &&
      html`
        <div class="panel">
          <div class="panel-header"><span class="panel-title">Create Agent</span></div>
          <div class="field" style="margin-bottom:12px">
            <label>Name</label>
            <input
              class="input"
              placeholder="my-agent"
              value=${newName}
              onInput=${function (e) {
                setNewName(e.target.value);
                setError('');
              }}
            />
            ${error && html`<div style="color:var(--error);font-size:11px;margin-top:4px">${error}</div>`}
          </div>
          <div class="field" style="margin-bottom:12px">
            <label>Instructions</label>
            <textarea
              class="input input-mono"
              rows="3"
              placeholder="You are a helpful assistant."
              value=${newInstructions}
              onInput=${function (e) {
                setNewInstructions(e.target.value);
              }}
            />
          </div>
          <div style="display:flex;gap:8px">
            <button class="btn btn-primary btn-sm" onClick=${handleCreate}>Create</button>
            <button class="btn btn-secondary btn-sm" onClick=${function () { setShowCreate(false); setError(''); }}>
              Cancel
            </button>
          </div>
        </div>
      `}

      <${ResourceList}
        columns=${columns}
        items=${agents}
        selectedId=${selected && selected.id}
        onSelect=${handleSelect}
        onCreate=${function () { setShowCreate(true); }}
        onCreateLabel="New Agent"
        emptyMessage="No agents found. Click '+ New Agent' to create one."
        actions=${function (item) {
          return html`
            <button class="btn btn-danger btn-sm" onClick=${function (e) {
              e.stopPropagation();
              handleDelete(item.id);
            }}>
              Delete
            </button>
          `;
        }}
      />

      ${selected &&
      html`
        <div class="panel" style="margin-top:16px">
          <div class="panel-header">
            <span class="panel-title">${selected.name || selected.id}</span>
          </div>
          <div class="detail-label">Instructions</div>
          <div class="event-log" style="max-height:200px;margin-bottom:12px">
            ${selected.instructions || '(no instructions)'}
          </div>
          <div class="detail-label">JSON</div>
          <${JsonTree} data=${selected} open=${1} />
          <${InlineFileEditor}
            resourceType="agents"
            resourceId=${selected.id}
          />
        </div>
      `}
    </div>
  `;
}

// ── Page: Skills ──
function SkillsPage() {
  var _sSk = useState([]),
    skills = _sSk[0],
    setSkills = _sSk[1];
  var _sSel = useState(null),
    selected = _sSel[0],
    setSelected = _sSel[1];
  var _sSC = useState(false),
    showCreate = _sSC[0],
    setShowCreate = _sSC[1];
  var _sNN = useState(''),
    newName = _sNN[0],
    setNewName = _sNN[1];
  var _sND = useState(''),
    newDesc = _sND[0],
    setNewDesc = _sND[1];
  var _sErr = useState(''),
    error = _sErr[0],
    setError = _sErr[1];

  function loadSkills() {
    api.get('/api/skills').then(function (list) {
      setSkills(Array.isArray(list) ? list : []);
    }).catch(function () {
      setSkills([]);
    });
  }

  useEffect(loadSkills, []);

  function handleCreate() {
    if (!newName.trim()) {
      setError('Name is required');
      return;
    }
    api.post('/api/skills', { name: newName, description: newDesc }).then(function () {
      setNewName('');
      setNewDesc('');
      setError('');
      setShowCreate(false);
      loadSkills();
    });
  }

  function handleDelete(id) {
    if (!confirm('Delete skill "' + id + '"?')) return;
    api.del('/api/skills/' + id).then(function () {
      if (selected && selected.id === id) setSelected(null);
      loadSkills();
    });
  }

  function handleSelect(skill) {
    api.get('/api/skills/' + skill.id).then(function (detail) {
      setSelected(detail);
    });
  }

  var columns = [
    { key: 'name', label: 'Name', render: function (item) {
      return html`
        <span
          class="name-link"
          onClick=${function (e) {
            e.stopPropagation();
            handleSelect(item);
          }}
        >
          ${item.name || item.id}
        </span>
      `;
    }},
    { key: 'path', label: 'Path', mono: true },
  ];

  return html`
    <div class="page">
      <div class="page-header">
        <div class="page-title">Skills</div>
        <div class="page-desc">Manage skill definitions. Each skill is a directory with a SKILL.md file.</div>
      </div>

      ${showCreate &&
      html`
        <div class="panel">
          <div class="panel-header"><span class="panel-title">Create Skill</span></div>
          <div class="row">
            <div class="field">
              <label>Name</label>
              <input
                class="input"
                placeholder="my-skill"
                value=${newName}
                onInput=${function (e) {
                  setNewName(e.target.value);
                  setError('');
                }}
              />
              ${error && html`<div style="color:var(--error);font-size:11px;margin-top:4px">${error}</div>`}
            </div>
            <div class="field">
              <label>Description</label>
              <input
                class="input"
                placeholder="What this skill does"
                value=${newDesc}
                onInput=${function (e) {
                  setNewDesc(e.target.value);
                }}
              />
            </div>
          </div>
          <div style="display:flex;gap:8px">
            <button class="btn btn-primary btn-sm" onClick=${handleCreate}>Create</button>
            <button class="btn btn-secondary btn-sm" onClick=${function () { setShowCreate(false); setError(''); }}>
              Cancel
            </button>
          </div>
        </div>
      `}

      <${ResourceList}
        columns=${columns}
        items=${skills}
        selectedId=${selected && selected.id}
        onSelect=${handleSelect}
        onCreate=${function () { setShowCreate(true); }}
        onCreateLabel="New Skill"
        emptyMessage="No skills found. Click '+ New Skill' to create one."
        actions=${function (item) {
          return html`
            <button class="btn btn-danger btn-sm" onClick=${function (e) {
              e.stopPropagation();
              handleDelete(item.id);
            }}>
              Delete
            </button>
          `;
        }}
      />

      ${selected &&
      html`
        <div class="panel" style="margin-top:16px">
          <div class="panel-header">
            <span class="panel-title">${selected.name || selected.id}</span>
          </div>
          <div class="detail-label">Details</div>
          <${JsonTree} data=${selected} open=${1} />
          <${InlineFileEditor}
            resourceType="skills"
            resourceId=${selected.id}
          />
        </div>
      `}
    </div>
  `;
}

// ── Page: Sessions ──
function SessionsPage() {
  var _sSe = useState([]),
    sessions = _sSe[0],
    setSessions = _sSe[1];
  var _sWF = useState(''),
    workspaceFilter = _sWF[0],
    setWorkspaceFilter = _sWF[1];
  var _sSel = useState(null),
    selected = _sSel[0],
    setSelected = _sSel[1];

  function loadSessions() {
    var url = '/api/sessions';
    if (workspaceFilter) url += '?workspacePath=' + encodeURIComponent(workspaceFilter);
    api.get(url).then(function (list) {
      setSessions(Array.isArray(list) ? list : []);
    }).catch(function () {
      setSessions([]);
    });
  }

  useEffect(loadSessions, []);

  function handleDelete(id) {
    if (!confirm('Delete this session?')) return;
    api.del('/api/sessions/' + id).then(function () {
      if (selected && selected.id === id) setSelected(null);
      loadSessions();
    });
  }

  function handleFork(id) {
    api.post('/api/sessions/' + id + '/fork').then(function () {
      loadSessions();
    });
  }

  function handleSelect(session) {
    api.get('/api/sessions/' + session.id).then(function (detail) {
      setSelected(detail);
    });
  }

  var columns = [
    { key: 'id', label: 'Session ID', render: function (item) {
      var short = item.id ? item.id.substring(0, 12) + '...' : '-';
      return html`
        <span
          class="name-link"
          title=${item.id}
          onClick=${function (e) {
            e.stopPropagation();
            handleSelect(item);
          }}
        >
          ${short}
        </span>
      `;
    }},
    { key: 'agentName', label: 'Agent' },
    { key: 'workspacePath', label: 'Workspace', mono: true },
  ];

  return html`
    <div class="page">
      <div class="page-header">
        <div class="page-title">Sessions</div>
        <div class="page-desc">View and manage conversation sessions. Sessions are created automatically when you chat.</div>
      </div>

      <div class="page-toolbar">
        <div class="field" style="min-width:260px;margin-bottom:0">
          <label>Filter by Workspace</label>
          <input
            class="input"
            placeholder="Optional: /path/to/workspace"
            value=${workspaceFilter}
            onInput=${function (e) {
              setWorkspaceFilter(e.target.value);
            }}
          />
        </div>
        <button class="btn btn-secondary btn-sm" onClick=${loadSessions}>Refresh</button>
      </div>

      <${ResourceList}
        columns=${columns}
        items=${sessions}
        selectedId=${selected && selected.id}
        onSelect=${handleSelect}
        emptyMessage="No sessions found. Start a chat to create one."
        actions=${function (item) {
          return html`
            <div style="display:flex;gap:4px">
              <button class="btn btn-secondary btn-sm" onClick=${function (e) {
                e.stopPropagation();
                handleFork(item.id);
              }}>
                Fork
              </button>
              <button class="btn btn-danger btn-sm" onClick=${function (e) {
                e.stopPropagation();
                handleDelete(item.id);
              }}>
                Delete
              </button>
            </div>
          `;
        }}
      />

      ${selected &&
      html`
        <div class="panel" style="margin-top:16px">
          <div class="panel-header">
            <span class="panel-title">${selected.id}</span>
          </div>
          <${JsonTree} data=${selected} open=${1} />
        </div>
      `}
    </div>
  `;
}

// ── Page: Agent State ──
function AgentStatePage() {
  var _sSid = useState(''),
    sessionId = _sSid[0],
    setSessionId = _sSid[1];
  var _sSt = useState(null),
    stateData = _sSt[0],
    setStateData = _sSt[1];
  var _sW = useState(false),
    watching = _sW[0],
    setWatching = _sW[1];
  var eventSourceRef = useRef(null);

  function watchState() {
    stopWatch();
    if (!sessionId) return;
    var es = new EventSource(BASE + '/api/agent/' + sessionId + '/state');
    es.onmessage = function (e) {
      try {
        setStateData(JSON.parse(e.data));
      } catch (_) {
        setStateData(e.data);
      }
    };
    es.onerror = function () {
      setWatching(false);
      stopWatch();
    };
    eventSourceRef.current = es;
    setWatching(true);
  }

  function stopWatch() {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
    setWatching(false);
  }

  return html`
    <div class="page">
      <div class="page-header">
        <div class="page-title">Agent State</div>
        <div class="page-desc">Watch an agent's real-time state via SSE.</div>
      </div>

      <div class="panel">
        <div class="row" style="margin-bottom:0">
          <div class="field">
            <label>Session</label>
            <${SessionSelector}
              value=${sessionId}
              onChange=${function (v) {
                setSessionId(v);
              }}
            />
          </div>
          <button class="btn btn-primary btn-sm" onClick=${watchState}>Watch</button>
          <button class="btn btn-danger btn-sm" onClick=${stopWatch}>Stop</button>
        </div>
      </div>

      ${watching &&
      html`
        <div class="badge badge-success" style="margin-bottom:12px">
          Watching ${sessionId.substring(0, 12)}...
        </div>
      `}

      ${stateData !== null &&
      html`
        <div class="panel">
          <div class="detail-label">Live State</div>
          <${JsonTree} data=${stateData} open=${2} />
        </div>
      `}
    </div>
  `;
}

// ── Page: Files ──
function FilesPage() {
  var _sSid = useState(''),
    sessionId = _sSid[0],
    setSessionId = _sSid[1];
  var _sTr = useState([]),
    tree = _sTr[0],
    setTree = _sTr[1];
  var _sFP = useState(null),
    selectedPath = _sFP[0],
    setSelectedPath = _sFP[1];
  var _sFC = useState(''),
    fileContent = _sFC[0],
    setFileContent = _sFC[1];

  function loadTree() {
    if (!sessionId.trim()) return;
    api.get('/api/files/' + sessionId + '/tree').then(function (data) {
      setTree(Array.isArray(data) ? data : data ? [data] : []);
    }).catch(function () {
      setTree([]);
    });
  }

  function openFile(path) {
    setSelectedPath(path);
    api.get('/api/files/' + sessionId + '/content?path=' + encodeURIComponent(path)).then(function (res) {
      if (typeof res === 'object' && res.content) {
        setFileContent(res.content);
      } else {
        setFileContent(typeof res === 'string' ? res : JSON.stringify(res, null, 2));
      }
    }).catch(function (e) {
      setFileContent('Error loading file: ' + e.message);
    });
  }

  function saveFile() {
    if (!sessionId || !selectedPath) return;
    api.put('/api/files/' + sessionId + '/content', {
      path: selectedPath,
      content: fileContent,
    });
  }

  function createFile() {
    if (!sessionId) return;
    var name = prompt('New file path:');
    if (!name) return;
    api.post('/api/files/' + sessionId, { path: name, content: '' }).then(loadTree);
  }

  function deleteFile() {
    if (!sessionId || !selectedPath) return;
    if (!confirm('Delete "' + selectedPath + '"?')) return;
    api.del('/api/files/' + sessionId, { path: selectedPath }).then(function () {
      setSelectedPath(null);
      setFileContent('');
      loadTree();
    });
  }

  return html`
    <div class="page">
      <div class="page-header">
        <div class="page-title">Workspace Files</div>
        <div class="page-desc">Browse and edit files in the agent's workspace. Requires a session ID.</div>
      </div>

      <div class="page-toolbar">
        <div class="field" style="min-width:300px;margin-bottom:0">
          <label>Session</label>
          <${SessionSelector}
            value=${sessionId}
            onChange=${function (v) {
              setSessionId(v);
            }}
          />
        </div>
        <button class="btn btn-secondary btn-sm" onClick=${loadTree}>Browse</button>
      </div>

      <div style="display:flex;gap:16px">
        <div style="min-width:240px;max-width:300px">
          <div class="detail-label" style="margin-bottom:8px">File Tree</div>
          <${FileTree}
            nodes=${tree}
            selectedPath=${selectedPath}
            onSelect=${openFile}
          />
        </div>
        <div style="flex:1">
          <div class="detail-label" style="margin-bottom:8px">
            ${selectedPath || 'Select a file'}
          </div>
          <textarea
            class="input input-mono"
            rows="16"
            placeholder="Select a file from the tree to view its content"
            value=${fileContent}
            onInput=${function (e) {
              setFileContent(e.target.value);
            }}
            style="min-height:300px"
          />
          <div style="display:flex;gap:8px;margin-top:8px">
            <button class="btn btn-primary btn-sm" onClick=${saveFile}>Save</button>
            <button class="btn btn-secondary btn-sm" onClick=${createFile}>Create New</button>
            <button class="btn btn-danger btn-sm" onClick=${deleteFile}>Delete</button>
          </div>
        </div>
      </div>
    </div>
  `;
}

// ── Page: Crews ──
function CrewsPage() {
  var _sCr = useState([]),
    crews = _sCr[0],
    setCrews = _sCr[1];
  var _sSel = useState(null),
    selected = _sSel[0],
    setSelected = _sSel[1];
  var _sAg = useState([]),
    agents = _sAg[0],
    setAgents = _sAg[1];
  var _sShow = useState(false),
    showCreate = _sShow[0],
    setShowCreate = _sShow[1];
  var _sName = useState(''),
    newName = _sName[0],
    setNewName = _sName[1];
  var _sDesc = useState(''),
    newDesc = _sDesc[0],
    setNewDesc = _sDesc[1];
  var _sPA = useState(''),
    newPrimaryAgent = _sPA[0],
    setNewPrimaryAgent = _sPA[1];
  var _sInst = useState(''),
    newInstructions = _sInst[0],
    setNewInstructions = _sInst[1];
  var _sErr = useState(''),
    error = _sErr[0],
    setError = _sErr[1];

  function loadCrews() {
    api.get('/api/crews').then(function (res) {
      setCrews(Array.isArray(res) ? res : []);
    }).catch(function () {
      setCrews([]);
    });
  }

  function loadAgents() {
    api.get('/api/agents').then(function (list) {
      setAgents(Array.isArray(list) ? list : []);
    }).catch(function () {
      setAgents([]);
    });
  }

  useEffect(loadCrews, []);
  useEffect(loadAgents, []);

  function handleCreate() {
    if (!newName.trim()) {
      setError('Name is required');
      return;
    }
    api.post('/api/crews', {
      name: newName,
      description: newDesc,
      primaryAgent: newPrimaryAgent || undefined,
      instructions: newInstructions || undefined,
    }).then(function () {
      setNewName('');
      setNewDesc('');
      setNewPrimaryAgent('');
      setNewInstructions('');
      setError('');
      setShowCreate(false);
      loadCrews();
    });
  }

  function handleDelete(id) {
    if (!confirm('Delete crew "' + id + '"?')) return;
    api.del('/api/crews/' + id).then(function () {
      if (selected && selected.name === id) setSelected(null);
      loadCrews();
    });
  }

  function handleSelect(crew) {
    api.get('/api/crews/' + crew.name).then(function (detail) {
      setSelected(detail || crew);
    }).catch(function () {
      setSelected(crew);
    });
  }

  var columns = [
    { key: 'name', label: 'Name', render: function (item) {
      return html`
        <span
          class="name-link"
          onClick=${function (e) {
            e.stopPropagation();
            handleSelect(item);
          }}
        >
          ${item.name || item.id}
        </span>
      `;
    }},
    { key: 'description', label: 'Description', render: function (item) {
      return html`<span style="color:var(--text-secondary)">${item.description || '-'}</span>`;
    }},
    { key: 'agents', label: 'Agents', render: function (item) {
      var n = item.agentCount || (item.agents ? item.agents.length : 0);
      return String(n);
    }},
    { key: 'skills', label: 'Skills', render: function (item) {
      var n = item.skillCount || (item.skills ? item.skills.length : 0);
      return String(n);
    }},
    { key: 'path', label: 'Path', mono: true },
  ];

  return html`
    <div class="page">
      <div class="page-header">
        <div class="page-title">Crews</div>
        <div class="page-desc">Manage crew definitions. Each crew is a directory with a CREW.md file containing agents and skills.</div>
      </div>

      ${showCreate &&
      html`
        <div class="panel">
          <div class="panel-header"><span class="panel-title">Create Crew</span></div>
          <div class="row">
            <div class="field">
              <label>Name</label>
              <input
                class="input"
                placeholder="my-crew"
                value=${newName}
                onInput=${function (e) {
                  setNewName(e.target.value);
                  setError('');
                }}
              />
              ${error && html`<div style="color:var(--error);font-size:11px;margin-top:4px">${error}</div>`}
            </div>
            <div class="field">
              <label>Primary Agent</label>
              <select
                class="input"
                value=${newPrimaryAgent}
                onChange=${function (e) { setNewPrimaryAgent(e.target.value); }}
              >
                <option value="">(none)</option>
                ${agents.map(function (a) {
                  return html`<option key=${a.id} value=${a.id}>${a.name || a.id}</option>`;
                })}
              </select>
            </div>
          </div>
          <div class="field" style="margin-bottom:12px">
            <label>Description</label>
            <input
              class="input"
              placeholder="What this crew does"
              value=${newDesc}
              onInput=${function (e) { setNewDesc(e.target.value); }}
            />
          </div>
          <div class="field" style="margin-bottom:12px">
            <label>Instructions</label>
            <textarea
              class="input input-mono"
              rows="3"
              placeholder="Crew-level instructions for all members."
              value=${newInstructions}
              onInput=${function (e) { setNewInstructions(e.target.value); }}
            />
          </div>
          <div style="display:flex;gap:8px">
            <button class="btn btn-primary btn-sm" onClick=${handleCreate}>Create</button>
            <button class="btn btn-secondary btn-sm" onClick=${function () { setShowCreate(false); setError(''); }}>Cancel</button>
          </div>
        </div>
      `}

      <${ResourceList}
        columns=${columns}
        items=${crews}
        selectedId=${selected && selected.name}
        onSelect=${handleSelect}
        onCreate=${function () { setShowCreate(true); }}
        onCreateLabel="New Crew"
        emptyMessage="No crews found. Click '+ New Crew' to create one."
        actions=${function (item) {
          return html`
            <button class="btn btn-danger btn-sm" onClick=${function (e) {
              e.stopPropagation();
              handleDelete(item.name);
            }}>
              Delete
            </button>
          `;
        }}
      />

      ${selected &&
      html`
        <div class="panel" style="margin-top:16px">
          <div class="panel-header">
            <span class="panel-title">${selected.name}</span>
            <button class="btn btn-ghost btn-sm" onClick=${function () { setSelected(null); }}>Close</button>
          </div>
          <div class="detail-label">Details</div>
          <${JsonTree} data=${selected} open=${1} />
          <${InlineFileEditor}
            resourceType="crews"
            resourceId=${selected.name}
          />
        </div>
      `}
    </div>
  `;
}

// ── Page: Specs ──
function SpecsPage() {
  var _sWP = useState(''),
    workspacePath = _sWP[0],
    setWorkspacePath = _sWP[1];
  var _sSp = useState([]),
    specs = _sSp[0],
    setSpecs = _sSp[1];

  function loadSpecs() {
    if (!workspacePath.trim()) {
      setSpecs([]);
      return;
    }
    api.get('/api/specs?workspacePath=' + encodeURIComponent(workspacePath)).then(function (res) {
      var list = res.specs || res || [];
      setSpecs(Array.isArray(list) ? list : []);
    }).catch(function () {
      setSpecs([]);
    });
  }

  function createSpec() {
    if (!workspacePath.trim()) {
      alert('Please enter a workspace path first.');
      return;
    }
    var name = prompt('Spec name:');
    if (!name) return;
    api.post('/api/specs', { workspacePath: workspacePath, name: name }).then(loadSpecs);
  }

  return html`
    <div class="page">
      <div class="page-header">
        <div class="page-title">Specs</div>
        <div class="page-desc">View and manage specification documents for your projects.</div>
      </div>

      <div class="page-toolbar">
        <div class="field" style="min-width:260px;margin-bottom:0">
          <label>Workspace Path</label>
          <input
            class="input"
            placeholder="/path/to/workspace"
            value=${workspacePath}
            onInput=${function (e) {
              setWorkspacePath(e.target.value);
            }}
          />
        </div>
        <button class="btn btn-primary btn-sm" onClick=${createSpec}>+ New Spec</button>
        <button class="btn btn-secondary btn-sm" onClick=${loadSpecs}>Refresh</button>
      </div>

      <div class="card-grid">
        ${specs.length === 0 &&
        html`
          <div style="grid-column:1/-1;text-align:center;color:var(--text-muted);padding:40px 0">
            ${workspacePath ? 'No specs found.' : 'Enter a workspace path above to load specs.'}
          </div>
        `}
        ${specs.map(
          function (s) {
            var status = s.status || 'draft';
            return html`
              <div class="card" key=${s.name}>
                <h3>
                  ${s.name}
                  <span class=${'status-badge status-' + status}>${status}</span>
                </h3>
                <div class="card-meta">
                  v${s.version || 1} - ${new Date(s.updatedAt || Date.now()).toLocaleDateString()}
                </div>
              </div>
            `;
          }
        )}
      </div>
    </div>
  `;
}

// ── Page: Plans ──
function PlansPage() {
  var _sWP = useState(''),
    workspacePath = _sWP[0],
    setWorkspacePath = _sWP[1];
  var _sPl = useState([]),
    plans = _sPl[0],
    setPlans = _sPl[1];

  function loadPlans() {
    if (!workspacePath.trim()) {
      setPlans([]);
      return;
    }
    api.get('/api/plans?workspacePath=' + encodeURIComponent(workspacePath)).then(function (res) {
      var list = res.plans || res || [];
      setPlans(Array.isArray(list) ? list : []);
    }).catch(function () {
      setPlans([]);
    });
  }

  function createPlan() {
    if (!workspacePath.trim()) {
      alert('Please enter a workspace path first.');
      return;
    }
    var name = prompt('Plan name:');
    if (!name) return;
    api.post('/api/plans', { workspacePath: workspacePath, name: name }).then(loadPlans);
  }

  return html`
    <div class="page">
      <div class="page-header">
        <div class="page-title">Plans</div>
        <div class="page-desc">View and manage execution plans for your projects.</div>
      </div>

      <div class="page-toolbar">
        <div class="field" style="min-width:260px;margin-bottom:0">
          <label>Workspace Path</label>
          <input
            class="input"
            placeholder="/path/to/workspace"
            value=${workspacePath}
            onInput=${function (e) {
              setWorkspacePath(e.target.value);
            }}
          />
        </div>
        <button class="btn btn-primary btn-sm" onClick=${createPlan}>+ New Plan</button>
        <button class="btn btn-secondary btn-sm" onClick=${loadPlans}>Refresh</button>
      </div>

      <div class="card-grid">
        ${plans.length === 0 &&
        html`
          <div style="grid-column:1/-1;text-align:center;color:var(--text-muted);padding:40px 0">
            ${workspacePath ? 'No plans found.' : 'Enter a workspace path above to load plans.'}
          </div>
        `}
        ${plans.map(
          function (p) {
            var status = p.status || 'draft';
            return html`
              <div class="card" key=${p.name}>
                <h3>
                  ${p.name}
                  <span class=${'status-badge status-' + status}>${status}</span>
                </h3>
                <div class="card-meta">
                  v${p.version || 1} - ${new Date(p.updatedAt || Date.now()).toLocaleDateString()}
                </div>
              </div>
            `;
          }
        )}
      </div>
    </div>
  `;
}

// ── Page: Config ──
function ConfigPage() {
  var _sCfg = useState(null),
    config = _sCfg[0],
    setConfig = _sCfg[1];
  var _sPJ = useState(''),
    patchJson = _sPJ[0],
    setPatchJson = _sPJ[1];
  var _sMsg = useState(''),
    message = _sMsg[0],
    setMessage = _sMsg[1];

  function loadConfig() {
    api.get('/api/config').then(function (data) {
      setConfig(data);
    });
  }

  function applyPatch() {
    try {
      var parsed = JSON.parse(patchJson);
      api.patch('/api/config', parsed).then(function (res) {
        setConfig(res);
        setMessage('Config updated successfully.');
        setPatchJson('');
      }).catch(function (e) {
        setMessage('Error: ' + e.message);
      });
    } catch (e) {
      setMessage('Invalid JSON: ' + e.message);
    }
  }

  return html`
    <div class="page">
      <div class="page-header">
        <div class="page-title">Configuration</div>
        <div class="page-desc">View and update daemon configuration. Changes take effect immediately.</div>
      </div>

      <div class="panel">
        <div class="panel-header">
          <span class="panel-title">Current Config</span>
          <button class="btn btn-secondary btn-sm" onClick=${loadConfig}>Load Config</button>
        </div>
        ${config !== null
          ? html`<${JsonTree} data=${config} open=${2} />`
          : html`<div style="color:var(--text-muted)">Click "Load Config" to view current configuration.</div>`
        }
      </div>

      <div class="panel">
        <div class="panel-header"><span class="panel-title">Patch Config</span></div>
        <div class="field" style="margin-bottom:12px">
          <label>JSON</label>
          <textarea
            class="input input-mono"
            rows="3"
            placeholder='{"llm":{"model":"gpt-4"}}'
            value=${patchJson}
            onInput=${function (e) {
              setPatchJson(e.target.value);
              setMessage('');
            }}
          />
        </div>
        <button class="btn btn-primary btn-sm" onClick=${applyPatch}>Apply</button>
        ${message &&
        html`
          <div style="margin-top:8px;font-size:12px;color=${message.startsWith('Error') ? 'var(--error)' : 'var(--success)'}">
            ${message}
          </div>
        `}
      </div>
    </div>
  `;
}

// ── Sidebar Component ──
// Collapsible groups with navigation items.
function Sidebar(props) {
  var currentPage = props.currentPage;
  var onNavigate = props.onNavigate;
  var _sGr = useState({
    resources: true,
    conversation: true,
    monitoring: false,
    devtools: false,
  }),
    groups = _sGr[0],
    setGroups = _sGr[1];

  function toggleGroup(key) {
    setGroups(function (prev) {
      var next = Object.assign({}, prev);
      next[key] = !prev[key];
      return next;
    });
  }

  var navItems = [
    {
      key: 'resources',
      label: 'Resources',
      items: [
        { id: 'agents', label: 'Agents' },
        { id: 'skills', label: 'Skills' },
        { id: 'crews', label: 'Crews' },
      ],
    },
    {
      key: 'conversation',
      label: 'Conversation',
      items: [
        { id: 'chat', label: 'Chat' },
        { id: 'sessions', label: 'Sessions' },
      ],
    },
    {
      key: 'monitoring',
      label: 'Monitoring',
      items: [
        { id: 'state', label: 'Agent State' },
        { id: 'files', label: 'Files' },
      ],
    },
    {
      key: 'devtools',
      label: 'Dev Tools',
      items: [
        { id: 'specs', label: 'Specs' },
        { id: 'plans', label: 'Plans' },
        { id: 'config', label: 'Config' },
      ],
    },
  ];

  return html`
    <nav class="sidebar">
      <div class="sidebar-logo">wrangler<span>-daemon</span></div>
      ${navItems.map(
        function (group) {
          return html`
            <div class="sidebar-group" key=${group.key}>
              <div class="sidebar-group-title" onClick=${function () { toggleGroup(group.key); }}>
                ${group.label}
                <span class=${'toggle-icon' + (groups[group.key] ? '' : ' collapsed')}>
                  ▾
                </span>
              </div>
              <div class=${'sidebar-group-items' + (groups[group.key] ? '' : ' collapsed')}>
                ${group.items.map(
                  function (item) {
                    return html`
                      <button
                        key=${item.id}
                        class=${'sidebar-item' + (currentPage === item.id ? ' active' : '')}
                        onClick=${function () { onNavigate(item.id); }}
                      >
                        ${item.label}
                      </button>
                    `;
                  }
                )}
              </div>
            </div>
          `;
        }
      )}
    </nav>
  `;
}

// ── Hash Router Utility ──
var VALID_PAGES = ['chat', 'agents', 'skills', 'crews', 'sessions', 'state', 'files', 'specs', 'plans', 'config'];

function readHashPage() {
  var h = window.location.hash.replace('#', '');
  return VALID_PAGES.indexOf(h) >= 0 ? h : 'chat';
}

// ── App Root Component ──
// Hash-based routing: page reflected in address bar, browser back/forward works.
function App() {
  var _sPg = useState(readHashPage),
    currentPage = _sPg[0],
    setCurrentPage = _sPg[1];

  // Sync hash → state on browser navigation
  useEffect(function () {
    function onHashChange() {
      setCurrentPage(readHashPage());
    }
    window.addEventListener('hashchange', onHashChange);
    return function () {
      window.removeEventListener('hashchange', onHashChange);
    };
  }, []);

  function handleNavigate(page) {
    window.location.hash = '#' + page;
    setCurrentPage(page);
  }

  function renderPage() {
    switch (currentPage) {
      case 'chat':
        return html`<${ChatPage} />`;
      case 'agents':
        return html`<${AgentsPage} />`;
      case 'skills':
        return html`<${SkillsPage} />`;
      case 'sessions':
        return html`<${SessionsPage} />`;
      case 'state':
        return html`<${AgentStatePage} />`;
      case 'files':
        return html`<${FilesPage} />`;
      case 'crews':
        return html`<${CrewsPage} />`;
      case 'specs':
        return html`<${SpecsPage} />`;
      case 'plans':
        return html`<${PlansPage} />`;
      case 'config':
        return html`<${ConfigPage} />`;
      default:
        return html`<${ChatPage} />`;
    }
  }

  return html`
    <div class="app-layout">
      <${Sidebar} currentPage=${currentPage} onNavigate=${handleNavigate} />
      <div class="main-content">
        ${renderPage()}
      </div>
    </div>
  `;
}

// ── Mount Application ──
render(html`<${App} />`, document.getElementById('app'));
