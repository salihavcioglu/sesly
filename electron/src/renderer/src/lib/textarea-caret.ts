/** Viewport coordinates of a textarea caret, including wrapping and scrolling. */
export function textareaCaret(field: HTMLTextAreaElement): { left: number; top: number } {
  const box = field.getBoundingClientRect();
  const style = getComputedStyle(field);
  const mirror = document.createElement('div');
  for (const property of Array.from(style))
    mirror.style.setProperty(property, style.getPropertyValue(property));
  Object.assign(mirror.style, {
    position: 'fixed',
    visibility: 'hidden',
    pointerEvents: 'none',
    left: '0',
    top: '0',
    width: `${field.clientWidth}px`,
    height: 'auto',
    minHeight: '0',
    maxHeight: 'none',
    boxSizing: 'border-box',
    border: '0',
    whiteSpace: 'pre-wrap',
    overflowWrap: 'break-word',
    overflow: 'hidden',
  });
  mirror.textContent = field.value.slice(0, field.selectionStart);
  const marker = document.createElement('span');
  marker.textContent = field.value.slice(field.selectionStart) || '\u200b';
  mirror.append(marker);
  document.body.append(mirror);
  const lineHeight = parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.5;
  const left = box.left + field.clientLeft + marker.offsetLeft - field.scrollLeft;
  const top = box.top + field.clientTop + marker.offsetTop - field.scrollTop + lineHeight;
  mirror.remove();
  return {
    left: Math.max(box.left, Math.min(left, box.right)),
    top: Math.max(box.top, Math.min(top, box.bottom)),
  };
}
