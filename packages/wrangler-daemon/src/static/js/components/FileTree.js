/* eslint-disable */
// ── Component: FileTree ──
import { html } from '../utils.js';
import { useState } from '../utils.js';

// ── Shared Component: FileTree ──
// Recursive directory tree with expand/collapse.
export function FileTree(props) {
  var nodes = props.nodes || [];
  var onSelect = props.onSelect;
  var selectedPath = props.selectedPath;

  var _useState2 = useState({}),
    expanded = _useState2[0],
    setExpanded = _useState2[1];

  function toggleDir(path) {
    setExpanded(function (prev) {
      var next = Object.assign({}, prev);
      next[path] = !prev[path];
      return next;
    });
  }

  function renderNode(node, depth) {
    if (!node) return null;
    var isDir = node.type === 'directory' || (node.children && node.children.length > 0);
    var path = node.path || node.name;
    var indent = { paddingLeft: (depth || 0) * 16 + 'px' };

    if (isDir) {
      var isExpanded = expanded[path] !== false;
      return html`
        <div key=${path}>
          <div
            class="ft-item ft-dir"
            style=${indent}
            onClick=${function (e) {
              e.stopPropagation();
              toggleDir(path);
            }}
          >
            ${isExpanded ? '▾' : '▸'} ${node.name}/
          </div>
          <div class=${'ft-children' + (isExpanded ? '' : ' collapsed')}>
            ${(node.children || []).map(
              function (child) {
                return renderNode(child, (depth || 0) + 1);
              }
            )}
          </div>
        </div>
      `;
    }

    return html`
      <div
        key=${path}
        class=${'ft-item ft-file' + (selectedPath === path ? ' selected' : '')}
        style=${indent}
        onClick=${function (e) {
          e.stopPropagation();
          if (onSelect) onSelect(path);
        }}
      >
        ${node.name}
      </div>
    `;
  }

  if (Array.isArray(nodes)) {
    return html`
      <div class="file-tree">
        ${nodes.map(
          function (n) {
            return renderNode(n, 0);
          }
        )}
      </div>
    `;
  }

  return html`<div class="file-tree">${renderNode(nodes, 0)}</div>`;
}
