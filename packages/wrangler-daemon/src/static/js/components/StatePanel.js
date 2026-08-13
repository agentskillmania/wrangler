/* eslint-disable */
// ── Component: StatePanel ──
// Structured display of unified agent diagnostics (runner + agent + llm + session)
import { html } from '../utils.js';
import { useState } from '../utils.js';
import { JsonTree } from '../components/JsonTree.js';

export function StatePanel(props) {
  var diagnostics = props.diagnostics;
  var runner = diagnostics && diagnostics.runner;
  var features = runner && runner.features;
  var runnerTools = runner && runner.tools;
  var runnerSkills = runner && runner.skills;
  var agentState = diagnostics && diagnostics.agent;
  var llmData = diagnostics && diagnostics.llm ? diagnostics.llm : null;
  var systemPrompt = diagnostics && diagnostics.systemPrompt ? diagnostics.systemPrompt : null;
  var session = diagnostics && diagnostics.session ? diagnostics.session : {};
  var overview = session.overview || {};
  var info = session.info || {};
  var llmContext = llmData ? llmData.messages : null;
  var llmTools = llmData ? llmData.tools : null;
  var llmSkill = llmData ? llmData.skill : null;

  var _sOpen = useState({
      raw: false,
      sysprompt: false,
      llmtools: false,
      tools: false,
      skills: false,
      overview: false,
      info: false,
    }),
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

  function fmtNum(n) {
    if (n == null) return '—';
    if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
    return String(n);
  }

  // ── Session Overview ──
  function renderSessionOverview() {
    if (!overview || typeof overview !== 'object') return null;
    return html`
      <div class="sp-card">
        <div class="sp-head">Session Overview</div>
        <div class="sp-grid">
          <div class="sp-cell">
            <div class="sp-label">Agent</div>
            <div class="sp-val">${overview.agentName || '—'}</div>
          </div>
          <div class="sp-cell">
            <div class="sp-label">Model</div>
            <div class="sp-val">${overview.model || '—'}</div>
          </div>
          <div class="sp-cell">
            <div class="sp-label">Status</div>
            <div class="sp-val">${overview.status || '—'}</div>
          </div>
          <div class="sp-cell">
            <div class="sp-label">Steps</div>
            <div class="sp-val">${fmtNum(overview.stepCount)}</div>
          </div>
          <div class="sp-cell">
            <div class="sp-label">Messages</div>
            <div class="sp-val">${fmtNum(overview.messageCount)}</div>
          </div>
          <div class="sp-cell">
            <div class="sp-label">Tokens</div>
            <div class="sp-val">${fmtNum(overview.tokensTotal)}</div>
          </div>
          <div class="sp-cell">
            <div class="sp-label">Ctx Window</div>
            <div class="sp-val">${fmtNum(overview.contextWindow)}</div>
          </div>
          <div class="sp-cell">
            <div class="sp-label">Est. Size</div>
            <div class="sp-val">${fmtNum(overview.estimatedContextSize)}</div>
          </div>
        </div>
        ${overview.title &&
        html`
          <div class="sp-row" style="margin-top:6px">
            <div class="sp-label">Title</div>
            <div class="sp-val">${overview.title}</div>
          </div>
        `}
        <div class="sp-row" style="margin-top:6px">
          <div class="sp-label">Tokens In / Out</div>
          <div class="sp-val">${fmtNum(overview.tokensIn)} / ${fmtNum(overview.tokensOut)}</div>
        </div>
        <div class="sp-row">
          <div class="sp-label">Created</div>
          <div class="sp-val">
            ${overview.createdAt ? new Date(overview.createdAt).toLocaleString() : '—'}
          </div>
        </div>
        <div class="sp-row">
          <div class="sp-label">Updated</div>
          <div class="sp-val">
            ${overview.updatedAt ? new Date(overview.updatedAt).toLocaleString() : '—'}
          </div>
        </div>
      </div>
    `;
  }

  // ── Session Info ──
  function renderSessionInfo() {
    if (!info || typeof info !== 'object') return null;
    return html`
      <div class="sp-card">
        <div
          class="sp-head sp-click"
          onClick=${function () {
            toggle('info');
          }}
        >
          Session Info ${open.info ? '▾' : '▸'}
        </div>
        ${open.info &&
        html`
          <div class="sp-grid">
            <div class="sp-cell">
              <div class="sp-label">Session ID</div>
              <div class="sp-val" style="font-size:11px">${info.sessionId || '—'}</div>
            </div>
            <div class="sp-cell">
              <div class="sp-label">Workspace</div>
              <div class="sp-val" style="font-size:11px">${info.workspacePath || '—'}</div>
            </div>
            <div class="sp-cell">
              <div class="sp-label">Session Path</div>
              <div class="sp-val" style="font-size:11px">${info.sessionPath || '—'}</div>
            </div>
            <div class="sp-cell">
              <div class="sp-label">Agent Config</div>
              <div class="sp-val" style="font-size:11px">${info.agentConfigPath || '—'}</div>
            </div>
          </div>
          <div class="sp-row" style="margin-top:6px">
            <div class="sp-label">Skill Dirs</div>
            <div class="sp-val">
              ${info.skillDirs && info.skillDirs.length > 0 ? info.skillDirs.join(', ') : 'none'}
            </div>
          </div>
          <div class="sp-row">
            <div class="sp-label">MCP Paths</div>
            <div class="sp-val">
              ${info.mcpConfigPaths && info.mcpConfigPaths.length > 0
                ? info.mcpConfigPaths.join(', ')
                : 'none'}
            </div>
          </div>
        `}
      </div>
    `;
  }

  // ── Runner Features ──
  function renderRunnerFeatures() {
    if (!features || typeof features !== 'object') return null;
    var builtinEnabled = [];
    if (Array.isArray(runnerTools)) {
      for (var i = 0; i < runnerTools.length; i++) {
        if (runnerTools[i].enabled) builtinEnabled.push(runnerTools[i].name);
      }
    }
    return html`
      <div class="sp-card">
        <div class="sp-head">Runner Features</div>
        <div class="sp-grid">
          <div class="sp-cell">
            <div class="sp-label">Sandbox</div>
            <div class="sp-val">${features.sandbox ? 'on' : 'off'}</div>
          </div>
          <div class="sp-cell">
            <div class="sp-label">Session</div>
            <div class="sp-val">${features.enableSession ? 'on' : 'off'}</div>
          </div>
          <div class="sp-cell">
            <div class="sp-label">Todolist</div>
            <div class="sp-val">${features.enableTodolist ? 'on' : 'off'}</div>
          </div>
          <div class="sp-cell">
            <div class="sp-label">Commands</div>
            <div class="sp-val">${features.enableCommands ? 'on' : 'off'}</div>
          </div>
          <div class="sp-cell">
            <div class="sp-label">Thinking</div>
            <div class="sp-val">${features.thinkingEnabled ? 'on' : 'off'}</div>
          </div>
          <div class="sp-cell">
            <div class="sp-label">Prompt Thinking</div>
            <div class="sp-val">${features.enablePromptThinking ? 'on' : 'off'}</div>
          </div>
          <div class="sp-cell">
            <div class="sp-label">A2UI</div>
            <div class="sp-val">${features.a2uiEnabled ? 'on' : 'off'}</div>
          </div>
          <div class="sp-cell">
            <div class="sp-label">Compression</div>
            <div class="sp-val">${features.compressorEnabled ? 'on' : 'off'}</div>
          </div>
        </div>
        <div class="sp-row" style="margin-top:6px">
          <div class="sp-label">Enabled Tools</div>
          <div class="sp-val">
            ${builtinEnabled.length > 0 ? builtinEnabled.join(', ') : 'none'}
          </div>
        </div>
      </div>
    `;
  }

  // ── Tool & Skill Registry ──
  function renderRegistries() {
    if ((!runnerTools || runnerTools.length === 0) && (!runnerSkills || runnerSkills.length === 0))
      return null;
    return html`
      <div class="sp-card">
        ${runnerTools && runnerTools.length > 0
          ? html`
              <div
                class="sp-head sp-click"
                onClick=${function () {
                  toggle('tools');
                }}
              >
                Tools (${runnerTools.length}) ${open.tools ? '▾' : '▸'}
              </div>
              ${open.tools &&
              html`<div class="sp-list">
                ${runnerTools.map(function (t) {
                  return html`<div class="sp-list-item">
                    <div class="sp-list-name">
                      ${t.name}
                      ${t.enabled
                        ? ''
                        : html`<span style="color:var(--text-muted);font-size:11px">(off)</span>`}
                    </div>
                    <div class="sp-list-desc">${(t.description || '').substring(0, 120)}</div>
                  </div>`;
                })}
              </div>`}
            `
          : ''}
        ${runnerSkills && runnerSkills.length > 0
          ? html`
              <div
                class="sp-head sp-click"
                style="margin-top:6px"
                onClick=${function () {
                  toggle('skills');
                }}
              >
                Skills (${runnerSkills.length}) ${open.skills ? '▾' : '▸'}
              </div>
              ${open.skills &&
              html`<div class="sp-list">
                ${runnerSkills.map(function (s) {
                  return html`<div class="sp-list-item">
                    <div class="sp-list-name">${s.name}</div>
                    <div class="sp-list-desc">${(s.description || '').substring(0, 120)}</div>
                  </div>`;
                })}
              </div>`}
            `
          : ''}
      </div>
    `;
  }

  // ── Agent ──
  function renderAgent() {
    if (!agentState || typeof agentState !== 'object') return null;
    var name = agentState.name || (agentState.config && agentState.config.name) || 'Untitled';
    var instr =
      agentState.config && agentState.config.instructions
        ? String(agentState.config.instructions)
        : '';
    return html`
      <div class="sp-card">
        <div class="sp-head">Agent</div>
        <div class="sp-row">
          <div class="sp-label">Name</div>
          <div class="sp-val">${name}</div>
        </div>
        ${instr &&
        html`
          <div class="sp-row">
            <div class="sp-label">Instructions</div>
            <div class="sp-pre">${instr}</div>
          </div>
        `}
      </div>
    `;
  }

  // ── Context + LLM ──
  function renderContextAndLLM() {
    var ctx = (agentState && agentState.context) || {};
    var msgs = ctx.messages || [];
    var msgCount = msgs.length;
    var todoItems = ctx.todoList && ctx.todoList.items ? ctx.todoList.items.length : 0;
    var activeSkill = ctx.skillState && ctx.skillState.current ? ctx.skillState.current : 'none';
    var compression = ctx.compression;
    var compressionText =
      compression && compression.summary ? compression.anchor + ' msgs summarized' : 'none';
    var llmMsgCount = Array.isArray(llmContext) ? llmContext.length : 0;
    var llmToolCount = Array.isArray(llmTools) ? llmTools.length : 0;
    var sysPrompt = systemPrompt || '';

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

        ${sysPrompt &&
        html`
          <div
            class="sp-head sp-click"
            style="margin-top:8px"
            onClick=${function () {
              toggle('sysprompt');
            }}
          >
            System Prompt ${open.sysprompt ? '▾' : '▸'}
          </div>
          ${open.sysprompt && html`<div class="sp-pre">${sysPrompt}</div>`}
        `}
        ${llmTools &&
        html`
          <div
            class="sp-head sp-click"
            style="margin-top:6px"
            onClick=${function () {
              toggle('llmtools');
            }}
          >
            LLM Tool Schemas ${open.llmtools ? '▾' : '▸'}
          </div>
          ${open.llmtools && html`<${JsonTree} data=${llmTools} open=${1} />`}
        `}

        <div
          class="sp-head sp-click"
          style="margin-top:6px"
          onClick=${function () {
            toggle('raw');
          }}
        >
          Raw State ${open.raw ? '▾' : '▸'}
        </div>
        ${open.raw && html`<${JsonTree} data=${agentState} open=${1} />`}
        ${llmContext &&
        html`
          <div
            class="sp-head sp-click"
            style="margin-top:6px"
            onClick=${function () {
              toggle('raw');
            }}
          >
            LLM Messages ${open.raw ? '▾' : '▸'}
          </div>
          ${open.raw && html`<${JsonTree} data=${llmContext} open=${1} />`}
        `}
      </div>
    `;
  }

  return html`
    <div class="state-panel">
      ${renderSessionOverview()} ${renderSessionInfo()} ${renderRunnerFeatures()}
      ${renderRegistries()} ${renderAgent()} ${renderContextAndLLM()}
    </div>
  `;
}
