import test from "node:test";
import assert from "node:assert/strict";
import { findCanvasPosition } from "../src/canvas-placement.js";

test("posiciona novos blocos no primeiro espaço livre sem sobreposição", () => {
  const first = { x: 120, y: 110, width: 700, height: 460 };
  assert.deepEqual(findCanvasPosition([], first), { x: 120, y: 110 });
  assert.deepEqual(findCanvasPosition([first], { width: 470, height: 321 }), { x: 920, y: 110 });
  assert.deepEqual(findCanvasPosition([first], { width: 700, height: 460 }, true), { x: 50, y: 630 });
});
