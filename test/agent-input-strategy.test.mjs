import test from "node:test";
import assert from "node:assert/strict";
import { agentInputStrategy, shouldAutoSeedAgent } from "../src/agent-input-strategy.js";

test("Hermes recebe tempo próprio para a TUI consumir texto antes do Enter", () => {
  assert.deepEqual(agentInputStrategy("hermes"), { startupDelayMs: 1800, submitDelayMs: 160, pasteDelayMs: 120 });
  assert.deepEqual(agentInputStrategy("codex"), { startupDelayMs: 1200, submitDelayMs: 50, pasteDelayMs: 100 });
});

test("OpenCode termina o cold start antes do protocolo automático", () => {
  assert.deepEqual(agentInputStrategy("opencode"), { startupDelayMs: 6000, submitDelayMs: 80, pasteDelayMs: 100 });
  assert.deepEqual(agentInputStrategy("opencode-demo"), { startupDelayMs: 6000, submitDelayMs: 80, pasteDelayMs: 100 });
});

test("OpenCode nunca recebe protocolo automático como turno pago", () => {
  assert.equal(shouldAutoSeedAgent("opencode"), false);
  assert.equal(shouldAutoSeedAgent("opencode-demo"), false);
  assert.equal(shouldAutoSeedAgent("hermes"), true);
  assert.equal(shouldAutoSeedAgent("codex"), true);
});
