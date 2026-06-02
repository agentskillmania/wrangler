/* eslint-disable */
// ── Component: JsonTree ──
import { html } from '../utils.js';
import { useRef } from '../utils.js';
import { useEffect } from '../utils.js';

// ── Shared Component: JsonTree ──
// Thin wrapper around json-formatter-js. Mounts into a ref'd container.
export function JsonTree(props) {
  var containerRef = useRef(null);
  var data = props.data;
  var open = props.open || 1;

  useEffect(
    function () {
      if (!containerRef.current || data === undefined || data === null) return;
      containerRef.current.innerHTML = '';
      try {
        var formatter = new window.JSONFormatter(data, open, { theme: 'dark' });
        containerRef.current.appendChild(formatter.render());
      } catch (e) {
        containerRef.current.textContent = String(data);
      }
    },
    [data, open]
  );

  return html`<div ref=${containerRef} class="json-tree-container" />`;
}
