/**
 * CodeEditor — CodeMirror 5 wrapper (loaded globally from vendor/).
 * Syncs value in (props.value → editor) and out (editor → props.onChange).
 */
import { html, useRef, useEffect } from '../utils.js';

export function CodeEditor({
  value,
  onChange,
  mode = 'markdown',
  readOnly = false,
  minHeight = 200,
}) {
  const containerRef = useRef(null);
  const cmRef = useRef(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    if (!containerRef.current || !window.CodeMirror) return;
    const cm = window.CodeMirror(containerRef.current, {
      value: value || '',
      mode,
      theme: 'monokai',
      lineNumbers: true,
      lineWrapping: true,
      readOnly,
      indentWithTabs: false,
      tabSize: 2,
    });
    cm.on('change', () => onChangeRef.current && onChangeRef.current(cm.getValue()));
    cmRef.current = cm;
    return () => {
      cmRef.current = null;
      if (containerRef.current) containerRef.current.innerHTML = '';
    };
  }, []);

  useEffect(() => {
    const cm = cmRef.current;
    if (!cm) return;
    if (cm.getValue() !== (value || '')) cm.setValue(value || '');
  }, [value]);

  useEffect(() => {
    if (cmRef.current) cmRef.current.setOption('readOnly', readOnly);
  }, [readOnly]);

  return html`<div ref=${containerRef} style=${{ flex: 1, minHeight, overflow: 'hidden' }} />`;
}
