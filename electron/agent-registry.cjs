const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const HERMES_SKILL_SOURCE = path.join(__dirname, "..", "assets", "hermes", "korda-studio", "SKILL.md");

const KNOWN_AGENTS = [
  { id: "hermes", name: "Hermes", commands: ["hermes", "hermes-cli"], args: ["--tui", "--skills", "korda-studio", "-m", "deepseek-v4-pro", "--provider", "deepseek"] },
  { id: "codex", name: "Codex", commands: ["codex"] },
  { id: "opencode", name: "OpenCode", commands: ["opencode"], args: [".", "--mini", "--no-replay"] },
  { id: "grok", name: "Grok", commands: ["grok"] },
  { id: "claude", name: "Claude Code", commands: ["claude", "claude-code"] },
];

function findExecutable(commands, pathValue = process.env.PATH || "") {
  for (const command of commands) {
    for (const directory of pathValue.split(path.delimiter).filter(Boolean)) {
      const candidate = path.join(directory, command);
      try {
        fs.accessSync(candidate, fs.constants.X_OK);
        if (fs.statSync(candidate).isFile()) return { command, path: candidate };
      } catch {
        // Ausente ou sem permissão de execução.
      }
    }
  }
  return null;
}

function listInstalledAgents(pathValue = process.env.PATH || "") {
  return KNOWN_AGENTS.flatMap(({ commands, ...agent }) => {
    const executable = findExecutable(commands, pathValue);
    return executable ? [{ ...agent, ...executable }] : [];
  });
}

function resolveInstalledAgent(command, pathValue = process.env.PATH || "") {
  if (typeof command !== "string") return null;
  return listInstalledAgents(pathValue).find((agent) => agent.command === command) || null;
}

function ensureHermesSkill(hermesHome = process.env.HERMES_HOME || path.join(os.homedir(), ".hermes"), sourcePath = HERMES_SKILL_SOURCE) {
  const target = path.join(hermesHome, "skills", "software-development", "korda-studio", "SKILL.md");
  const content = fs.readFileSync(sourcePath, "utf8");
  if (fs.existsSync(target) && fs.readFileSync(target, "utf8") === content) return target;
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const temporary = `${target}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, content, { encoding: "utf8", mode: 0o600 });
  fs.renameSync(temporary, target);
  return target;
}

module.exports = { ensureHermesSkill, findExecutable, listInstalledAgents, resolveInstalledAgent };
