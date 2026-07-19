const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { ensureHermesSkill, listInstalledAgents, resolveCommandExecutable, resolveInstalledAgent } = require("../electron/agent-registry.cjs");

function writeExecutable(directory, command, mode = 0o755) {
  const executable = path.join(directory, command);
  fs.writeFileSync(executable, "#!/bin/sh\n");
  fs.chmodSync(executable, mode);
  return executable;
}

test("lista somente CLIs conhecidas e executáveis encontradas no PATH", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "korda-agents-"));
  try {
    for (const command of ["hermes-cli", "codex", "opencode", "grok", "claude", "kimi", "gemini", "aider", "cursor-agent", "qwen", "copilot"]) {
      writeExecutable(directory, command, command === "claude" ? 0o644 : 0o755);
    }

    assert.deepEqual(listInstalledAgents(directory).map(({ id, command }) => ({ id, command })), [
      { id: "hermes", command: "hermes-cli" },
      { id: "codex", command: "codex" },
      { id: "opencode", command: "opencode" },
      { id: "grok", command: "grok" },
      { id: "kimi", command: "kimi" },
      { id: "gemini", command: "gemini" },
      { id: "aider", command: "aider" },
      { id: "cursor-agent", command: "cursor-agent" },
      { id: "qwen", command: "qwen" },
      { id: "copilot", command: "copilot" },
    ]);
    assert.equal(resolveInstalledAgent("codex", directory)?.path, path.join(directory, "codex"));
    assert.deepEqual(resolveInstalledAgent("opencode", directory)?.args, ["."]);
    assert.equal(resolveInstalledAgent("codex", directory)?.args, undefined);
    assert.equal(resolveInstalledAgent("kimi", directory)?.path, path.join(directory, "kimi"));
    assert.equal(resolveInstalledAgent("kimi", directory)?.args, undefined);
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

test("agentes conhecidos resolvem por qualquer diretório do PATH injetado", () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "korda-agents-paths-"));
  const first = path.join(base, "primeiro");
  const second = path.join(base, "segundo");
  fs.mkdirSync(first);
  fs.mkdirSync(second);
  try {
    writeExecutable(first, "gemini");
    writeExecutable(second, "kimi");
    const pathValue = [first, second].join(path.delimiter);

    assert.equal(resolveInstalledAgent("gemini", pathValue)?.path, path.join(first, "gemini"));
    assert.equal(resolveInstalledAgent("kimi", pathValue)?.path, path.join(second, "kimi"));
    assert.equal(resolveInstalledAgent("qwen", pathValue), null);
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test("resolve comando genérico executável no PATH injetado", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "korda-commands-"));
  try {
    writeExecutable(directory, "minha-cli");
    writeExecutable(directory, "sem-permissao", 0o644);

    assert.deepEqual(resolveCommandExecutable("minha-cli", directory), {
      command: "minha-cli",
      path: path.join(directory, "minha-cli"),
    });
    assert.equal(resolveCommandExecutable("sem-permissao", directory), null);
    assert.equal(resolveCommandExecutable("inexistente", directory), null);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("rejeita comandos genéricos que não são um basename simples", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "korda-commands-"));
  try {
    writeExecutable(directory, "minha-cli");

    for (const invalid of ["", "com espaço", "com\tespaço", "com\0nulo", "../minha-cli", `sub${path.sep}minha-cli`, "C:\\cli", ".", ".."]) {
      assert.equal(resolveCommandExecutable(invalid, directory), null, JSON.stringify(invalid));
    }
    for (const invalid of [undefined, null, 42, {}]) {
      assert.equal(resolveCommandExecutable(invalid, directory), null, String(invalid));
    }
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
