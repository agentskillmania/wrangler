/* eslint-disable */
// ─── Playground JS — split from HTML for maintainability ───
'use strict';

const BASE = location.origin;
let currentSessionId = null;
let chatCtrl = null;
let selectedAgent = null;
let selectedSkill = null;
let selectedSession = null;
let selectedFilePath = null;
let _fileClickFn = null;

// ─── Nav ───
document.querySelector('aside').addEventListener('click', e => {
  const b = e.target.closest('.nav-item');
  if (!b) return;
  document.querySelectorAll('.nav-item').forEach(x => x.classList.remove('active'));
  document.querySelectorAll('.page').forEach(x => x.classList.remove('active'));
  b.classList.add('active');
  document.getElementById('page-' + b.dataset.page).classList.add('active');
  if (b.dataset.page === 'agents') loadAgentList();
  if (b.dataset.page === 'skills') loadSkillList();
  if (b.dataset.page === 'sessions') loadSessionList();
});

// ─── Tabs ───
document.querySelectorAll('.tabs').forEach(t => t.addEventListener('click', e => {
  const b = e.target.closest('.tab');
  if (!b) return;
  t.querySelectorAll('.tab').forEach(x => x.classList.remove('active'));
  document.querySelectorAll('.tab-content').forEach(x => x.classList.remove('active'));
  b.classList.add('active');
  document.getElementById('tab-' + b.dataset.tab).classList.add('active');
}));

// ─── Helpers ───
function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

async function api(method, path, body) {
  const opts = { method, headers: {} };
  if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(BASE + path, opts);
  const ct = res.headers.get('content-type') || '';
  return ct.includes('json') ? await res.json() : await res.text();
}

// ─── Health ───
(async () => {
  try {
    await api('GET', '/api/health');
    document.getElementById('dot').className = 'dot ok';
    document.getElementById('connStatus').textContent = 'connected';
  } catch {
    document.getElementById('dot').className = 'dot err';
    document.getElementById('connStatus').textContent = 'disconnected';
  }
})();

// ─── Chat ───
async function loadAgentOptions() {
  const agents = await api('GET', '/api/agents');
  const sel = document.getElementById('ch-agent');
  if (!Array.isArray(agents) || !agents.length) {
    sel.innerHTML = '<option value="">No agents available</option>';
    return;
  }
  sel.innerHTML = '<option value="">Choose an agent...</option>';
  agents.forEach(a => {
    sel.innerHTML += '<option value="' + esc(a.id) + '">' + esc(a.name || a.id) + '</option>';
  });
}
loadAgentOptions();

let _tokenBlock = null;

function appendChat(tag, text) {
  const box = document.getElementById('chat-stream');
  if (box.querySelector('div[style]')) box.innerHTML = '';

  if (tag === 'token') {
    // Append to the current token block (merge tokens into one paragraph)
    if (!_tokenBlock) {
      _tokenBlock = document.createElement('div');
      _tokenBlock.className = 'chat-line';
      _tokenBlock.innerHTML = '<span class="tag tag-token">assistant</span><span class="token-text"></span>';
      box.appendChild(_tokenBlock);
    }
    const span = _tokenBlock.querySelector('.token-text');
    span.textContent += text;
    box.scrollTop = box.scrollHeight;
    return;
  }

  // Non-token events break the token block
  _tokenBlock = null;
  const d = document.createElement('div');
  d.className = 'chat-line';
  d.innerHTML = '<span class="tag tag-' + tag + '">' + tag + '</span>' + esc(text);
  box.appendChild(d);
  box.scrollTop = box.scrollHeight;
}

function clearChat() {
  document.getElementById('chat-stream').innerHTML = '';
  _tokenBlock = null;
}

