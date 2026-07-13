import assert from "node:assert/strict";
import test from "node:test";
import {
  appendExecutionEvent,
  emptyExecutionLedger,
  finishExecutionRun,
  normalizeExecutionLedger,
  readExecutionLedger,
  startExecutionRun,
  summarizeExecutionLedger,
} from "../src/execution-ledger.js";

test("registra uma execução imutável sem persistir conteúdo sensível", () => {
  const empty = emptyExecutionLedger();
  const started = startExecutionRun(empty, { id: "run-1", workspace: "demo", workspaceId: "ws-demo", orchestratorId: "lead" }, 100);
  const stepped = appendExecutionEvent(started, "run-1", {
    result: "delivered",
    edgeId: "edge-1",
    sourceId: "lead",
    targetId: "worker",
    kind: "delegate",
    message: `Contexto entregue\n${"x".repeat(300)}`,
    terminalOutput: "segredo",
    env: { TOKEN: "não guardar" },
  }, 110);
  const finished = finishExecutionRun(stepped, "run-1", "completed", "Validação concluída", 120);

  assert.equal(empty.runs.length, 0);
  assert.equal(started.runs[0].events.length, 1);
  assert.equal(started.runs[0].events[0].nodeId, "lead");
  assert.equal(started.runs[0].workspaceId, "ws-demo");
  assert.equal(finished.runs[0].status, "completed");
  assert.equal(finished.runs[0].events[1].message.length, 160);
  assert.doesNotMatch(JSON.stringify(finished), /segredo|TOKEN|não guardar|terminalOutput/);
  assert.deepEqual(summarizeExecutionLedger(finished), {
    runs: 1, running: 0, completed: 1, failed: 0, events: 3,
    delivered: 1, blocked: 0, simulated: 0, skipped: 0,
    latestRun: finished.runs[0],
  });
});

test("limita o ledger às 25 execuções e aos 200 eventos mais recentes", () => {
  let ledger = emptyExecutionLedger();
  for (let run = 0; run < 30; run += 1) {
    const id = `run-${run}`;
    ledger = startExecutionRun(ledger, { id }, 1_000 + run * 20);
    for (let event = 0; event < 9; event += 1) {
      ledger = appendExecutionEvent(ledger, id, { result: "simulated", nodeId: `node-${event}`, message: "Prévia" }, 1_001 + run * 20 + event);
    }
    ledger = finishExecutionRun(ledger, id, "completed", "Fim", 1_015 + run * 20);
  }

  const normalized = normalizeExecutionLedger(ledger);
  assert.equal(normalized.runs.length, 25);
  assert.equal(normalized.runs.flatMap((run) => run.events).length, 200);
  assert.equal(normalized.runs[0].id, "run-29");
  assert.equal(normalized.runs.at(-1).events.length, 0);
});

test("rejeita resultados inválidos e alterações após o encerramento", () => {
  const started = startExecutionRun(emptyExecutionLedger(), { id: "run" }, 10);
  assert.throws(() => appendExecutionEvent(started, "run", { result: "inventado" }, 11), /Resultado de etapa inválido/);
  const finished = finishExecutionRun(started, "run", "failed", "Falhou", 12);
  assert.throws(() => appendExecutionEvent(finished, "run", { result: "blocked" }, 13), /execução encerrada/);
});

test("marca como falha uma execução que ficou aberta na sessão anterior", () => {
  const running = startExecutionRun(emptyExecutionLedger(), { id: "run-abandonada" }, 100);
  const storage = { getItem: () => JSON.stringify(running) };
  const restored = readExecutionLedger(storage, 200);

  assert.equal(restored.runs[0].status, "failed");
  assert.equal(restored.runs[0].endedAt, 200);
  assert.equal(restored.runs[0].events.at(-1).result, "failed");
  assert.match(restored.runs[0].events.at(-1).message, /sessão anterior/);
});
