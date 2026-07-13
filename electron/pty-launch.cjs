const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

// node-pty only exposes onData/onExit after spawn() returns. Very fast CLIs can
// emit their first frame (or exit) inside that gap. Start a silent shell gate,
// attach both listeners, then create a private release file. The gate removes
// the file atomically before replacing itself with the real executable.
const GATE_SCRIPT = 'gate="$1"; shift; while ! rm -- "$gate" 2>/dev/null; do sleep 0.01; done; exec "$@"';

function requiredFunction(value, label) {
  if (typeof value !== "function") throw new TypeError(`${label} inválido.`);
  return value;
}

function spawnGatedPty(options = {}, dependencies = {}) {
  const pty = options.pty;
  const executable = options.executable;
  const args = options.args ?? [];
  const spawnOptions = options.spawnOptions;
  const gateDirectory = options.gateDirectory;
  const onSpawn = requiredFunction(options.onSpawn, "Listener de spawn");
  const onData = requiredFunction(options.onData, "Listener de dados");
  const onExit = requiredFunction(options.onExit, "Listener de saída");
  const fileSystem = dependencies.fs || fs;
  const randomUUID = dependencies.randomUUID || crypto.randomUUID;
  const shell = dependencies.shell || "/bin/sh";

  if (!pty || typeof pty.spawn !== "function") throw new TypeError("Implementação PTY inválida.");
  if (typeof executable !== "string" || !executable || executable.includes("\0")) throw new TypeError("Executável inválido.");
  if (!Array.isArray(args) || args.some((item) => typeof item !== "string" || item.includes("\0"))) throw new TypeError("Argumentos inválidos.");
  if (!spawnOptions || typeof spawnOptions !== "object" || Array.isArray(spawnOptions)) throw new TypeError("Opções de PTY inválidas.");
  if (typeof gateDirectory !== "string" || !path.isAbsolute(gateDirectory) || gateDirectory.includes("\0")) throw new TypeError("Diretório de gate inválido.");

  const gatePath = path.join(gateDirectory, `.pty-gate-${randomUUID()}`);
  let processPty = null;
  try {
    processPty = pty.spawn(shell, [
      "-c",
      GATE_SCRIPT,
      "korda-pty-gate",
      gatePath,
      executable,
      ...args,
    ], spawnOptions);
    onSpawn(processPty);
    processPty.onData(onData);
    processPty.onExit(onExit);
    fileSystem.writeFileSync(gatePath, "", { encoding: "utf8", mode: 0o600, flag: "wx" });
    return { processPty, gatePath };
  } catch (error) {
    try { fileSystem.rmSync(gatePath, { force: true }); } catch { /* best effort */ }
    try { processPty?.kill(); } catch { /* processo pode já ter encerrado */ }
    throw error;
  }
}

module.exports = { GATE_SCRIPT, spawnGatedPty };