async function streamChat(url, body) {
  if (chatCtrl) chatCtrl.abort();
  const ctrl = new AbortController();
  chatCtrl = ctrl;
  try {
    const res = await fetch(BASE + url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      appendChat('error', JSON.stringify(err));
      return;
    }
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop() || '';
      let ev = '', data = '';
      for (const line of lines) {
        if (line.startsWith('event: ')) { ev = line.slice(7); }
        else if (line.startsWith('data: ')) { data = line.slice(6); }
        else if (line === '' && ev && data) {
          try {
            const p = JSON.parse(data);
            if (ev === 'session-start') {
              currentSessionId = p.sessionId;
              document.getElementById('ch-session').textContent = 'Session: ' + p.sessionId;
              appendChat('session', 'Started: ' + p.sessionId);
            } else if (ev === 'token') { appendChat('token', p.delta || ''); }
            else if (ev === 'thinking') { appendChat('think', '[thinking] ' + (p.content || '')); }
            else if (ev === 'tool-start') { appendChat('tool', p.name + ' ' + JSON.stringify(p.args)); }
            else if (ev === 'tool-end') { appendChat('tool', p.callId + ' → ' + (p.result || '').substring(0, 200)); }
            else if (ev === 'skill-loading') { appendChat('skill', 'Loading: ' + p.name); }
            else if (ev === 'skill-loaded') { appendChat('skill', 'Loaded: ' + p.name); }
            else if (ev === 'done') { appendChat('done', 'Complete' + (p.aborted ? ' (aborted)' : '')); }
            else if (ev === 'error') { appendChat('error', p.message || ''); }
            else { appendChat('session', '[' + ev + '] ' + data.substring(0, 200)); }
          } catch (_) { /* ignore parse errors */ }
          ev = ''; data = '';
        }
      }
    }
  } catch (e) {
    if (e.name !== 'AbortError') appendChat('error', 'Connection error: ' + e.message);
  }
}

function startNewChat() {
  const a = document.getElementById('ch-agent').value;
  const w = document.getElementById('ch-workspace').value;
  const m = document.getElementById('ch-new-msg').value;
  if (!a || !w || !m) { appendChat('error', 'Agent, workspace path, and message are required.'); return; }
  currentSessionId = null;
  document.getElementById('ch-session').textContent = '';
  clearChat();
  streamChat('/api/agents/' + a + '/chat', { message: m, workspacePath: w });
}

function resumeChat() {
  const s = document.getElementById('ch-resume-id').value;
  const m = document.getElementById('ch-resume-msg').value;
  if (!s || !m) { appendChat('error', 'Session ID and message are required.'); return; }
  currentSessionId = s;
  document.getElementById('ch-session').textContent = 'Session: ' + s;
  clearChat();
  streamChat('/api/chat/' + s, { message: m });
}

async function stopChat() {
  if (!currentSessionId) return;
  await api('POST', '/api/chat/' + currentSessionId + '/stop');
}

async function respondHuman() {
  if (!currentSessionId) { appendChat('error', 'No active session'); return; }
  const res = await api('POST', '/api/chat/' + currentSessionId + '/respond', {
    requestId: document.getElementById('ch-req-id').value,
    response: document.getElementById('ch-req-resp').value,
  });
  appendChat('session', 'Responded: ' + JSON.stringify(res));
}

async function getMessages() {
  const res = await api('GET', '/api/chat/' + document.getElementById('ch-hist-id').value + '/messages');
  document.getElementById('ch-hist-res').textContent = JSON.stringify(res, null, 2);
}

// ═══ AGENTS CRUD ═══
function toggleAgentForm() {
  const f = document.getElementById('ag-form');
  f.classList.toggle('open');
  if (f.classList.contains('open')) {
    document.getElementById('ag-new-name').value = '';
    document.getElementById('ag-new-inst').value = '';
    document.getElementById('ag-name-err').textContent = '';
  }
}

async function loadAgentList() {
  const list = await api('GET', '/api/agents');
  const tbody = document.getElementById('ag-tbody');
  if (!Array.isArray(list) || !list.length) {
    tbody.innerHTML = '<tr class="empty-row"><td colspan="3">No agents found. Click "+ New Agent" to create one.</td></tr>';
    return;
  }
  tbody.innerHTML = list.map(a =>
    '<tr data-id="' + esc(a.id) + '">' +
    '<td><a class="name-link" onclick="viewAgent(\'' + esc(a.id) + '\')">' + esc(a.name || a.id) + '</a></td>' +
    '<td class="mono">' + esc(a.path || '') + '</td>' +
    '<td class="actions"><button class="btn btn-danger btn-sm" onclick="deleteAgent(\'' + esc(a.id) + '\')">Delete</button></td>' +
    '</tr>'
  ).join('');
}

