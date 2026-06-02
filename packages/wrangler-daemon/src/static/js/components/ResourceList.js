/* eslint-disable */
// ── Component: ResourceList ──
import { html } from '../utils.js';

// ── Shared Component: ResourceList ──
// Reusable table with columns, items, onSelect, onCreate.
export function ResourceList(props) {
  var columns = props.columns || [];
  var items = props.items || [];
  var onSelect = props.onSelect;
  var onCreate = props.onCreate;
  var onCreateLabel = props.onCreateLabel || 'Create';
  var selectedId = props.selectedId;
  var emptyMessage = props.emptyMessage || 'No items found.';
  var actions = props.actions;

  return html`
    <div>
      <div class="page-toolbar">
        ${onCreate &&
        html`
          <button class="btn btn-primary btn-sm" onClick=${onCreate}>
            + ${onCreateLabel}
          </button>
        `}
      </div>
      <table class="table">
        <thead>
          <tr>
            ${columns.map(
              function (col) {
                return html`
                  <th key=${col.key} style=${col.width ? 'width:' + col.width : ''}>
                    ${col.label}
                  </th>
                `;
              }
            )}
            ${actions &&
            html`<th style="width:120px"></th>`}
          </tr>
        </thead>
        <tbody>
          ${items.length === 0
            ? html`
                <tr class="table-empty">
                  <td colspan=${columns.length + (actions ? 1 : 0)}>${emptyMessage}</td>
                </tr>
              `
            : items.map(
                function (item) {
                  return html`
                    <tr
                      key=${item.id}
                      class=${selectedId === item.id ? 'selected' : ''}
                      onClick=${function () {
                        if (onSelect) onSelect(item);
                      }}
                    >
                      ${columns.map(
                        function (col) {
                          return html`
                            <td key=${col.key} class=${col.mono ? 'mono' : ''}>
                              ${col.render
                                ? col.render(item)
                                : String(item[col.key] || '-')}
                            </td>
                          `;
                        }
                      )}
                      ${actions &&
                      html`
                        <td class="actions">
                          ${actions(item)}
                        </td>
                      `}
                    </tr>
                  `;
                }
              )}
        </tbody>
      </table>
    </div>
  `;
}
