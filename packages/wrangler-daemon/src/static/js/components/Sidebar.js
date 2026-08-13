/* eslint-disable */
// ── Component: Sidebar ──
import { html } from '../utils.js';
import { useState } from '../utils.js';

// ── Sidebar Component ──
// Collapsible groups with navigation items.
export function Sidebar(props) {
  var currentPage = props.currentPage;
  var onNavigate = props.onNavigate;
  var _sGr = useState({
      resources: true,
      conversation: true,
      devtools: true,
    }),
    groups = _sGr[0],
    setGroups = _sGr[1];

  function toggleGroup(key) {
    setGroups(function (prev) {
      var next = Object.assign({}, prev);
      next[key] = !prev[key];
      return next;
    });
  }

  var navItems = [
    {
      key: 'resources',
      label: 'Resources',
      items: [
        { id: 'agents', label: 'Agents' },
        { id: 'skills', label: 'Skills' },
        { id: 'crews', label: 'Crews' },
      ],
    },
    {
      key: 'conversation',
      label: 'Conversation',
      items: [
        { id: 'chat', label: 'Chat' },
        { id: 'crew-chat', label: 'Crew Chat' },
        { id: 'sessions', label: 'Sessions' },
      ],
    },
    {
      key: 'devtools',
      label: 'Dev Tools',
      items: [
        { id: 'specs', label: 'Specs' },
        { id: 'plans', label: 'Plans' },
        { id: 'config', label: 'Config' },
      ],
    },
  ];

  return html`
    <nav class="sidebar">
      <div class="sidebar-logo">wrangler<span>-daemon</span></div>
      ${navItems.map(function (group) {
        return html`
          <div class="sidebar-group" key=${group.key}>
            <div
              class="sidebar-group-title"
              onClick=${function () {
                toggleGroup(group.key);
              }}
            >
              ${group.label}
              <span class=${'toggle-icon' + (groups[group.key] ? '' : ' collapsed')}> ▾ </span>
            </div>
            <div class=${'sidebar-group-items' + (groups[group.key] ? '' : ' collapsed')}>
              ${group.items.map(function (item) {
                return html`
                  <button
                    key=${item.id}
                    class=${'sidebar-item' + (currentPage === item.id ? ' active' : '')}
                    onClick=${function () {
                      onNavigate(item.id);
                    }}
                  >
                    ${item.label}
                  </button>
                `;
              })}
            </div>
          </div>
        `;
      })}
    </nav>
  `;
}
