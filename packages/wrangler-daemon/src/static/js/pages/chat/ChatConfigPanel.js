/* eslint-disable */
// ── Component: ChatConfigPanel ──
// Left column: agent selection, workspace path, runner config, AskHuman response.

import { html } from '../../utils.js';
import { SessionSelector } from '../../components/SessionSelector.js';

export function ChatConfigPanel(props) {
  var agents = props.agents;
  var selectedAgent = props.selectedAgent;
  var setSelectedAgent = props.setSelectedAgent;
  var workspacePath = props.workspacePath;
  var setWorkspacePath = props.setWorkspacePath;
  var sessionId = props.sessionId;
  var resumeSessionId = props.resumeSessionId;
  var setResumeSessionId = props.setResumeSessionId;
  var configOpen = props.configOpen;
  var setConfigOpen = props.setConfigOpen;
  var advOpen = props.advOpen;
  var setAdvOpen = props.setAdvOpen;
  var askRequestId = props.askRequestId;
  var setAskRequestId = props.setAskRequestId;
  var askResponse = props.askResponse;
  var setAskResponse = props.setAskResponse;
  var sendAskResponse = props.sendAskResponse;
  var cfgSandbox = props.cfgSandbox;
  var setCfgSandbox = props.setCfgSandbox;
  var cfgSession = props.cfgSession;
  var setCfgSession = props.setCfgSession;
  var cfgTodolist = props.cfgTodolist;
  var setCfgTodolist = props.setCfgTodolist;
  var cfgCommands = props.cfgCommands;
  var setCfgCommands = props.setCfgCommands;
  var cfgBShell = props.cfgBShell;
  var setCfgBShell = props.setCfgBShell;
  var cfgBWebSearch = props.cfgBWebSearch;
  var setCfgBWebSearch = props.setCfgBWebSearch;
  var cfgBWebFetch = props.cfgBWebFetch;
  var setCfgBWebFetch = props.setCfgBWebFetch;
  var cfgBPython = props.cfgBPython;
  var setCfgBPython = props.setCfgBPython;
  var cfgBGit = props.cfgBGit;
  var setCfgBGit = props.setCfgBGit;
  var cfgBFileRead = props.cfgBFileRead;
  var setCfgBFileRead = props.setCfgBFileRead;
  var cfgBFileWrite = props.cfgBFileWrite;
  var setCfgBFileWrite = props.setCfgBFileWrite;
  var cfgBFileEdit = props.cfgBFileEdit;
  var setCfgBFileEdit = props.setCfgBFileEdit;
  var cfgBGlob = props.cfgBGlob;
  var setCfgBGlob = props.setCfgBGlob;
  var cfgBGrep = props.cfgBGrep;
  var setCfgBGrep = props.setCfgBGrep;
  var cfgA2ui = props.cfgA2ui;
  var setCfgA2ui = props.setCfgA2ui;
  var cfgSkillDirs = props.cfgSkillDirs;
  var setCfgSkillDirs = props.setCfgSkillDirs;
  var cfgMcpPaths = props.cfgMcpPaths;
  var setCfgMcpPaths = props.setCfgMcpPaths;

  return html`
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
          ${agents.map(function (a) {
            return html` <option key=${a.id} value=${a.id}>${a.name || a.id}</option> `;
          })}
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
      `}
      ${sessionId && html`<div class="config-lock-banner">🔒 Session active — config locked</div>`}
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
      `}

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
      `}
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
          <button class="btn btn-secondary btn-sm" style="width:100%" onClick=${sendAskResponse}>
            Send Response
          </button>
        </div>
      `}
    </div>
  `;
}
