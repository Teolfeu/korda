export function createTerminalStartupTracker(expectedId) {
  let exited = false;
  let exitCode;

  return Object.freeze({
    accepts(payload) {
      return payload?.id === expectedId;
    },
    recordExit(payload) {
      if (payload?.id !== expectedId) return false;
      exited = true;
      exitCode = payload.exitCode;
      return true;
    },
    complete(session) {
      if (!session?.id) throw new Error("PTY não retornou um ID de sessão");
      if (session.id !== expectedId) throw new Error("PTY retornou uma sessão inesperada");
      return Object.freeze({ ready: !exited, exitCode: exitCode ?? null });
    },
  });
}
