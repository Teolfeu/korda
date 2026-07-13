import test from "node:test";
import assert from "node:assert/strict";
import {
  claimTerminalSession,
  forgetTerminalSession,
  releaseTerminalSession,
  resetTerminalSessionRegistry,
  retainTerminalSession,
} from "../src/terminal-session-registry.js";

test.afterEach(() => resetTerminalSessionRegistry());

test("reattach usa a mesma sessão quando configuração e geração não mudaram", () => {
  retainTerminalSession("agent", { id: "agent-1", cwd: "/tmp", command: "opencode", restartKey: 0 });
  assert.equal(claimTerminalSession("agent", { cwd: "/tmp", command: "opencode", restartKey: 0 })?.id, "agent-1");
  assert.equal(claimTerminalSession("agent", { cwd: "/outro", command: "opencode", restartKey: 0 }), null);
});

test("detach agenda fechamento, mas remount cancela antes do prazo", async () => {
  retainTerminalSession("agent", { id: "agent-1", cwd: "/tmp", command: "opencode", restartKey: 0 });
  let closed = 0;
  releaseTerminalSession("agent", async () => { closed += 1; }, 15);
  claimTerminalSession("agent", { cwd: "/tmp", command: "opencode", restartKey: 0 });
  await new Promise((resolve) => setTimeout(resolve, 25));
  assert.equal(closed, 0);
  assert.equal(forgetTerminalSession("agent")?.id, "agent-1");
});

test("sessão órfã é fechada depois da janela de reattach", async () => {
  retainTerminalSession("agent", { id: "agent-1", cwd: "/tmp", command: "opencode", restartKey: 0 });
  let closedId = null;
  releaseTerminalSession("agent", async (id) => { closedId = id; }, 5);
  await new Promise((resolve) => setTimeout(resolve, 15));
  assert.equal(closedId, "agent-1");
  assert.equal(claimTerminalSession("agent"), null);
});

test("evento atrasado não remove a sessão substituta", () => {
  retainTerminalSession("agent", { id: "agent-new", cwd: "/tmp", command: "opencode", restartKey: 1 });
  assert.equal(forgetTerminalSession("agent", "agent-old"), null);
  assert.equal(claimTerminalSession("agent")?.id, "agent-new");
});
