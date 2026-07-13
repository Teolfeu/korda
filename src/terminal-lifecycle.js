const ACTIVE = new Set(["starting", "running", "restarting"]);
const RESTARTABLE = new Set(["running", "exited", "failed"]);

export function normalizeExitCode(value) {
  if (typeof value !== "number" && typeof value !== "string") return null;
  if (typeof value === "string" && !value.trim()) return null;
  const code = Number(value);
  return Number.isInteger(code) && code >= 0 ? code : null;
}

export function createTerminalLifecycle() {
  return Object.freeze({ status: "idle", generation: 0, exitCode: null });
}

export function transitionTerminalLifecycle(state = createTerminalLifecycle(), event = {}) {
  const current = state?.status ? state : createTerminalLifecycle();
  let next;

  if (event.type === "start" && ["idle", "exited", "failed"].includes(current.status)) {
    next = { ...current, status: "starting", exitCode: null };
  } else if (event.type === "ready" && ["starting", "restarting"].includes(current.status)) {
    next = { ...current, status: "running", exitCode: null };
  } else if (event.type === "exit" && ACTIVE.has(current.status)) {
    const exitCode = normalizeExitCode(event.exitCode);
    next = { ...current, status: exitCode === 0 ? "exited" : "failed", exitCode };
  } else if (event.type === "restart" && RESTARTABLE.has(current.status)) {
    next = { status: "restarting", generation: current.generation + 1, exitCode: null };
  } else {
    throw new Error(`Transição de terminal inválida: ${current.status} -> ${event.type || "?"}`);
  }

  return Object.freeze(next);
}
