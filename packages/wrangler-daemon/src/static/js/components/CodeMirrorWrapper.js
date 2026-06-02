/* eslint-disable */
// ── Component: CodeMirrorWrapper ──
import { html } from '../utils.js';
import { useRef } from '../utils.js';
import { useEffect } from '../utils.js';

// ── Shared Component: CodeMirrorWrapper ──
// Mounts a CodeMirror 5 instance. Syncs value in (props.value → editor)
// and value out (editor change → props.onChange).
export function CodeMirrorWrapper(props) {
  var containerRef = useRef(null);
  var cmRef = useRef(null);
  var value = props.value;
  var onChange = props.onChange;
  var mode = props.mode || 'markdown';
  var readOnly = props.readOnly || false;

  // Create CM instance on mount
  useEffect(function () {
    if (!containerRef.current || !window.CodeMirror) return;
    var cm = window.CodeMirror(containerRef.current, {
      value: value || '',
      mode: mode,
      theme: 'monokai',
      lineNumbers: true,
      lineWrapping: true,
      readOnly: readOnly,
      indentWithTabs: false,
      tabSize: 2,
    });
    cm.on('change', function () {
      if (onChange) onChange(cm.getValue());
    });
    cmRef.current = cm;
    return function () {
      if (cmRef.current) {
        cmRef.current = null;
        containerRef.current.innerHTML = '';
      }
    };
  }, []);

  // Sync external value changes into the editor
  useEffect(
    function () {
      var cm = cmRef.current;
      if (!cm) return;
      if (cm.getValue() !== (value || '')) {
        cm.setValue(value || '');
      }
    },
    [value]
  );

  // Update readOnly when prop changes
  useEffect(
    function () {
      if (cmRef.current) cmRef.current.setOption('readOnly', readOnly);
    },
    [readOnly]
  );

  return html`<div ref=${containerRef} style="flex:1;min-height:200px;overflow:hidden" />`;
}
