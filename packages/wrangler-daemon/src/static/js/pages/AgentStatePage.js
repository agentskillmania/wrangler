/* eslint-disable */
// ── Page: AgentStatePage ──
import { html } from '../utils.js';
import { useState } from '../utils.js';
import { useEffect } from '../utils.js';
import { api } from '../api.js';
import { StatePanel } from '../components/StatePanel.js';

// ── Page: Agent State ──
export function AgentStatePage() {
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
