const strategies = {
  hermes: { startupDelayMs: 1800, submitDelayMs: 160, pasteDelayMs: 120 },
  // OpenCode can emit its first frame well before OpenTUI finishes mounting.
  // Keep Korda's automatic protocol out of that cold-start window so it is
  // not discarded as an empty prompt or mixed into terminal capability I/O.
  opencode: { startupDelayMs: 6000, submitDelayMs: 80, pasteDelayMs: 100 },
  grok: { startupDelayMs: 1400, submitDelayMs: 80, pasteDelayMs: 100 },
};

export function agentInputStrategy(agentId) {
  return strategies[String(agentId || "").replace(/-demo$/, "")] || { startupDelayMs: 1200, submitDelayMs: 50, pasteDelayMs: 100 };
}

export function shouldAutoSeedAgent(agentId) {
  return String(agentId || "").replace(/-demo$/, "").toLowerCase() !== "opencode";
}
