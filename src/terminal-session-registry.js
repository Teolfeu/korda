const sessions = new Map();

function validId(value) {
  return typeof value === "string" && value.length > 0;
}

export function retainTerminalSession(nodeId, session) {
  if (!validId(nodeId) || !session || !validId(session.id)) {
    throw new TypeError("Sessão de terminal inválida.");
  }
  const previous = sessions.get(nodeId);
  if (previous?.disposeTimer) clearTimeout(previous.disposeTimer);
  const retained = { ...session, disposeTimer: null };
  sessions.set(nodeId, retained);
  return retained;
}

export function claimTerminalSession(nodeId, expected = {}) {
  const session = sessions.get(nodeId);
  if (!session) return null;
  if ((expected.cwd !== undefined && session.cwd !== expected.cwd)
    || (expected.command !== undefined && session.command !== expected.command)
    || (expected.restartKey !== undefined && session.restartKey !== expected.restartKey)) {
    return null;
  }
  if (session.disposeTimer) clearTimeout(session.disposeTimer);
  session.disposeTimer = null;
  return session;
}

export function releaseTerminalSession(nodeId, close, delayMs = 2_000, expectedId) {
  const session = sessions.get(nodeId);
  if (expectedId && session?.id !== expectedId) return false;
  if (!session || session.disposeTimer) return false;
  session.disposeTimer = setTimeout(async () => {
    if (sessions.get(nodeId) !== session) return;
    sessions.delete(nodeId);
    try { await close(session.id); } catch { /* processo já encerrado */ }
  }, delayMs);
  return true;
}

export function forgetTerminalSession(nodeId, expectedId) {
  const session = sessions.get(nodeId);
  if (expectedId && session?.id !== expectedId) return null;
  if (!session) return null;
  if (session.disposeTimer) clearTimeout(session.disposeTimer);
  sessions.delete(nodeId);
  return session;
}

export function resetTerminalSessionRegistry() {
  for (const session of sessions.values()) {
    if (session.disposeTimer) clearTimeout(session.disposeTimer);
  }
  sessions.clear();
}
