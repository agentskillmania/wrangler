/* eslint-disable */
// ── Component: MessageList ──
// Render an array of SessionEntry objects into chat message HTML.
// Shared by SessionsPage detail panel (and potentially other consumers).

import { html } from '../utils.js';
import { esc } from '../utils.js';

/**
 * @param {object} props
 * @param {Array<object>} props.entries - SessionEntry array from API
 * @param {number} [props.maxLen=2000] - Max chars before truncation
 */
export function MessageList(props) {
  var entries = props.entries || [];
  var maxLen = props.maxLen || 2000;

  return html`
    <div>
      ${entries.map(function (entry, idx) {
        if (entry.role === 'user') {
          return html`
            <div key=${entry.id || idx} class="chat-msg chat-msg-user">
              <div class="chat-msg-body">${esc(entry.content || '')}</div>
            </div>
          `;
        }
        if (entry.role === 'assistant') {
          var content = entry.content || '';
          var truncated = content.length > maxLen;
          var display = truncated ? content.slice(0, maxLen) + '...[truncated]' : content;
          return html`
            <div key=${entry.id || idx} class="chat-msg chat-msg-assistant">
              <div class="chat-msg-body"><pre style="white-space:pre-wrap;margin:0">${esc(display)}</pre></div>
            </div>
          `;
        }
        if (entry.role === 'tool') {
          var toolContent = entry.result || '(no result)';
          var toolTruncated = toolContent.length > maxLen;
          var toolDisplay = toolTruncated ? toolContent.slice(0, maxLen) + '...[truncated]' : toolContent;
          var argsContent = entry.toolArguments || '';
          var argsTruncated = argsContent.length > maxLen;
          var argsDisplay = argsTruncated ? argsContent.slice(0, maxLen) + '...[truncated]' : argsContent;
          return html`
            <div key=${entry.id || idx} class="chat-msg" style="background:rgba(139,148,158,0.06);border-left:3px solid var(--accent-secondary)">
              <div class="chat-msg-body" style="font-size:12px">
                <div style="font-weight:600;color:var(--accent-secondary)">[tool] ${esc(entry.toolName || 'unknown')}</div>
                ${argsContent && html`<pre style="white-space:pre-wrap;margin:4px 0;font-size:11px;color:var(--text-muted)">${esc(argsDisplay)}</pre>`}
                <pre style="white-space:pre-wrap;margin:4px 0">${esc(toolDisplay)}</pre>
              </div>
            </div>
          `;
        }
        if (entry.role === 'error') {
          return html`
            <div key=${entry.id || idx} class="chat-msg chat-msg-error">
              <div class="chat-msg-body">${esc(entry.errorMessage || entry.content || 'Unknown error')}</div>
            </div>
          `;
        }
        // system or unknown
        return html`
          <div key=${entry.id || idx} class="chat-msg" style="background:var(--bg-secondary);color:var(--text-muted)">
            <div class="chat-msg-body" style="font-size:12px">${esc(entry.content || '')}</div>
          </div>
        `;
      })}
    </div>
  `;
}
