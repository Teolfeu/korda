const test = require("node:test");
const assert = require("node:assert/strict");
const { createRunCoordinator } = require("../electron/run-coordinator.cjs");

function setup() {
  let clock = 100;
  let timeout;
  const changes = [];
  const coordinator = createRunCoordinator({
    now: () => clock++,
    setTimer: (callback, delay) => { timeout = { callback, delay, cleared: false }; return timeout; },
    clearTimer: (handle) => { handle.cleared = true; },
    onChange: (value) => changes.push(value),
  });
  return { coordinator, changes, timeout: () => timeout };
}

const config = (extra = {}) => ({
  id: "run-1",
  objective: "implementar sem vazar este texto",
  successCriteria: "testes verdes",
  orchestratorId: "orch",
  participantIds: ["exec"],
  timeoutMs: 1_000,
  ...extra,
});

test("conclui sem revisor apenas pelo orquestrador e não conclui na entrega", () => {
  const { coordinator, timeout } = setup();
  assert.equal(coordinator.start(config()).state, "preparing");
  assert.equal(coordinator.delivered("orch").state, "running");
  assert.throws(() => coordinator.finish("exec", "não"), /orquestrador/);
  const result = coordinator.finish("orch", "  Feito\n com sucesso  ");
  assert.equal(result.state, "completed");
  assert.equal(result.finalMessage, "Feito com sucesso");
  assert.equal(timeout().cleared, true);
});

test("exige aprovação do revisor antes da conclusão", () => {
  const { coordinator } = setup();
  coordinator.start(config({ reviewerId: "review" }));
  coordinator.delivered("orch");
  assert.throws(() => coordinator.finish("orch", "cedo"), /aprovação/);
  assert.throws(() => coordinator.approve("exec", "não"), /revisor/);
  assert.equal(coordinator.approve("review", "Aprovado").state, "reviewing");
  assert.equal(coordinator.finish("orch", "Pronto").state, "completed");
});

test("registra somente metadados de pedidos e rejeita respostas inválidas", () => {
  const { coordinator } = setup();
  coordinator.start(config());
  const afterRequest = coordinator.request({ id: "req-1", sourceId: "orch", targetId: "exec", body: "segredo" });
  assert.equal(afterRequest.requestCount, 1);
  assert.equal(afterRequest.pendingCount, 1);
  assert.doesNotMatch(JSON.stringify(afterRequest), /segredo|implementar|testes verdes/);
  assert.throws(() => coordinator.reply({ id: "req-1", nodeId: "orch", body: "segredo 2" }), /destinatário/);
  assert.throws(() => coordinator.finish("orch", "cedo"), /pendentes/);
  const afterReply = coordinator.reply({ id: "req-1", nodeId: "exec", body: "resposta completa" });
  assert.equal(afterReply.replyCount, 1);
  assert.equal(afterReply.pendingCount, 0);
  assert.throws(() => coordinator.reply({ id: "req-1", nodeId: "exec" }), /já respondido/);
});

test("entrega o briefing somente a participantes sem expô-lo no snapshot", () => {
  const { coordinator } = setup();
  coordinator.start(config());
  assert.deepEqual(coordinator.brief("exec"), {
    id: "run-1", state: "preparing", objective: "implementar sem vazar este texto",
    successCriteria: "testes verdes", reviewerId: null, deadlineAt: 1_100,
    pendingCount: 0, approved: false,
  });
  assert.throws(() => coordinator.brief("intruso"), /não participa/);
  assert.doesNotMatch(JSON.stringify(coordinator.snapshot()), /implementar|testes verdes/);
});

test("timeout, cancelamento e falha são estados terminais honestos", () => {
  const timed = setup();
  timed.coordinator.start(config());
  assert.equal(timed.timeout().delay, 1_000);
  timed.timeout().callback();
  assert.equal(timed.coordinator.snapshot().state, "timed_out");
  assert.throws(() => timed.coordinator.delivered("orch"), /ativa/);

  const cancelled = setup();
  cancelled.coordinator.start(config());
  assert.equal(cancelled.coordinator.cancel("Usuário cancelou").state, "cancelled");

  const failed = setup();
  failed.coordinator.start(config());
  assert.equal(failed.coordinator.fail("orch", "CLI encerrou").state, "failed");
});

test("bloqueia uma segunda missão ativa e snapshots são imutáveis", () => {
  const { coordinator, changes } = setup();
  const first = coordinator.start(config({ participantIds: ["exec", " exec "] }));
  assert.throws(() => coordinator.start(config({ id: "run-2" })), /missão ativa/);
  assert.equal(Object.isFrozen(first), true);
  assert.equal(Object.isFrozen(first.participantIds), true);
  assert.throws(() => first.participantIds.push("intruso"), TypeError);
  assert.equal(coordinator.snapshot().participantIds.includes("intruso"), false);
  assert.notEqual(coordinator.snapshot(), coordinator.snapshot());
  assert.equal(changes.length, 1);
});

test("normaliza IDs e limita a mensagem final", () => {
  const { coordinator } = setup();
  coordinator.start(config({ id: `  ${"x".repeat(140)}  ` }));
  const result = coordinator.finish("orch", ` ${"a".repeat(300)} `);
  assert.equal(result.id.length, 120);
  assert.equal(result.finalMessage.length, 240);
  assert.throws(() => setup().coordinator.start(config({ objective: "  " })), /Objetivo/);
});
