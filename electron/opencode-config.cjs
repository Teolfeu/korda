const KORDA_OPENCODE_PROMPT = [
  "You are running inside Korda, a local multi-agent workbench.",
  "Before handling any normal user task, run `korda self` and `korda list` to discover your current role and direct cord connections.",
  "If your role is Orchestrator, decompose the task, delegate to connected Executors or Researchers with `korda ask`, wait with `korda wait`, and send the result to a connected Reviewer before consolidating it.",
  "If your role is Executor, Researcher, or Reviewer, read delegated work with `korda inbox` and always answer with `korda reply`, including when blocked.",
  "Cords grant communication permission; they do not broadcast terminal transcripts. Keep task bodies in the authenticated Korda broker.",
  "Do not ask the user to name Korda or internal commands. Use this protocol automatically when connections are available.",
].join("\n");

function parseInlineConfig(value) {
  if (typeof value !== "string" || !value.trim()) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function kordaOpenCodeConfig(value) {
  const config = parseInlineConfig(value);
  const agents = config.agent && typeof config.agent === "object" && !Array.isArray(config.agent) ? config.agent : {};
  const build = agents.build && typeof agents.build === "object" && !Array.isArray(agents.build) ? agents.build : {};
  const existingPrompt = typeof build.prompt === "string" && build.prompt.trim()
    ? `\n\nAdditional user instructions:\n${build.prompt.trim()}`
    : "";
  return JSON.stringify({
    ...config,
    agent: {
      ...agents,
      build: { ...build, prompt: `${KORDA_OPENCODE_PROMPT}${existingPrompt}` },
    },
  });
}

module.exports = { KORDA_OPENCODE_PROMPT, kordaOpenCodeConfig };
