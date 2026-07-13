import assert from "node:assert/strict";
import test from "node:test";
import { activityWindow, recordLocalRun, summarizeSession } from "../src/session-metrics.js";

test("resume apenas telemetria real e associa PTYs aos agentes", () => {
  const now = new Date(2026, 6, 11, 12).getTime();
  const result = summarizeSession({
    now,
    snapshot: { now, terminals: [
      { id: "pty-a", createdAt: now - 120_000, bytesIn: 2048, bytesOut: 1024, inputEvents: 3 },
      { id: "pty-b", createdAt: now - 60_000, bytesIn: 12, bytesOut: 6, writes: 2, exited: true, exitedAt: now - 10_000 },
    ] },
    nodes: [
      { id: "a", data: { role: "orchestrator", agentName: "Codex", command: "codex" } },
      { id: "b", data: { role: "reviewer", agentName: "Grok", command: "grok" } },
    ],
    edges: [{ id: "corda" }],
    sessionBindings: { a: "pty-a", b: "pty-b" },
    activity: { runs: 4, packets: 9, days: {} },
  });
  assert.deepEqual({ active: result.activeTerminals, agents: result.activeAgents, bytesIn: result.bytesIn, events: result.inputEvents, runs: result.runs }, { active: 1, agents: 1, bytesIn: 2060, events: 5, runs: 4 });
  assert.equal(result.agents[1].duration, 50_000);
  assert.equal(result.cords, 1);
});

test("registra execuções por dia e gera a janela local de 12 semanas", () => {
  const now = new Date(2026, 6, 11, 12).getTime();
  const activity = recordLocalRun({ runs: 1, packets: 2, days: {} }, 3, now);
  const days = activityWindow(activity.days, now);
  assert.deepEqual({ runs: activity.runs, packets: activity.packets, cells: days.length, today: days.at(-1).count }, { runs: 2, packets: 5, cells: 84, today: 1 });
});

test("isola terminais pelo workspace e separa histórico total da janela visível", () => {
  const now = new Date(2026, 6, 11, 12).getTime();
  const result = summarizeSession({
    now,
    workspaceRoot: "/work/atual",
    snapshot: { now, terminals: [
      { id: "atual", cwd: "/work/atual/packages/app", createdAt: now - 20_000, bytesOut: 8 },
      { id: "antigo", cwd: "/work/antigo", createdAt: now - 40_000, bytesOut: 100 },
    ] },
    activity: { runs: 20, packets: -4, days: { "2026-07-11": 1, "2020-01-01": 19 } },
  });
  assert.deepEqual({ terminals: result.terminals, bytesOut: result.bytesOut, runs: result.runs, windowRuns: result.windowRuns, packets: result.packets }, {
    terminals: 1, bytesOut: 8, runs: 20, windowRuns: 1, packets: 0,
  });
});
