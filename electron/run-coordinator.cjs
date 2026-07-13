"use strict";

const ACTIVE_STATES = new Set(["preparing", "running", "reviewing"]);
const ID_LIMIT = 120;
const MESSAGE_LIMIT = 240;

function clean(value, limit) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, limit);
}

function requiredId(value, label) {
  const id = clean(value, ID_LIMIT);
  if (!id) throw new Error(`${label} é obrigatório.`);
  return id;
}

function requiredText(value, label) {
  const text = clean(value, 4_000);
  if (!text) throw new Error(`${label} é obrigatório.`);
  return text;
}

function frozen(value) {
  if (value && typeof value === "object") {
    Object.freeze(value);
    for (const child of Object.values(value)) frozen(child);
  }
  return value;
}

function createRunCoordinator({
  now = Date.now,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
  onChange = () => {},
} = {}) {
  let run = null;
  let timer = null;

  const timestamp = () => Number(typeof now === "function" ? now() : now);
  const isActive = () => run && ACTIVE_STATES.has(run.state);

  function snapshot() {
    if (!run) return null;
    return frozen({
      id: run.id,
      state: run.state,
      orchestratorId: run.orchestratorId,
      reviewerId: run.reviewerId,
      participantIds: [...run.participantIds],
      startedAt: run.startedAt,
      updatedAt: run.updatedAt,
      deadlineAt: run.deadlineAt,
      deliveredCount: run.delivered.size,
      requestCount: run.requests.size,
      replyCount: run.replyCount,
      pendingCount: [...run.requests.values()].filter((request) => !request.replied).length,
      approved: run.approved,
      finalMessage: run.finalMessage,
    });
  }

  function changed() {
    run.updatedAt = timestamp();
    onChange(snapshot());
  }

  function clearRunTimer() {
    if (timer !== null) clearTimer(timer);
    timer = null;
  }

  function terminate(state, message) {
    if (!isActive()) throw new Error("Não há missão ativa.");
    run.state = state;
    run.finalMessage = clean(message, MESSAGE_LIMIT);
    clearRunTimer();
    changed();
    return snapshot();
  }

  function member(nodeId) {
    const id = requiredId(nodeId, "Agente");
    if (!run.participantIds.includes(id)) throw new Error("Agente não participa da missão.");
    return id;
  }

  function requireActive() {
    if (!isActive()) throw new Error("Não há missão ativa.");
  }

  function start(config = {}) {
    if (isActive()) throw new Error("Já existe uma missão ativa.");
    const id = requiredId(config.id, "ID da missão");
    const objective = requiredText(config.objective, "Objetivo");
    const successCriteria = requiredText(config.successCriteria, "Critério de sucesso");
    const orchestratorId = requiredId(config.orchestratorId, "Orquestrador");
    const reviewerId = config.reviewerId == null ? null : requiredId(config.reviewerId, "Revisor");
    if (reviewerId === orchestratorId) throw new Error("Orquestrador e revisor devem ser agentes diferentes.");
    const participantIds = [...new Set([
      orchestratorId,
      ...(Array.isArray(config.participantIds) ? config.participantIds.map((value) => requiredId(value, "Participante")) : []),
      ...(reviewerId ? [reviewerId] : []),
    ])];
    const timeoutMs = Number(config.timeoutMs);
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error("Timeout deve ser positivo.");
    const startedAt = timestamp();
    run = {
      id,
      objective,
      successCriteria,
      orchestratorId,
      reviewerId,
      participantIds,
      state: "preparing",
      startedAt,
      updatedAt: startedAt,
      deadlineAt: startedAt + timeoutMs,
      delivered: new Set(),
      requests: new Map(),
      replyCount: 0,
      approved: false,
      finalMessage: "",
    };
    timer = setTimer(() => {
      if (isActive()) terminate("timed_out", "Tempo limite da missão excedido.");
    }, timeoutMs);
    onChange(snapshot());
    return snapshot();
  }

  function delivered(nodeId) {
    requireActive();
    const id = member(nodeId);
    run.delivered.add(id);
    if (id === run.orchestratorId && run.state === "preparing") run.state = "running";
    changed();
    return snapshot();
  }

  function brief(nodeId) {
    requireActive();
    member(nodeId);
    return frozen({
      id: run.id,
      state: run.state,
      objective: run.objective,
      successCriteria: run.successCriteria,
      reviewerId: run.reviewerId,
      deadlineAt: run.deadlineAt,
      pendingCount: [...run.requests.values()].filter((request) => !request.replied).length,
      approved: run.approved,
    });
  }

  function request(payload = {}) {
    requireActive();
    const id = requiredId(payload.id ?? payload.requestId, "ID do pedido");
    if (run.requests.has(id)) throw new Error("Pedido já registrado.");
    const sourceId = member(payload.sourceId);
    const targetId = member(payload.targetId);
    if (sourceId === targetId) throw new Error("Pedido exige agentes diferentes.");
    run.requests.set(id, { sourceId, targetId, replied: false });
    if (run.state === "preparing") run.state = "running";
    changed();
    return snapshot();
  }

  function reply(payload = {}) {
    requireActive();
    const id = requiredId(payload.id ?? payload.requestId, "ID do pedido");
    const requestEntry = run.requests.get(id);
    if (!requestEntry) throw new Error("Pedido não encontrado.");
    const nodeId = member(payload.nodeId ?? payload.sourceId ?? requestEntry.targetId);
    if (nodeId !== requestEntry.targetId) throw new Error("Somente o destinatário pode responder.");
    if (requestEntry.replied) throw new Error("Pedido já respondido.");
    requestEntry.replied = true;
    run.replyCount += 1;
    changed();
    return snapshot();
  }

  function approve(nodeId, message) {
    requireActive();
    if (!run.reviewerId) throw new Error("A missão não possui revisor.");
    if (member(nodeId) !== run.reviewerId) throw new Error("Somente o revisor pode aprovar.");
    run.approved = true;
    run.state = "reviewing";
    run.finalMessage = clean(message, MESSAGE_LIMIT);
    changed();
    return snapshot();
  }

  function finish(nodeId, message) {
    requireActive();
    if (member(nodeId) !== run.orchestratorId) throw new Error("Somente o orquestrador pode concluir.");
    if ([...run.requests.values()].some((requestEntry) => !requestEntry.replied)) throw new Error("Ainda existem pedidos pendentes.");
    if (run.reviewerId && !run.approved) throw new Error("A aprovação do revisor é obrigatória.");
    return terminate("completed", message);
  }

  function fail(nodeId, message) {
    requireActive();
    if (member(nodeId) !== run.orchestratorId) throw new Error("Somente o orquestrador pode falhar a missão.");
    return terminate("failed", message);
  }

  function cancel(reason) {
    return terminate("cancelled", reason || "Missão cancelada.");
  }

  function close() {
    if (isActive()) terminate("cancelled", "Coordenador encerrado.");
    else clearRunTimer();
  }

  return { start, snapshot, brief, delivered, request, reply, approve, finish, fail, cancel, close };
}

module.exports = { createRunCoordinator };
