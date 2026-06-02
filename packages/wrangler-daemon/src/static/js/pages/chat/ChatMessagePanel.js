/* eslint-disable */
// ── Component: ChatMessagePanel ──
// Middle column: chat messages display + input bar.

import { html } from '../../utils.js';
import { EventCard } from './EventCard.js';

export function ChatMessagePanel(props) {
  var sessionId = props.sessionId;
  var chatLines = props.chatLines;
  var message = props.message;
  var setMessage = props.setMessage;
  var sendMessage = props.sendMessage;
  var stopChat = props.stopChat;
  var streaming = props.streaming;
  var msgThinking = props.msgThinking;
  var setMsgThinking = props.setMsgThinking;
  var msgModel = props.msgModel;
  var setMsgModel = props.setMsgModel;
  var modelInfo = props.modelInfo;
  var formatTokens = props.formatTokens;
  var fetchModelInfo = props.fetchModelInfo;
  var messagesEndRef = props.messagesEndRef;
  var setChatLines = props.setChatLines;
  var setCockpitEvents = props.setCockpitEvents;
  var setSessionId = props.setSessionId;

  return html`
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
            if (line.tag === 'think') {
              return html`
                <div key=${line.id} class="chat-msg chat-msg-thinking">
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
            return html`<${EventCard}
              key=${line.id}
              tag=${line.tag}
              text=${line.text}
              id=${line.id}
              data=${line.data}
            />`;
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
        <label
          style=${{
            display: 'flex',
            alignItems: 'center',
            gap: '4px',
            cursor: 'pointer',
            fontSize: '12px',
            color: 'var(--text-secondary)',
          }}
        >
          <input
            type="checkbox"
            checked=${msgThinking}
            onChange=${function (e) {
              setMsgThinking(e.target.checked);
            }}
          />
          Deep think
        </label>
        <input
          class="input"
          style="width:140px;font-size:12px;padding:4px 8px"
          placeholder="model (e.g. gpt-4o)"
          value=${msgModel}
          onInput=${function (e) {
            setMsgModel(e.target.value);
            fetchModelInfo(e.target.value);
          }}
        />
        ${modelInfo &&
          html`<span class="model-info-bar">
            ${formatTokens(modelInfo.contextWindow)} ctx · ${formatTokens(modelInfo.maxTokens)} out · reasoning ${modelInfo.reasoning ? '✓' : '✗'}
          </span>`
        }
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
  `;
}