async function submitAgentCreate() {
  const nameEl = document.getElementById('ag-new-name');
  const name = nameEl.value.trim();
  if (!name) {
    document.getElementById('ag-name-err').textContent = 'Name is required';
    nameEl.classList.add('error');
    return;
  }
  document.getElementById('ag-name-err').textContent = '';
  nameEl.classList.remove('error');
  await api('POST', '/api/agents', { name, instructions: document.getElementById('ag-new-inst').value || '' });
  toggleAgentForm();
  loadAgentList();
  loadAgentOptions();
}

async function viewAgent(id) {
  selectedAgent = id;
  document.querySelectorAll('#ag-tbody tr').forEach(r => r.classList.toggle('selected', r.dataset.id === id));
  const detail = await api('GET', '/api/agents/' + id);
  document.getElementById('ag-detail-name').textContent = detail.name || id;
  document.getElementById('ag-detail-inst').textContent = detail.instructions || '(no instructions)';
  try {
    const tree = await api('GET', '/api/agents/' + id + '/files');
    _fileClickFn = function (path) {
      document.getElementById('ag-fpath').value = path;
      readAgentFile();
    };
    document.getElementById('ag-detail-files').innerHTML = renderFileTree(tree);
  } catch {
    document.getElementById('ag-detail-files').innerHTML = '<span style="color:var(--text3)">No files</span>';
  }
  document.getElementById('ag-detail').classList.add('open');
}

function closeAgentDetail() {
  document.getElementById('ag-detail').classList.remove('open');
  selectedAgent = null;
}

async function deleteAgent(id) {
  if (!confirm('Delete agent "' + id + '"?')) return;
  await api('DELETE', '/api/agents/' + id);
  if (selectedAgent === id) closeAgentDetail();
  loadAgentList();
  loadAgentOptions();
}

async function readAgentFile() {
  if (!selectedAgent) return;
  const p = document.getElementById('ag-fpath').value;
  const res = await api('GET', '/api/agents/' + selectedAgent + '/file?path=' + encodeURIComponent(p));
  document.getElementById('ag-file-res').textContent = typeof res === 'string' ? res : JSON.stringify(res, null, 2);
}

async function writeAgentFile() {
  if (!selectedAgent) return;
  const res = await api('PUT', '/api/agents/' + selectedAgent + '/file', {
    path: document.getElementById('ag-fpath').value,
    content: document.getElementById('ag-fcontent').value,
  });
  document.getElementById('ag-file-res').textContent = 'Saved: ' + JSON.stringify(res);
}

// ═══ SKILLS CRUD ═══
function toggleSkillForm() {
  const f = document.getElementById('sk-form');
  f.classList.toggle('open');
  if (f.classList.contains('open')) {
    document.getElementById('sk-new-name').value = '';
    document.getElementById('sk-new-desc').value = '';
    document.getElementById('sk-name-err').textContent = '';
  }
}

async function loadSkillList() {
  const list = await api('GET', '/api/skills');
  const tbody = document.getElementById('sk-tbody');
  if (!Array.isArray(list) || !list.length) {
    tbody.innerHTML = '<tr class="empty-row"><td colspan="3">No skills found. Click "+ New Skill" to create one.</td></tr>';
    return;
  }
  tbody.innerHTML = list.map(s =>
    '<tr data-id="' + esc(s.id) + '">' +
    '<td><a class="name-link" onclick="viewSkill(\'' + esc(s.id) + '\')">' + esc(s.name || s.id) + '</a></td>' +
    '<td class="mono">' + esc(s.path || '') + '</td>' +
    '<td class="actions"><button class="btn btn-danger btn-sm" onclick="deleteSkill(\'' + esc(s.id) + '\')">Delete</button></td>' +
    '</tr>'
  ).join('');
}

async function submitSkillCreate() {
  const nameEl = document.getElementById('sk-new-name');
  const name = nameEl.value.trim();
  if (!name) {
    document.getElementById('sk-name-err').textContent = 'Name is required';
    nameEl.classList.add('error');
    return;
  }
  document.getElementById('sk-name-err').textContent = '';
  nameEl.classList.remove('error');
  await api('POST', '/api/skills', { name, description: document.getElementById('sk-new-desc').value || '' });
  toggleSkillForm();
  loadSkillList();
}

