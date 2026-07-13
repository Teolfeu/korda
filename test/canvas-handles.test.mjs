import assert from "node:assert/strict";
import test from "node:test";
import { buildNodeHandles } from "../src/canvas-handles.js";

test("descreve todos os handles do agente antes da medição do DOM", () => {
  const handles = buildNodeHandles({
    type: "agent",
    width: 400,
    height: 240,
    ports: [{ id: "delegate" }, { id: "validate" }, { id: "browser" }, { id: "context" }],
  });

  assert.equal(handles.length, 37);
  assert.deepEqual(handles.find(({ id }) => id === "borda-right-44"), {
    id: "borda-right-44", type: "source", position: "right", x: 394, y: 90, width: 12, height: 31.200000000000003,
  });
  assert.deepEqual(handles.find(({ id }) => id === "input"), {
    id: "input", type: "target", position: "top", x: 197, y: -3, width: 6, height: 6,
  });
  assert.equal(handles.find(({ id }) => id === "delegate").x, 75.5);
});

test("acompanha resize e inclui a porta própria de notas", () => {
  const note = buildNodeHandles({ type: "note", width: 300, height: 180 });
  const resized = buildNodeHandles({ type: "note", width: 600, height: 360 });

  assert.equal(note.length, 34);
  assert.equal(note.find(({ id }) => id === "context").x, 145.5);
  assert.equal(resized.find(({ id }) => id === "context").x, 295.5);
  assert.equal(resized.find(({ id }) => id === "borda-bottom-92").y, 354);
});
