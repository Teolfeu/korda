function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

export function shouldHandleTerminalSelection(mouseTrackingMode, shiftKey = false) {
  return shiftKey || !mouseTrackingMode || mouseTrackingMode === "none";
}

export function shouldInterceptTerminalSelection({ button, insideScreen, mouseTrackingMode, shiftKey = false }) {
  return button === 0 && insideScreen && shouldHandleTerminalSelection(mouseTrackingMode, shiftKey);
}

export function terminalPointerInsideRect({ clientX, clientY, rect }) {
  return Boolean(rect
    && Number.isFinite(rect.left)
    && Number.isFinite(rect.top)
    && Number.isFinite(rect.width)
    && Number.isFinite(rect.height)
    && rect.width > 0
    && rect.height > 0
    && clientX >= rect.left
    && clientX <= rect.left + rect.width
    && clientY >= rect.top
    && clientY <= rect.top + rect.height);
}

export function terminalCellFromPointer({ clientX, clientY, rect, cols, rows, viewportY = 0 }) {
  if (!rect || !Number.isFinite(rect.width) || !Number.isFinite(rect.height) || rect.width <= 0 || rect.height <= 0) return null;
  if (!Number.isInteger(cols) || cols < 1 || !Number.isInteger(rows) || rows < 1) return null;

  // Mirror xterm's selection caret semantics: the right half of a cell resolves
  // to the following endpoint and the right edge may be `column === cols`.
  const relativeColumn = ((clientX - rect.left) / rect.width) * cols;
  const relativeRow = ((clientY - rect.top) / rect.height) * rows;
  const column = clamp(Math.ceil(relativeColumn + 0.5) - 1, 0, cols);
  const visibleRow = clamp(Math.ceil(relativeRow) - 1, 0, rows - 1);
  return { column, row: Math.max(0, Math.trunc(viewportY) || 0) + visibleRow };
}

export function terminalSelectionRange(anchor, focus, cols) {
  if (!anchor || !focus || !Number.isInteger(cols) || cols < 1) return null;
  const anchorIndex = anchor.row * cols + anchor.column;
  const focusIndex = focus.row * cols + focus.column;
  if (anchorIndex === focusIndex) return null;
  const start = anchorIndex < focusIndex ? anchor : focus;
  return {
    column: start.column,
    row: start.row,
    length: Math.abs(focusIndex - anchorIndex),
  };
}