async function viewSkill(id) {
  selectedSkill = id;
  document.querySelectorAll('#sk-tbody tr').forEach(r => r.classList.toggle('selected', r.dataset.id === id));
  const detail = await api('GET', '/api/skills/' + id);
  document.getElementById('sk-detail-name').textContent = detail.name || id;
  document.getElementById('sk-detail-info').textContent = JSON.stringify(detail, null, 2);
  document.getElementById('sk-detail').classList.add('open');
}

function closeSkillDetail() {
  document.getElementById('sk-detail').classList.remove('open');
  selectedSkill = null;
}

async function deleteSkill(id) {
  if (!confirm('Delete skill "' + id + '"?')) return;
  await api('DELETE', '/api/skills/' + id);
  if (selectedSkill === id) closeSkillDetail();
  loadSkillList();
}

async function readSkillFile() {
  if (!selectedSkill) return;
  const p = document.getElementById('sk-fpath').value;
  const res = await api('GET', '/api/skills/' + selectedSkill + '/file?path=' + encodeURIComponent(p));
  document.getElementById('sk-file-res').textContent = typeof res === 'string' ? res : JSON.stringify(res, null, 2);
}

async function writeSkillFile() {
  if (!selectedSkill) return;
  const res = await api('PUT', '/api/skills/' + selectedSkill + '/file', {
    path: document.getElementById('sk-fpath').value,
    content: document.getElementById('sk-fcontent').value,
  });
  document.getElementById('sk-file-res').textContent = 'Saved: ' + JSON.stringify(res);
}

// ═══ SESSIONS CRUD ═══
async function loadSessionList() {
  const ws = document.getElementById('ss-ws').value;
  const list = await api('GET', '/api/sessions' + (ws ? '?workspacePath=' + encodeURIComponent(ws) : ''));
  const tbody = document.getElementById('ss-tbody');
  if (!Array.isArray(list) || !list.length) {
    tbody.innerHTML = '<tr class="empty-row"><td colspan="4">No sessions found. Start a chat to create one.</td></tr>';
    return;
  }
  tbody.innerHTML = list.map(s => {
    const short = s.id ? s.id.substring(0, 12) + '...' : '';
    return '<tr data-id="' + esc(s.id) + '">' +
      '<td><a class="name-link" onclick="viewSession(\'' + esc(s.id) + '\')" title="' + esc(s.id) + '">' + esc(short) + '</a></td>' +
      '<td>' + esc(s.agentName || '-') + '</td>' +
      '<td class="mono">' + esc(s.workspacePath || '') + '</td>' +
      '<td class="actions">' +
      '<button class="btn btn-secondary btn-sm" onclick="forkSession(\'' + esc(s.id) + '\')">Fork</button>' +
      '<button class="btn btn-danger btn-sm" onclick="deleteSession(\'' + esc(s.id) + '\')">Delete</button>' +
      '</td></tr>';
  }).join('');
}

async function viewSession(id) {
  selectedSession = id;
  document.querySelectorAll('#ss-tbody tr').forEach(r => r.classList.toggle('selected', r.dataset.id === id));
  const info = await api('GET', '/api/sessions/' + id);
  document.getElementById('ss-detail-id').textContent = id;
  document.getElementById('ss-detail-info').textContent = JSON.stringify(info, null, 2);
  document.getElementById('ss-detail').classList.add('open');
}

function closeSessionDetail() {
  document.getElementById('ss-detail').classList.remove('open');
  selectedSession = null;
}

async function deleteSession(id) {
  if (!confirm('Delete this session?')) return;
  await api('DELETE', '/api/sessions/' + id);
  if (selectedSession === id) closeSessionDetail();
  loadSessionList();
}

async function forkSession(id) {
  const res = await api('POST', '/api/sessions/' + id + '/fork');
  appendChat('session', 'Forked: ' + JSON.stringify(res));
  loadSessionList();
}

// ═══ FILES (workspace browser) ═══
async function loadFileTree() {
  const sid = document.getElementById('fi-sid').value.trim();
  if (!sid) { document.getElementById('fi-tree').textContent = 'Enter a session ID first'; return; }
  const tree = await api('GET', '/api/files/' + sid + '/tree');
  _fileClickFn = function (path) { openFile(path); };
  document.getElementById('fi-tree').innerHTML = renderFileTree(tree);
}

