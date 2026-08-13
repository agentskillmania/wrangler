/* eslint-disable */
// ── Component: DetailDrawer ──
import { html } from '../utils.js';
import { useState } from '../utils.js';
import { useEffect } from '../utils.js';

// ── Shared Component: DetailDrawer ──
// Right sliding panel with title, tabs, and close button.
export function DetailDrawer(props) {
  var open = props.open;
  var title = props.title;
  var tabs = props.tabs || [];
  var activeTab = props.activeTab || (tabs[0] && tabs[0].key);
  var onTabChange = props.onTabChange;
  var onClose = props.onClose;
  var children = props.children;
  var _useState = useState(activeTab),
    currentTab = _useState[0],
    setCurrentTab = _useState[1];

  useEffect(
    function () {
      if (activeTab) setCurrentTab(activeTab);
    },
    [activeTab]
  );

  if (!open) return null;

  return html`
    <div>
      <div class="drawer-backdrop" onClick=${onClose} />
      <div class="drawer">
        <div class="drawer-header">
          <h3>${title}</h3>
          <button class="btn btn-ghost btn-sm" onClick=${onClose}>Close</button>
        </div>
        ${tabs.length > 0 &&
        html`
          <div class="drawer-tabs">
            ${tabs.map(function (tab) {
              return html`
                <button
                  key=${tab.key}
                  class=${'drawer-tab' + (currentTab === tab.key ? ' active' : '')}
                  onClick=${function () {
                    setCurrentTab(tab.key);
                    if (onTabChange) onTabChange(tab.key);
                  }}
                >
                  ${tab.label}
                </button>
              `;
            })}
          </div>
        `}
        <div class="drawer-body">${children}</div>
      </div>
    </div>
  `;
}
