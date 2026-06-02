/* eslint-disable */
// ── Component: ChatRightPanel ──
// Right column: Events / State / Files tabs.

import { html, useState } from '../../utils.js';
import { StatePanel } from '../../components/StatePanel.js';
import { FileTree } from '../../components/FileTree.js';
import { CodeMirrorWrapper } from '../../components/CodeMirrorWrapper.js';
import { EventCard } from './EventCard.js';

export function ChatRightPanel(props) {
  var sessionId = props.sessionId;
  var rightTab = props.rightTab;
  var setRightTab = props.setRightTab;
  var cockpitEvents = props.cockpitEvents;
  var diagnosticsData = props.diagnosticsData;
  var rightFileTree = props.rightFileTree;
  var rightFilePath = props.rightFilePath;
  var rightFileContent = props.rightFileContent;
  var rightSaveStatus = props.rightSaveStatus;
  var openRightFile = props.openRightFile;
  var saveRightFile = props.saveRightFile;
  var setRightFileContent = props.setRightFileContent;
  var evtLogRef = props.evtLogRef;

  var _sSel = useState(null),
    selectedEventId = _sSel[0],
    setSelectedEventId = _sSel[1];

  return html`
    <div class="chat-right">
      ${sessionId
        ? html`
            <div class="right-tabs">
              <button
                class=${'right-tab' + (rightTab === 'events' ? ' active' : '')}
                onClick=${function () {
                  setRightTab('events');
                }}
              >
                Events
              </button>
              <button
                class=${'right-tab' + (rightTab === 'state' ? ' active' : '')}
                onClick=${function () {
                  setRightTab('state');
                }}
              >
                State
              </button>
              <button
                class=${'right-tab' + (rightTab === 'files' ? ' active' : '')}
                onClick=${function () {
                  setRightTab('files');
                }}
              >
                Files
              </button>
            </div>

            <div class="right-content">
              ${rightTab === 'events' &&
                html`
                  <div ref=${evtLogRef} class="right-scrollable">
                    ${cockpitEvents.length === 0 &&
                      html`<div class="right-empty">No events yet.</div>`
                    }
                    ${cockpitEvents.map(function (ev) {
                      return html`<${EventCard}
                        key=${ev.id}
                        tag=${ev.tag}
                        text=${ev.text}
                        id=${ev.id}
                        data=${ev.data}
                        isSelected=${selectedEventId === ev.id}
                        onSelect=${setSelectedEventId}
                      />`;
                    })}
                  </div>
                `}

              ${rightTab === 'state' &&
                html`
                  <div class="right-scrollable">
                    ${diagnosticsData !== null
                      ? html`<${StatePanel} diagnostics=${diagnosticsData} />`
                      : html`<div class="right-empty">Waiting for agent state...</div>`
                    }
                  </div>
                `}

              ${rightTab === 'files' &&
                html`
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
                        ${rightSaveStatus &&
                          html`<span
                            style=${'font-size:11px;color:' +
                              (rightSaveStatus.startsWith('Error')
                                ? 'var(--error)'
                                : rightSaveStatus === 'saving...'
                                  ? 'var(--warning)'
                                  : 'var(--success)')}
                          >
                            ${rightSaveStatus}
                          </span>`
                        }
                      </div>
                    </div>
                  </div>
                `}
            </div>
          `
        : html`
            <div
              style="color:var(--text-muted);font-size:12px;text-align:center;padding:40px 16px"
            >
              Start a chat session to see cockpit events, agent state, and workspace files.
            </div>
          `}
    </div>
  `;
}
