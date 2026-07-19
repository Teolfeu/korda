const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const HERMES_SKILL_SOURCE = path.join(__dirname, "..", "assets", "hermes", "korda-studio", "SKILL.md");

const KNOWN_AGENTS = [
  { id: "hermes", name: "Hermes", commands: ["hermes", "hermes-cli"], args: ["--tui", "--skills", "korda-studio", "-m", "deepseek-v4-pro", "--provider", "deepseek"] },
  { id: "codex", name: "Codex", commands: ["codex"] },
  { id: "opencode", name: "OpenCode", commands: ["opencode"], args: ["."] },
  { id: "grok", name: "Grok", commands: ["grok"] },
  { id: "claude", name: "Claude Code", commands: ["claude", "claude-code"] },
  { id: "kimi", name: "Kimi", commands: ["kimi"] },
  { id: "gemini", name: "Gemini", commands: ["gemini"] },
  { id: "aider", name: "Aider", commands: ["aider"] },
  { id: "cursor-agent", name: "Cursor Agent", commands: ["cursor-agent"] },
  { id: "qwen", name: "Qwen", commands: ["qwen"] },
  { id: "copilot", name: "GitHub Copilot", commands: ["copilot"] },
];

// Diretórios caseiros comuns de CLIs que costumam faltar no PATH mínimo
// recebido quando o app é aberto pelo launcher gráfico do sistema.
const EXTRA_HOME_PATH_DIRECTORIES = [".local/bin", ".bun/bin", ".deno/bin", ".volta/bin", ".npm-global/bin", ".kimi-code/bin"];
const EXTRA_SYSTEM_PATH_DIRECTORIES = ["/usr/local/bin", "/opt/homebrew/bin"];

let loginShellPathCache;

function loginShellPath() {
  if (loginShellPathCache !== undefined) return loginShellPathCache;
  loginShellPathCache = "";
  try {
    const result = spawnSync(process.env.SHELL || "/bin/bash", ["-lc", 'printf %s "$PATH"'], { encoding: "utf8", timeout: 2000 });
    if (!result.error && result.status === 0 && typeof result.stdout === "string") loginShellPathCache = result.stdout.trim();
  } catch {
    // Sem login shell disponível: cai silenciosamente no PATH do próprio processo.
  }
  return loginShellPathCache;
}

// PATH efetivo: login shell do usuário + PATH do processo + diretórios comuns,
// sem duplicatas. Apps abertos pelo launcher gráfico recebem um PATH mínimo,
// então o login shell é o que enxerga as CLIs instaladas pelo usuário.
function effectivePath() {
  const directories = [];
  const push = (directory) => {
    if (directory && !directories.includes(directory)) directories.push(directory);
  };
  for (const directory of loginShellPath().split(path.delimiter)) push(directory);
  for (const directory of (process.env.PATH || "").split(path.delimiter)) push(directory);
  for (const directory of EXTRA_SYSTEM_PATH_DIRECTORIES) push(directory);
  const home = os.homedir();
  for (const directory of EXTRA_HOME_PATH_DIRECTORIES) push(path.join(home, directory));
  return directories.join(path.delimiter);
}

function findExecutable(commands, pathValue = effectivePath()) {
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

function listInstalledAgents(pathValue = effectivePath()) {
  return KNOWN_AGENTS.flatMap(({ commands, ...agent }) => {
    const executable = findExecutable(commands, pathValue);
    return executable ? [{ ...agent, ...executable }] : [];
  });
}

function resolveInstalledAgent(command, pathValue = effectivePath()) {
  if (typeof command !== "string") return null;
  return listInstalledAgents(pathValue).find((agent) => agent.command === command) || null;
}

// Resolve um comando digitado pelo usuário que não é um agente conhecido:
// aceita apenas um basename simples (sem espaços, separadores ou "\0") que
// exista como arquivo executável no PATH efetivo.
function resolveCommandExecutable(command, pathValue = effectivePath()) {
  if (typeof command !== "string" || command.length === 0) return null;
  if (/\s/.test(command) || command.includes("\0") || command.includes("/") || command.includes("\\")) return null;
  return findExecutable([command], pathValue);
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

module.exports = { ensureHermesSkill, findExecutable, listInstalledAgents, resolveInstalledAgent, resolveCommandExecutable };
