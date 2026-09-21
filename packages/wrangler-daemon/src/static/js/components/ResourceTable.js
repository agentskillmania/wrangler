/**
 * ResourceTable — generic resource listing used by the resource pages.
 * columns: [{key, label, mono?, render?(item)}]
 * actions: (item) => vdom (optional per-row action buttons)
 */
import { html } from '../utils.js';

export function ResourceTable({
  columns,
  items,
  selectedId,
  onSelect,
  emptyMessage = '这里还没有内容。',
  actions,
}) {
  return html`
    <div class="res-table">
      <div class="res-row res-head">
        ${columns.map((c) => html`<div class="res-cell ${c.mono ? 'mono' : ''}">${c.label}</div>`)}
        ${actions && html`<div class="res-cell res-actions-cell" />`}
      </div>
      ${items.length === 0 && html`<div class="res-empty">${emptyMessage}</div>`}
      ${items.map(
        (item) => html`
          <div
            key=${item.id || item.path}
            class="res-row ${selectedId && selectedId === (item.id || item.name) ? 'selected' : ''}"
            onClick=${() => onSelect && onSelect(item)}
          >
            ${columns.map(
              (c) => html`
                <div class="res-cell ${c.mono ? 'mono' : ''}">
                  ${c.render ? c.render(item) : (item[c.key] ?? '')}
                </div>
              `
            )}
            ${actions &&
            html`
              <div class="res-cell res-actions-cell" onClick=${(e) => e.stopPropagation()}>
                ${actions(item)}
              </div>
            `}
          </div>
        `
      )}
    </div>
  `;
}