async function openFile(path) {
  const sid = document.getElementById('fi-sid').value.trim();
  selectedFilePath = path;
  document.getElementById('fi-current-path').textContent = path;
  document.querySelectorAll('#fi-tree .ft-item').forEach(el => el.classList.toggle('selected', el.dataset.path === path));
  const res = await api('GET', '/api/files/' + sid + '/content?path=' + encodeURIComponent(path));
  document.getElementById('fi-content').value = typeof res === 'object' ? (res.content || JSON.stringify(res, null, 2)) : String(res);
}

async function saveFileContent() {
  const sid = document.getElementById('fi-sid').value.trim();
  if (!sid || !selectedFilePath) return;
  await api('PUT', '/api/files/' + sid + '/content', { path: selectedFilePath, content: document.getElementById('fi-content').value });
  appendChat('session', 'File saved: ' + selectedFilePath);
}

async function createNewFile() {
  const sid = document.getElementById('fi-sid').value.trim();
  if (!sid) return;
  const name = prompt('New file path:');
  if (!name) return;
  await api('POST', '/api/files/' + sid, { path: name, content: '' });
  loadFileTree();
}

async function deleteCurrentFile() {
  const sid = document.getElementById('fi-sid').value.trim();
  if (!sid || !selectedFilePath) return;
  if (!confirm('Delete "' + selectedFilePath + '"?')) return;
  await api('DELETE', '/api/files/' + sid, { path: selectedFilePath });
  document.getElementById('fi-content').value = '';
  document.getElementById('fi-current-path').textContent = 'Select a file';
  selectedFilePath = null;
  loadFileTree();
}

// ─── File tree renderer ───
function renderFileTree(node, prefix) {
  if (!node) return '';
  if (Array.isArray(node)) return node.map(n => renderFileTree(n, '')).join('');
  prefix = prefix || '';
  let html = '';
  if (node.type === 'directory' || node.children) {
    html += '<div class="ft-item ft-dir" data-path="' + esc(node.path || prefix + node.name) + '">' + esc(prefix) + esc(node.name) + '/</div>';
    html += '<div style="display:block;margin-left:12px">';
    if (node.children) html += node.children.map(c => renderFileTree(c, prefix + node.name + '/')).join('');
    html += '</div>';
  } else {
    html += '<div class="ft-item ft-file" data-path="' + esc(node.path || prefix + node.name) + '">' + esc(prefix) + esc(node.name) + '</div>';
  }
  return html;
}

// Event delegation for file tree clicks
document.addEventListener('click', e => {
  const item = e.target.closest('.ft-item');
  if (!item) return;
  if (item.classList.contains('ft-dir')) {
    const next = item.nextElementSibling;
    if (next) next.style.display = next.style.display === 'none' ? 'block' : 'none';
    return;
  }
  if (item.classList.contains('ft-file') && _fileClickFn) {
    _fileClickFn(item.dataset.path);
  }
});

// ─── Agent State ───
let stateES = null;
function watchState() {
  stopStateWatch();
  const sid = document.getElementById('st-sid').value;
  stateES = new EventSource(BASE + '/api/agent/' + sid + '/state');
  stateES.onmessage = e => {
    document.getElementById('st-res').textContent = JSON.stringify(JSON.parse(e.data), null, 2);
  };
  stateES.onerror = () => {
    document.getElementById('st-res').textContent += '[closed]\n';
    stopStateWatch();
  };
}
function stopStateWatch() {
  if (stateES) { stateES.close(); stateES = null; }
}

// ─── Config ───
async function getConfig() {
  document.getElementById('cfg-res').textContent = JSON.stringify(await api('GET', '/api/config'), null, 2);
}
async function patchConfig() {
  try {
    const res = await api('PATCH', '/api/config', JSON.parse(document.getElementById('cfg-patch').value));
    document.getElementById('cfg-res').textContent = JSON.stringify(res, null, 2);
  } catch (e) {
    document.getElementById('cfg-res').textContent = 'Error: ' + e.message;
  }
}

// ─── Init ───
loadAgentList();
