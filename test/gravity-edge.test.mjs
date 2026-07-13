import assert from "node:assert/strict";
import test from "node:test";
import { getGravityPath, inferEdgeKind } from "../src/gravity-edge.js";

test("gera o cabo frouxo do Maestri sem geometria inválida", () => {
  const horizontal = getGravityPath({ sourceX: 0, sourceY: 20, targetX: 200, targetY: 20 });
  const vertical = getGravityPath({ sourceX: 10, sourceY: 20, targetX: 110, targetY: 220 });
  const long = getGravityPath({ sourceX: 0, sourceY: 0, targetX: 5000, targetY: 100 });

  assert.equal(horizontal.path, "M 0 20 C 50 66, 150 66, 200 20");
  assert.equal(vertical.path, "M 10 20 C 10 164, 65 220, 110 220");
  assert.ok(horizontal.labelY > 20);
  assert.ok(vertical.labelY < 220);
  assert.equal(long.sag, 120);
  assert.ok(!long.path.includes("NaN"));
});

test("infere a função da corda sem exigir pontos semânticos", () => {
  const nodes = [
    { id: "lead", type: "agent", data: { role: "orchestrator" } },
    { id: "worker", type: "agent", data: { role: "executor" } },
    { id: "review", type: "agent", data: { role: "reviewer" } },
    { id: "web", type: "browser" },
    { id: "note", type: "note" },
  ];

  assert.equal(inferEdgeKind({ source: "lead", target: "worker" }, nodes), "delegate");
  assert.equal(inferEdgeKind({ source: "lead", target: "review" }, nodes), "validate");
  assert.equal(inferEdgeKind({ source: "worker", target: "web" }, nodes), "browser");
  assert.equal(inferEdgeKind({ source: "lead", target: "note" }, nodes), "context");
  assert.equal(inferEdgeKind({ source: "lead", target: "worker", sourceHandle: "browser" }, nodes), "browser");
  assert.equal(inferEdgeKind({ source: "missing", target: "also-missing" }, nodes), "context");
});
