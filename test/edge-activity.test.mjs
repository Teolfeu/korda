import test from "node:test";
import assert from "node:assert/strict";
import { clearNodeActivities, edgeActivity, pruneEdgeActivities, updateEdgeActivities } from "../src/edge-activity.js";

test("acompanha pedido, resposta inversa e concorrência na mesma corda", () => {
  const edge = { source: "orch", target: "exec" };
  let state = updateEdgeActivities([], { type: "request", id: "one", sourceId: "orch", targetId: "exec" }, 1);
  state = updateEdgeActivities(state, { type: "request", id: "two", sourceId: "orch", targetId: "exec" }, 2);
  assert.deepEqual(edgeActivity(edge, state), { active: true, phase: "working", direction: "forward", pending: 2 });

  state = updateEdgeActivities(state, { type: "reply", id: "one", sourceId: "orch", targetId: "exec" }, 3);
  assert.deepEqual(edgeActivity(edge, state), { active: true, phase: "returning", direction: "reverse", pending: 1 });
  state = updateEdgeActivities(state, { type: "remove", id: "one", sourceId: "orch", targetId: "exec" }, 4);
  assert.deepEqual(edgeActivity(edge, state), { active: true, phase: "working", direction: "forward", pending: 1 });
  assert.equal(edgeActivity({ source: "other", target: "exec" }, state), null);
  assert.deepEqual(pruneEdgeActivities(state, []), []);
  assert.deepEqual(clearNodeActivities(state, "exec"), []);
});
