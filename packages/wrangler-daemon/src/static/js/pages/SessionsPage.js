/* eslint-disable */
// ── Page: SessionsPage ──
import { html, useState, useEffect, useRef } from '../utils.js';
import { api } from '../api.js';
import { ResourceList } from '../components/ResourceList.js';
import { DetailDrawer } from '../components/DetailDrawer.js';
import { MessageList } from '../components/MessageList.js';
import { esc } from '../utils.js';

// ── Page: Sessions ──
export function SessionsPage() {
  var _sSe = useState([]),
    sessions = _sSe[0],
    setSessions = _sSe[1];
  var _sWF = useState(''),
    workspaceFilter = _sWF[0],
    setWorkspaceFilter = _sWF[1];
  var _sSel = useState(null),
    selected = _sSel[0],
    setSelected = _sSel[1];
  var _sMsgs = useState([]),
    sessionMessages = _sMsgs[0],
    setSessionMessages = _sMsgs[1];
  var _sMsgLoad = useState(false),
    messagesLoading = _sMsgLoad[0],
    setMessagesLoading = _sMsgLoad[1];
  var lastSelectedId = useRef('');

  function loadSessions() {
    var url = '/api/sessions';
    if (workspaceFilter) url += '?workspacePath=' + encodeURIComponent(workspaceFilter);
    api
      .get(url)
      .then(function (list) {
        setSessions(Array.isArray(list) ? list : []);
      })
      .catch(function () {
        setSessions([]);
      });
  }

  useEffect(loadSessions, []);

  function handleDelete(id) {
    if (!confirm('Delete this session?')) return;
    api.del('/api/sessions/' + id).then(function () {
      if (selected && selected.id === id) {
        setSelected(null);
        setSessionMessages([]);
        setMessagesLoading(false);
      }
      loadSessions();
    });
  }

  function handleFork(id) {
    api.post('/api/sessions/' + id + '/fork').then(function () {
      loadSessions();
    });
  }

  function handleSelect(session) {
    lastSelectedId.current = session.id;
    api
      .get('/api/sessions/' + session.id)
      .then(function (detail) {
        if (lastSelectedId.current !== session.id) return;
        setSelected(detail);
      })
      .catch(function () {
        // Ignore detail fetch errors
      });
    // Load messages in parallel
    setMessagesLoading(true);
    setSessionMessages([]);
    api
      .get('/api/chat/' + session.id + '/messages')
      .then(function (res) {
        if (lastSelectedId.current !== session.id) return;
        setSessionMessages(res && res.messages ? res.messages : []);
        setMessagesLoading(false);
      })
      .catch(function () {
        if (lastSelectedId.current !== session.id) return;
        setSessionMessages([]);
        setMessagesLoading(false);
      });
  }

  var columns = [
    {
      key: 'id',
      label: 'Session ID',
      render: function (item) {
        return html`
          <span
            class="name-link"
            style="font-family:var(--font-mono)"
            onClick=${function (e) {
              e.stopPropagation();
              handleSelect(item);
            }}
          >
            ${item.id || '-'}
          </span>
        `;
      },
    },
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
              <button
                class="btn btn-secondary btn-sm"
                onClick=${function (e) {
                  e.stopPropagation();
                  handleFork(item.id);
                }}
              >
                Fork
              </button>
              <button
                class="btn btn-danger btn-sm"
                onClick=${function (e) {
                  e.stopPropagation();
                  handleDelete(item.id);
                }}
              >
                Delete
              </button>
            </div>
          `;
        }}
      />

      <${DetailDrawer}
        open=${selected !== null}
        title=${selected ? selected.id : ''}
        onClose=${function () {
          setSelected(null);
        }}
      >
        ${
          selected &&
          html`
            <div
              style="padding:8px 12px;font-size:12px;color:var(--text-muted);border-bottom:1px solid var(--border)"
            >
              <div style="margin-bottom:4px">
                <strong>Agent:</strong> ${esc(selected.agentName || '-')} ·
                <strong>Model:</strong> ${esc(selected.runnerConfig?.model || '-')}
              </div>
              <div style="margin-bottom:4px">
                <strong>Workspace:</strong> ${esc(selected.workspacePath || '-')}
              </div>
              <div>
                <strong>Created:</strong> ${selected.createdAt
                  ? new Date(selected.createdAt).toLocaleString()
                  : '-'}
                · <strong>Updated:</strong> ${selected.updatedAt
                  ? new Date(selected.updatedAt).toLocaleString()
                  : '-'}
              </div>
            </div>
            <div style="padding:12px">
              <div style="font-size:13px;font-weight:600;margin-bottom:8px">
                Messages (${sessionMessages.length})
              </div>
              ${messagesLoading
                ? html`<div style="color:var(--text-muted);padding:16px;text-align:center">
                    Loading messages...
                  </div>`
                : sessionMessages.length === 0
                  ? html`<div style="color:var(--text-muted);padding:16px;text-align:center">
                      No messages in this session.
                    </div>`
                  : html`<${MessageList} entries=${sessionMessages} maxLen=${500} />`}
            </div>
          `
        }
      </${DetailDrawer}>
    </div>
  `;
}
