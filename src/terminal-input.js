const queues = new Map();
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function submitTerminalText(sessionId, write, text, { mode = "auto", pause = wait, submitDelayMs = 50, pasteDelayMs = 100 } = {}) {
  const value = String(text);
  const submit = async () => {
    try {
      if (mode === "raw" || (mode === "auto" && !value.includes("\n"))) {
        // Hermes parses one "text\r" chunk as paste; Return must arrive separately.
        await write(value);
        await pause(submitDelayMs);
        await write("\r");
        return true;
      }
      await write(`\u001b[200~${value}\u001b[201~`);
      await pause(pasteDelayMs);
      await write("\r");
      return true;
    } catch {
      return false;
    }
  };
  const pending = (queues.get(sessionId) || Promise.resolve()).then(submit);
  queues.set(sessionId, pending);
  void pending.finally(() => {
    if (queues.get(sessionId) === pending) queues.delete(sessionId);
  });
  return pending;
}
