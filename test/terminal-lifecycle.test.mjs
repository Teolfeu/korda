import test from "node:test";
import assert from "node:assert/strict";
import {
  createTerminalLifecycle,
  normalizeExitCode,
  transitionTerminalLifecycle,
} from "../src/terminal-lifecycle.js";

test("inicia idle e avança por starting até running", () => {
  const idle = createTerminalLifecycle();
  const starting = transitionTerminalLifecycle(idle, { type: "start" });
  const running = transitionTerminalLifecycle(starting, { type: "ready" });

  assert.deepEqual(idle, { status: "idle", generation: 0, exitCode: null });
  assert.deepEqual(starting, { status: "starting", generation: 0, exitCode: null });
  assert.deepEqual(running, { status: "running", generation: 0, exitCode: null });
  assert.equal(Object.isFrozen(running), true);
});

test("distingue saída normal de anormal e normaliza exitCode", () => {
  const running = transitionTerminalLifecycle(
    transitionTerminalLifecycle(undefined, { type: "start" }),
    { type: "ready" },
  );

  assert.deepEqual(transitionTerminalLifecycle(running, { type: "exit", exitCode: "0" }), {
    status: "exited", generation: 0, exitCode: 0,
  });
  assert.deepEqual(transitionTerminalLifecycle(running, { type: "exit", exitCode: "17" }), {
    status: "failed", generation: 0, exitCode: 17,
  });
  assert.equal(normalizeExitCode(undefined), null);
  assert.equal(normalizeExitCode("erro"), null);
  assert.equal(normalizeExitCode(-1), null);
});

test("restart aumenta a geração e volta a running quando pronto", () => {
  const failed = Object.freeze({ status: "failed", generation: 2, exitCode: 1 });
  const restarting = transitionTerminalLifecycle(failed, { type: "restart" });
  const running = transitionTerminalLifecycle(restarting, { type: "ready" });

  assert.deepEqual(restarting, { status: "restarting", generation: 3, exitCode: null });
  assert.deepEqual(running, { status: "running", generation: 3, exitCode: null });
  assert.throws(() => transitionTerminalLifecycle(running, { type: "start" }), /inválida/);
});
