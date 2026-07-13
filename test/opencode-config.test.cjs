const test = require("node:test");
const assert = require("node:assert/strict");
const { KORDA_OPENCODE_PROMPT, kordaOpenCodeConfig } = require("../electron/opencode-config.cjs");

test("injeta o protocolo Korda como prompt de sistema do OpenCode", () => {
  const config = JSON.parse(kordaOpenCodeConfig());
  assert.match(config.agent.build.prompt, /^You are running inside Korda,/);
  assert.doesNotMatch(config.agent.build.prompt, /Korda Studio/);
  assert.match(config.agent.build.prompt, /korda self/);
  assert.match(config.agent.build.prompt, /korda ask/);
  assert.match(config.agent.build.prompt, /Orchestrator/);
});

test("preserva configuração e prompt do usuário", () => {
  const source = JSON.stringify({ theme: "system", agent: { build: { prompt: "Minha regra", temperature: 0.2 }, review: { mode: "subagent" } } });
  const config = JSON.parse(kordaOpenCodeConfig(source));
  assert.equal(config.theme, "system");
  assert.equal(config.agent.build.temperature, 0.2);
  assert.equal(config.agent.review.mode, "subagent");
  assert.ok(config.agent.build.prompt.startsWith(KORDA_OPENCODE_PROMPT));
  assert.match(config.agent.build.prompt, /Minha regra/);
});
