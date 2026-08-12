import { forwardRef, useEffect, useRef } from 'react';

/**
 * Processa auto resize textarea conforme as regras do dominio.
 */
const AutoResizeTextarea = forwardRef(function AutoResizeTextarea({
  value,
  onChange,
  minRows = 1,
  maxRows = 5,
  className = '',
  ...props
}, forwardedRef) {
  const ref = useRef(null);

  useEffect(() => {
    const textarea = ref.current;
    if (!textarea) return;

    const lineHeight = parseFloat(window.getComputedStyle(textarea).lineHeight) || 20;
    const minHeight = lineHeight * minRows;
    const maxHeight = lineHeight * maxRows;

    textarea.style.height = 'auto';
    textarea.style.height = `${Math.max(minHeight, Math.min(textarea.scrollHeight, maxHeight))}px`;
    textarea.style.overflowY = textarea.scrollHeight > maxHeight ? 'auto' : 'hidden';
  }, [value, minRows, maxRows]);

  return (
    <textarea
      {...props}
      ref={elemento => {
        ref.current = elemento;
        if (typeof forwardedRef === 'function') forwardedRef(elemento);
        else if (forwardedRef) forwardedRef.current = elemento;
      }}
      className={`auto-resize-textarea ${className}`.trim()}
      value={value ?? ''}
      onChange={onChange}
      rows={minRows}
      title={String(value || '')}
    />
  );
});

export default AutoResizeTextarea;
