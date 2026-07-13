const test = require("node:test");
const assert = require("node:assert/strict");
const { createContextBroker } = require("../electron/context-broker.cjs");
const { createRunCoordinator } = require("../electron/run-coordinator.cjs");

test("missão só conclui após resposta, aprovação e finish do orquestrador", async () => {
  const coordinator = createRunCoordinator();
  const runCommand = async ({ action, source, message }) => {
    if (action === "status") return coordinator.brief(source.id).objective;
    if (action === "approve") coordinator.approve(source.id, message);
    else if (action === "finish") coordinator.finish(source.id, message);
    else coordinator.fail(source.id, message);
    return "ok";
  };
  const broker = createContextBroker({
    onRequest: (payload) => coordinator.request(payload),
    onReply: (payload) => coordinator.reply({ ...payload, nodeId: payload.targetId }),
    runCommand,
  });
  broker.sync({
    nodes: [
      { id: "orch", type: "agent", agentName: "Codex", role: "orchestrator" },
      { id: "exec", type: "agent", agentName: "OpenCode", role: "executor" },
      { id: "review", type: "agent", agentName: "Hermes", role: "reviewer" },
    ],
    edges: [{ source: "orch", target: "exec" }, { source: "orch", target: "review" }],
  });
  const orch = broker.connection("orch", "pty-orch");
  const exec = broker.connection("exec", "pty-exec");
  const review = broker.connection("review", "pty-review");
  coordinator.start({ id: "run-1", objective: "entregar feature", successCriteria: "revisão aprovada", orchestratorId: "orch", reviewerId: "review", participantIds: ["exec"], timeoutMs: 5_000 });
  for (const id of ["orch", "exec", "review"]) coordinator.delivered(id);

  assert.equal(await broker.command({ nodeId: "orch", suppliedToken: orch.token, name: "run", args: ["status"] }), "entregar feature");
  const sent = await broker.command({ nodeId: "orch", suppliedToken: orch.token, name: "ask", args: ["OpenCode", "implemente"] });
  const requestId = sent.match(/Pedido ([0-9a-f-]+)/)[1];
  await broker.command({ nodeId: "exec", suppliedToken: exec.token, name: "reply", args: [requestId, "feito"] });
  await assert.rejects(broker.command({ nodeId: "orch", suppliedToken: orch.token, name: "run", args: ["finish", "cedo"] }), /aprovação/);
  await broker.command({ nodeId: "review", suppliedToken: review.token, name: "run", args: ["approve", "aprovado"] });
  await broker.command({ nodeId: "orch", suppliedToken: orch.token, name: "run", args: ["finish", "concluído"] });
  assert.deepEqual(coordinator.snapshot(), {
    id: "run-1", state: "completed", orchestratorId: "orch", reviewerId: "review",
    participantIds: ["orch", "exec", "review"], startedAt: coordinator.snapshot().startedAt,
    updatedAt: coordinator.snapshot().updatedAt, deadlineAt: coordinator.snapshot().deadlineAt,
    deliveredCount: 3, requestCount: 1, replyCount: 1, pendingCount: 0,
    approved: true, finalMessage: "concluído",
  });
  coordinator.close();
  await broker.close();
});
