/* eslint-disable */
// ── Component: SessionSelector ──
import { html } from '../utils.js';
import { useState } from '../utils.js';
import { useEffect } from '../utils.js';
import { api } from '../api.js';

// ── Shared Component: SessionSelector ──
// Fetches sessions from /api/sessions, groups by workspacePath,
// and renders a select with optgroup labels.
export function SessionSelector(props) {
  var value = props.value;
  var onChange = props.onChange;
  var placeholder = props.placeholder || 'Choose a session...';
  var _sSess = useState([]),
    sessions = _sSess[0],
    setSessions = _sSess[1];

  // Fetch sessions on mount
  useEffect(function () {
    api
      .get('/api/sessions')
      .then(function (list) {
        setSessions(Array.isArray(list) ? list : []);
      })
      .catch(function () {
        setSessions([]);
      });
  }, []);

  // Group sessions by workspacePath
  var groups = {};
  for (var i = 0; i < sessions.length; i++) {
    var s = sessions[i];
    var wp = s.workspacePath || '(unknown workspace)';
    if (!groups[wp]) groups[wp] = [];
    groups[wp].push(s);
  }

  var groupKeys = Object.keys(groups);

  return html`
    <select
      class="input"
      value=${value}
      onChange=${function (e) {
        if (onChange) onChange(e.target.value);
      }}
    >
      <option value="">${placeholder}</option>
      ${groupKeys.map(function (gk) {
        return html`
          <optgroup key=${gk} label=${gk}>
            ${groups[gk].map(function (sess) {
              // Crew sessions carry crewId on runnerConfig; surface it so
              // the picker distinguishes 'crew/foo — id' from 'agent — id'.
              var crewId = sess.runnerConfig && sess.runnerConfig.crewId;
              var prefix = crewId ? 'crew/' + crewId : sess.agentName || 'unknown';
              var label = prefix + ' — ' + (sess.id || '-');
              return html` <option key=${sess.id} value=${sess.id}>${label}</option> `;
            })}
          </optgroup>
        `;
      })}
    </select>
  `;
}
