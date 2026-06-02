/* eslint-disable */
// ── Component: StatePanel ──
import { html } from '../utils.js';
import { useState } from '../utils.js';
import { JsonTree } from '../components/JsonTree.js';

// ── Shared Component: StatePanel ──
// Structured display of unified agent diagnostics (runner + agent + llm)
export function StatePanel(props) {
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
