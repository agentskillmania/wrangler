/* eslint-disable */
// ── Component: EventCard ──
// Displays a single event in the chat or cockpit event log.

import { html, useState } from '../../utils.js';
import { JsonTree } from '../../components/JsonTree.js';

// Event card config — unified tag + color map for ALL daemon event types
var TAG_COLORS = {
  user: { label: 'you', bg: 'rgba(88,166,255,0.08)', fg: 'var(--accent)' },
  token: { label: 'assistant', bg: 'rgba(63,185,80,0.12)', fg: 'var(--success)' },
  think: { label: 'thinking', bg: 'rgba(168,85,247,0.08)', fg: '#a855f7' },
  tool: { label: 'tool', bg: 'rgba(210,153,34,0.15)', fg: '#d29922' },
  'tool-call': { label: 'tool call', bg: 'rgba(210,153,34,0.15)', fg: '#d29922' },
  'tool-result': { label: 'tool result', bg: 'rgba(56,139,253,0.12)', fg: '#58a6ff' },
  error: { label: 'error', bg: 'rgba(248,81,73,0.12)', fg: 'var(--error)' },
  done: { label: 'done', bg: 'rgba(88,166,255,0.12)', fg: 'var(--accent)' },
  session: { label: 'session', bg: 'rgba(88,166,255,0.12)', fg: 'var(--accent)' },
  skill: { label: 'skill', bg: 'rgba(168,85,247,0.12)', fg: '#a855f7' },
  step: { label: 'step', bg: 'rgba(139,148,158,0.06)', fg: 'var(--text-muted)' },
  phase: { label: 'phase', bg: 'rgba(139,148,158,0.06)', fg: 'var(--text-muted)' },
  llm: { label: 'llm', bg: 'rgba(139,148,158,0.06)', fg: 'var(--text-muted)' },
  subagent: { label: 'subagent', bg: 'rgba(168,85,247,0.12)', fg: '#a855f7' },
  ask: { label: 'ask', bg: 'rgba(88,166,255,0.12)', fg: 'var(--accent)' },
};

// Map raw SSE event name to card tag
export function eventToTag(ev) {
  if (ev === 'session-start') return 'session';
  if (ev === 'token') return 'token';
  if (ev === 'thinking') return 'think';
  if (ev === 'tool-start') return 'tool-call';
  if (ev === 'tool-end') return 'tool-result';
  if (ev === 'skill-loading' || ev === 'skill-loaded' || ev === 'skill-start' || ev === 'skill-end') return 'skill';
  if (ev === 'step-start' || ev === 'step-end') return 'step';
  if (ev === 'phase-change') return 'phase';
  if (ev === 'llm-request' || ev === 'llm-response') return 'llm';
  if (ev === 'subagent-start' || ev === 'subagent-end') return 'subagent';
  if (ev === 'compressing' || ev === 'compressed') return 'step';
  if (ev === 'waiting-human' || ev === 'human-input' || ev === 'human-input-resolved') return 'ask';
  if (ev === 'error') return 'error';
  if (ev === 'done') return 'done';
  if (ev === 'agent-state') return 'session';
  if (ev === 'runner-config') return 'session';
  if (ev === 'message' || ev === 'raw') return 'step';
  if (ev.startsWith('devtool:')) return 'step';
  console.warn('[playground] Unmapped SSE event type:', ev);
  return 'step';
}

// Format event data into human-readable text
export function formatEventData(ev, p) {
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
  if (ev === 'compressing') return 'Compressing context...';
  if (ev === 'compressed') return 'Context compressed: ' + (p.summary || '') + ' (' + (p.removedCount || 0) + ' removed)';
  if (ev === 'waiting-human') return 'Waiting for human input: ' + JSON.stringify(p.request || {});
  if (ev === 'human-input') {
    var questions = Array.isArray(p.questions) ? p.questions.join('; ') : String(p.questions || '');
    return 'Human input requested (' + (p.requestId || '') + '): ' + questions;
  }
  if (ev === 'human-input-resolved') return 'Human input resolved: ' + (p.requestId || '');
  if (ev.startsWith('devtool:')) {
    if (ev === 'devtool:token') return p.delta || '';
    if (ev === 'devtool:thinking') return p.content || '';
    if (ev === 'devtool:tool-start') return 'Devtool tool: ' + (p.name || '') + '\n' + JSON.stringify(p.args || {}, null, 2);
    if (ev === 'devtool:tool-end') return 'Devtool tool done: ' + (p.callId || '') + ' -> ' + String(p.result || '');
    if (ev === 'devtool:round-start') return 'Round ' + ((p.round || 0) + 1) + ' / ' + (p.maxRounds || '?');
    if (ev === 'devtool:generation-done') return 'Generation complete';
    if (ev === 'devtool:review-start') return 'Review starting...';
    if (ev === 'devtool:review-done') return 'Review done: ' + (p.passed ? 'PASSED' : 'FAILED');
    if (ev === 'devtool:complete') return 'Devtool complete';
    if (ev === 'devtool:error') return 'Devtool error: ' + (p.message || '');
    return 'Devtool: ' + ev;
  }
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

var COLLAPSE_THRESHOLD = 300;

export function EventCard(props) {
  var tag = props.tag;
  var text = props.text;
  var id = props.id;
  var data = props.data;
  var isSelected = props.isSelected;
  var onSelect = props.onSelect;

  var _sExp = useState({}),
    expandedCards = _sExp[0],
    setExpandedCards = _sExp[1];

  var isLong = text && text.length > COLLAPSE_THRESHOLD;
  var isExpanded = expandedCards[id];
  var displayText = isLong && !isExpanded ? text.substring(0, COLLAPSE_THRESHOLD) : text;

  function toggleCard(cardId) {
    setExpandedCards(function (prev) {
      var next = Object.assign({}, prev);
      next[cardId] = !prev[cardId];
      return next;
    });
  }

  function onHeaderClick() {
    if (isLong) {
      toggleCard(id);
    } else if (onSelect) {
      onSelect(isSelected ? null : id);
    }
  }

  function onDetailToggle(e) {
    e.stopPropagation();
    if (onSelect) onSelect(isSelected ? null : id);
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
