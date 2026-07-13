const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { ensureHermesSkill, listInstalledAgents, resolveInstalledAgent } = require("../electron/agent-registry.cjs");

test("lista somente CLIs conhecidas e executáveis encontradas no PATH", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "korda-agents-"));
  try {
    for (const command of ["hermes-cli", "codex", "opencode", "grok", "claude"]) {
      const executable = path.join(directory, command);
      fs.writeFileSync(executable, "#!/bin/sh\n");
      fs.chmodSync(executable, command === "claude" ? 0o644 : 0o755);
    }

    assert.deepEqual(listInstalledAgents(directory).map(({ id, command }) => ({ id, command })), [
      { id: "hermes", command: "hermes-cli" },
      { id: "codex", command: "codex" },
      { id: "opencode", command: "opencode" },
      { id: "grok", command: "grok" },
    ]);
    assert.equal(resolveInstalledAgent("codex", directory)?.path, path.join(directory, "codex"));
    assert.deepEqual(resolveInstalledAgent("opencode", directory)?.args, [".", "--mini", "--no-replay"]);
    assert.equal(resolveInstalledAgent("codex", directory)?.args, undefined);
    assert.deepEqual(resolveInstalledAgent("hermes-cli", directory)?.args, [
      "--tui",
      "--skills",
      "korda-studio",
      "-m",
      "deepseek-v4-pro",
      "--provider",
      "deepseek",
    ]);
    assert.equal(resolveInstalledAgent("claude", directory), null);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("instala a skill canônica do Hermes sem tocar nas demais skills", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "korda-hermes-home-"));
  const source = path.join(home, "source.md");
  fs.writeFileSync(source, "---\nname: korda-studio\n---\nUse korda reply.\n");
  try {
    const target = ensureHermesSkill(home, source);
    assert.equal(fs.readFileSync(target, "utf8"), fs.readFileSync(source, "utf8"));
    assert.match(target, /skills\/software-development\/korda-studio\/SKILL\.md$/);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("skill canônica ensina o ciclo completo e não repete a instrução obsoleta", () => {
  const skill = fs.readFileSync(path.join(__dirname, "..", "assets", "hermes", "korda-studio", "SKILL.md"), "utf8");
  for (const command of ["korda self", "korda list", "korda inbox", "korda reply", "korda ask", "korda wait"]) assert.match(skill, new RegExp(command));
  assert.doesNotMatch(skill, /korda reply.{0,80}(não existe|not implemented)/is);
});
