const STORAGE_KEY = "korda.execution-ledger.v1";
const MAX_RUNS = 25;
const MAX_EVENTS = 200;
const RUN_STATUSES = new Set(["running", "completed", "failed"]);
const EVENT_RESULTS = new Set(["started", "delivered", "blocked", "simulated", "skipped", "completed", "failed"]);
const STEP_RESULTS = new Set(["delivered", "blocked", "simulated", "skipped"]);

const object = (value) => value && typeof value === "object" && !Array.isArray(value);
const time = (value) => Number.isFinite(Number(value)) && Number(value) > 0 ? Number(value) : 0;
const short = (value, limit = 120) => typeof value === "string"
  ? value.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, limit)
  : "";

function normalizeEvent(value) {
  if (!object(value) || !EVENT_RESULTS.has(value.result) || !time(value.at)) return null;
  const event = {
    id: short(value.id) || `event-${time(value.at)}`,
    at: time(value.at),
    result: value.result,
    message: short(value.message, 160),
  };
  for (const field of ["nodeId", "edgeId", "sourceId", "targetId", "kind"]) {
    const content = short(value[field]);
    if (content) event[field] = content;
  }
  return event;
}

function normalizeRun(value) {
  if (!object(value) || !short(value.id) || !time(value.startedAt)) return null;
  const run = {
    id: short(value.id),
    startedAt: time(value.startedAt),
    status: RUN_STATUSES.has(value.status) ? value.status : "running",
    events: Array.isArray(value.events) ? value.events.map(normalizeEvent).filter(Boolean) : [],
  };
  const workspace = short(value.workspace);
  const workspaceId = short(value.workspaceId);
  const orchestratorId = short(value.orchestratorId);
  const endedAt = time(value.endedAt);
  if (workspace) run.workspace = workspace;
  if (workspaceId) run.workspaceId = workspaceId;
  if (orchestratorId) run.orchestratorId = orchestratorId;
  if (endedAt) run.endedAt = endedAt;
  return run;
}

function limitLedger(runs) {
  let remainingEvents = MAX_EVENTS;
  return {
    version: 1,
    runs: runs.slice(0, MAX_RUNS).map((run) => {
      const events = remainingEvents ? run.events.slice(-remainingEvents) : [];
      remainingEvents -= events.length;
      return { ...run, events };
    }),
  };
}

export function emptyExecutionLedger() {
  return { version: 1, runs: [] };
}

export function normalizeExecutionLedger(value) {
  if (!object(value) || !Array.isArray(value.runs)) return emptyExecutionLedger();
  return limitLedger(value.runs.map(normalizeRun).filter(Boolean));
}

function closeInterruptedRuns(ledger, now) {
  const endedAt = time(now) || Date.now();
  return limitLedger(ledger.runs.map((run) => run.status === "running" ? {
    ...run,
    status: "failed",
    endedAt,
    events: [...run.events, normalizeEvent({
      id: `${run.id}-interrupted`,
      at: endedAt,
      result: "failed",
      message: "Execução interrompida ao encerrar a sessão anterior",
    })],
  } : run));
}

export function readExecutionLedger(storage = globalThis.localStorage, now = Date.now()) {
  try { return closeInterruptedRuns(normalizeExecutionLedger(JSON.parse(storage?.getItem(STORAGE_KEY) || "null")), now); }
  catch { return emptyExecutionLedger(); }
}

export function saveExecutionLedger(ledger, storage = globalThis.localStorage) {
  try { storage?.setItem(STORAGE_KEY, JSON.stringify(normalizeExecutionLedger(ledger))); }
  catch { /* armazenamento local pode estar bloqueado */ }
}

export function startExecutionRun(ledger, metadata = {}, now = Date.now()) {
  if (!object(metadata)) throw new TypeError("Metadados da execução inválidos.");
  const current = normalizeExecutionLedger(ledger);
  const startedAt = time(now);
  if (!startedAt) throw new TypeError("Timestamp de início inválido.");
  const id = short(metadata.id) || `run-${startedAt}-${current.runs.length + 1}`;
  if (current.runs.some((run) => run.id === id)) throw new Error(`Execução já registrada: ${id}.`);
  const run = normalizeRun({
    id,
    startedAt,
    status: "running",
    workspace: metadata.workspace,
    workspaceId: metadata.workspaceId,
    orchestratorId: metadata.orchestratorId,
    events: [{ id: `${id}-started`, at: startedAt, result: "started", nodeId: metadata.orchestratorId, message: metadata.message || "Execução iniciada" }],
  });
  return limitLedger([run, ...current.runs]);
}

export function appendExecutionEvent(ledger, runId, event, now = Date.now()) {
  const current = normalizeExecutionLedger(ledger);
  const id = short(runId);
  const run = current.runs.find((item) => item.id === id);
  if (!run) throw new Error(`Execução não encontrada: ${id || "(sem ID)"}.`);
  if (run.status !== "running") throw new Error("Não é possível alterar uma execução encerrada.");
  if (!object(event) || !STEP_RESULTS.has(event.result)) throw new TypeError("Resultado de etapa inválido.");
  const at = time(now);
  if (!at) throw new TypeError("Timestamp de evento inválido.");
  const nextEvent = normalizeEvent({ ...event, id: `${id}-${at}-${run.events.length}`, at });
  return limitLedger(current.runs.map((item) => item.id === id
    ? { ...item, events: [...item.events, nextEvent] }
    : item));
}

export function finishExecutionRun(ledger, runId, result = "completed", message = "", now = Date.now()) {
  if (result !== "completed" && result !== "failed") throw new TypeError("Resultado final inválido.");
  const current = normalizeExecutionLedger(ledger);
  const id = short(runId);
  const run = current.runs.find((item) => item.id === id);
  if (!run) throw new Error(`Execução não encontrada: ${id || "(sem ID)"}.`);
  if (run.status !== "running") throw new Error("A execução já foi encerrada.");
  const endedAt = time(now);
  if (!endedAt) throw new TypeError("Timestamp final inválido.");
  const finalEvent = normalizeEvent({ id: `${id}-${result}`, at: endedAt, result, message: message || (result === "completed" ? "Execução concluída" : "Execução falhou") });
  return limitLedger(current.runs.map((item) => item.id === id
    ? { ...item, status: result, endedAt, events: [...item.events, finalEvent] }
    : item));
}

export function summarizeExecutionLedger(ledger) {
  const current = normalizeExecutionLedger(ledger);
  const events = current.runs.flatMap((run) => run.events);
  const count = (result) => events.filter((event) => event.result === result).length;
  return {
    runs: current.runs.length,
    running: current.runs.filter((run) => run.status === "running").length,
    completed: current.runs.filter((run) => run.status === "completed").length,
    failed: current.runs.filter((run) => run.status === "failed").length,
    events: events.length,
    delivered: count("delivered"),
    blocked: count("blocked"),
    simulated: count("simulated"),
    skipped: count("skipped"),
    latestRun: current.runs[0] || null,
  };
}

export const EXECUTION_RESULTS = Object.freeze(["delivered", "blocked", "simulated", "skipped", "completed", "failed"]);
