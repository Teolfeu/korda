import test from "node:test";
import assert from "node:assert/strict";
import {
  shouldInterceptTerminalSelection,
  terminalCellFromPointer,
  terminalPointerInsideRect,
  terminalSelectionRange,
  shouldHandleTerminalSelection,
} from "../src/terminal-selection.js";

const visible = { left: 100, top: 50, width: 520, height: 240 };

test("mapeia o ponteiro proporcionalmente em qualquer zoom visual", () => {
  for (const zoom of [0.65, 1, 1.4]) {
    const rect = { ...visible, width: visible.width * zoom, height: visible.height * zoom };
    const cell = terminalCellFromPointer({
      clientX: rect.left + rect.width * 0.625,
      clientY: rect.top + rect.height * 0.75,
      rect,
      cols: 80,
      rows: 24,
      viewportY: 40,
    });
    assert.deepEqual(cell, { column: 50, row: 57 });
  }
});

test("limita coordenadas às células visíveis e soma viewportY", () => {
  assert.deepEqual(terminalCellFromPointer({ clientX: 0, clientY: 999, rect: visible, cols: 80, rows: 24, viewportY: 12 }), { column: 0, row: 35 });
  assert.equal(terminalCellFromPointer({ clientX: 0, clientY: 0, rect: { ...visible, width: 0 }, cols: 80, rows: 24 }), null);
});

test("produz seleção direta, reversa e multilinha para terminal.select", () => {
  assert.equal(terminalSelectionRange({ column: 3, row: 7 }, { column: 3, row: 7 }, 80), null);
  assert.deepEqual(terminalSelectionRange({ column: 3, row: 7 }, { column: 9, row: 7 }, 80), { column: 3, row: 7, length: 6 });
  assert.deepEqual(terminalSelectionRange({ column: 9, row: 7 }, { column: 3, row: 7 }, 80), { column: 3, row: 7, length: 6 });
  assert.deepEqual(terminalSelectionRange({ column: 75, row: 7 }, { column: 4, row: 9 }, 80), { column: 75, row: 7, length: 89 });
  assert.deepEqual(terminalSelectionRange({ column: 80, row: 7 }, { column: 4, row: 9 }, 80), { column: 80, row: 7, length: 84 });
});

test("mantém linhas absolutas quando o viewport rola durante o arraste", () => {
  const anchor = terminalCellFromPointer({
    clientX: visible.left + 12,
    clientY: visible.top + 10,
    rect: visible,
    cols: 80,
    rows: 24,
    viewportY: 120,
  });
  const focusAfterScroll = terminalCellFromPointer({
    clientX: visible.left + visible.width - 2,
    clientY: visible.top + visible.height - 2,
    rect: visible,
    cols: 80,
    rows: 24,
    viewportY: 128,
  });
  assert.deepEqual(anchor, { column: 2, row: 120 });
  assert.deepEqual(focusAfterScroll, { column: 80, row: 151 });
  assert.deepEqual(terminalSelectionRange(anchor, focusAfterScroll, 80), {
    column: 2,
    row: 120,
    length: 2558,
  });
});

test("usa hit-test geométrico mesmo quando o target DOM não é a tela", () => {
  assert.equal(terminalPointerInsideRect({ clientX: 100, clientY: 50, rect: visible }), true);
  assert.equal(terminalPointerInsideRect({ clientX: 620, clientY: 290, rect: visible }), true);
  assert.equal(terminalPointerInsideRect({ clientX: 99, clientY: 50, rect: visible }), false);
  assert.equal(terminalPointerInsideRect({ clientX: 100, clientY: 291, rect: visible }), false);
});

test("respeita mouse do TUI, com Shift como override", () => {
  assert.equal(shouldHandleTerminalSelection("none", false), true);
  assert.equal(shouldHandleTerminalSelection("any", false), false);
  assert.equal(shouldHandleTerminalSelection("drag", true), true);
});

test("intercepta somente o botão primário dentro da tela do xterm", () => {
  assert.equal(shouldInterceptTerminalSelection({ button: 0, insideScreen: true, mouseTrackingMode: "none" }), true);
  assert.equal(shouldInterceptTerminalSelection({ button: 1, insideScreen: true, mouseTrackingMode: "none" }), false);
  assert.equal(shouldInterceptTerminalSelection({ button: 0, insideScreen: false, mouseTrackingMode: "none" }), false);
  assert.equal(shouldInterceptTerminalSelection({ button: 0, insideScreen: true, mouseTrackingMode: "any" }), false);
  assert.equal(shouldInterceptTerminalSelection({ button: 0, insideScreen: true, mouseTrackingMode: "any", shiftKey: true }), true);
});
