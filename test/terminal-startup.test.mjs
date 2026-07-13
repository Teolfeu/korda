import test from "node:test";
import assert from "node:assert/strict";
import { createTerminalStartupTracker } from "../src/terminal-startup.js";

test("aceita eventos iniciais somente da sessão prevista", () => {
  const startup = createTerminalStartupTracker("agent-123");
  assert.equal(startup.accepts({ id: "agent-123" }), true);
  assert.equal(startup.accepts({ id: "outra" }), false);
  assert.deepEqual(startup.complete({ id: "agent-123" }), { ready: true, exitCode: null });
});

test("saída antes do retorno de createTerminal impede ready", () => {
  const startup = createTerminalStartupTracker("fast-123");
  assert.equal(startup.recordExit({ id: "fast-123", exitCode: 1 }), true);
  assert.deepEqual(startup.complete({ id: "fast-123" }), { ready: false, exitCode: 1 });
});

test("saída precoce sem código também impede ready", () => {
  const startup = createTerminalStartupTracker("fast-no-code");
  startup.recordExit({ id: "fast-no-code" });
  assert.deepEqual(startup.complete({ id: "fast-no-code" }), { ready: false, exitCode: null });
});

test("rejeita sessão retornada com identidade inesperada", () => {
  const startup = createTerminalStartupTracker("expected");
  assert.throws(() => startup.complete({ id: "other" }), /inesperada/);
});
