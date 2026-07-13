const assert = require("node:assert/strict");
const test = require("node:test");
const {
  createTerminalMetrics,
  recordTerminalIo,
  snapshotTerminalMetrics,
} = require("../electron/terminal-metrics.cjs");

test("mede bytes UTF-8 e publica somente a telemetria permitida", () => {
  const active = createTerminalMetrics({ id: "agent-1", command: "codex", cwd: "/tmp/work", cols: 80, rows: 24 }, 10);
  recordTerminalIo(active, "in", "á", 20);
  recordTerminalIo(active, "out", "ok", 30);
  active.buffer = "conteúdo privado";
  active.env = { TOKEN: "segredo" };

  const closed = createTerminalMetrics({ id: "agent-2", command: "bash", cwd: "/tmp/work", cols: 100, rows: 30 }, 5);
  closed.closed = true;
  closed.closedAt = 40;

  const snapshot = snapshotTerminalMetrics([active, closed], 50);
  assert.deepEqual(snapshot.totals, {
    sessions: 2, active: 1, exited: 0, closed: 1, bytesIn: 2, bytesOut: 2, inputEvents: 1,
  });
  assert.deepEqual(snapshot.terminals.map(({ id }) => id), ["agent-2", "agent-1"]);
  assert.equal(snapshot.terminals[1].lastActivityAt, 30);
  assert.doesNotMatch(JSON.stringify(snapshot), /conteúdo privado|TOKEN|segredo/);
});
