const { app, BrowserWindow, clipboard, dialog, ipcMain, webContents } = require("electron");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const pty = require("node-pty");
const { fileURLToPath } = require("node:url");
const { ensureHermesSkill, listInstalledAgents, resolveInstalledAgent } = require("./agent-registry.cjs");
const { createBrowserController } = require("./browser-controller.cjs");
const { createContextBroker } = require("./context-broker.cjs");
const { createRunCoordinator } = require("./run-coordinator.cjs");
const { kordaOpenCodeConfig } = require("./opencode-config.cjs");
const { spawnGatedPty } = require("./pty-launch.cjs");
const { createTerminalMetrics, recordTerminalIo, snapshotTerminalMetrics } = require("./terminal-metrics.cjs");
const { readUsageSnapshot } = require("./usage-reader.cjs");
const { createWorkspaceWatcher, readWorkspaceText, readWorkspaceTree, writeWorkspaceText } = require("./workspace-reader.cjs");

const MAX_SNAPSHOT_BYTES = 256 * 1024;
const MAX_CLIPBOARD_BYTES = 1024 * 1024;
const terminals = new Map();
const terminalMetrics = new Map();

let mainWindow = null;
let workspaceRoot = null;
let disposeWorkspaceWatcher = null;
let usageCache = { readAt: 0, value: null };

const browserController = createBrowserController({ getWorkspaceRoot: () => workspaceRoot });
const runCoordinator = createRunCoordinator({
  onChange: (snapshot) => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send("mission:update", snapshot);
  },
});

function assertTrustedSender(event) {
  if (!mainWindow || event.sender !== mainWindow.webContents) {
    throw new Error("Origem IPC inválida.");
  }
}

function payloadObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Payload inválido.");
  }
  return value;
}

function boundedClipboardText(value) {
  if (typeof value !== "string") throw new TypeError("Texto da área de transferência inválido.");
  const clean = value.replaceAll("\0", "");
  if (Buffer.byteLength(clean, "utf8") > MAX_CLIPBOARD_BYTES) {
    throw new TypeError("Texto da área de transferência excede 1 MiB.");
  }
  return clean;
}

function clipUtf8Text(value, maxBytes) {
  if (Buffer.byteLength(value, "utf8") <= maxBytes) return value;
  let used = 0;
  let result = "";
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    const size = codePoint <= 0x7f ? 1 : codePoint <= 0x7ff ? 2 : codePoint <= 0xffff ? 3 : 4;
    if (used + size > maxBytes) break;
    result += character;
    used += size;
  }
  return result;
}

function terminalId(value) {
  if (typeof value !== "string" || !/^[a-zA-Z0-9_-]{1,64}$/.test(value)) {
    throw new TypeError("ID de terminal inválido.");
  }
  return value;
}

function integer(value, fallback, min, max, name) {
  const result = value === undefined ? fallback : value;
  if (!Number.isInteger(result) || result < min || result > max) {
    throw new TypeError(`${name} inválido.`);
  }
  return result;
}

function getTerminal(value) {
  const id = terminalId(value);
  const terminal = terminals.get(id);
  if (!terminal) throw new Error("Terminal não encontrado.");
  return [id, terminal];
}

function resolveTerminalCwd(value) {
  if (!workspaceRoot) throw new Error("Escolha uma pasta de trabalho primeiro.");
  if (value !== undefined && (typeof value !== "string" || value.length > 4096 || value.includes("\0"))) {
    throw new TypeError("Diretório inválido.");
  }

  const requested = value
    ? (path.isAbsolute(value) ? value : path.join(workspaceRoot, value))
    : workspaceRoot;
  const resolved = fs.realpathSync(requested);
  const insideWorkspace = resolved === workspaceRoot || resolved.startsWith(`${workspaceRoot}${path.sep}`);

  if (!insideWorkspace || !fs.statSync(resolved).isDirectory()) {
    throw new Error("O terminal só pode abrir dentro da pasta de trabalho.");
  }
  return resolved;
}

function allowedWebviewUrl(value) {
  try {
    const target = new URL(value);
    if (["http:", "https:"].includes(target.protocol)) return true;
    if (target.protocol !== "file:") return false;
    const distRoot = fs.realpathSync(path.join(__dirname, "..", "dist"));
    const requested = fs.realpathSync(fileURLToPath(target));
    const relative = path.relative(distRoot, requested);
    return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
  } catch {
    return false;
  }
}

function emitTerminalData(id, terminal, data) {
  if (terminal.closed || typeof data !== "string") return;
  // ponytail: cópia limitada basta no protótipo; trocar por ring buffer se throughput contínuo importar.
  terminal.buffer = `${terminal.buffer}${data}`.slice(-MAX_SNAPSHOT_BYTES);
  terminal.sequence += 1;
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("terminal:data", { id, data, sequence: terminal.sequence });
  }
}

function closeTerminal(id, terminal) {
  terminal.closed = true;
  terminal.metrics.closed = true;
  terminal.metrics.closedAt = Date.now();
  terminal.metrics.lastActivityAt = terminal.metrics.closedAt;
  terminals.delete(id);
  contextBroker.revokeSession(id);
  try {
    terminal.pty?.kill();
  } catch {
    // O processo já encerrou.
  }
}

function closeAllTerminals() {
  for (const [id, terminal] of terminals) closeTerminal(id, terminal);
}

function stopWorkspaceWatcher() {
  if (!disposeWorkspaceWatcher) return;
  disposeWorkspaceWatcher();
  disposeWorkspaceWatcher = null;
}

function sendWorkspaceUpdate(payload) {
  if (mainWindow && !mainWindow.isDestroyed() && payload.root === workspaceRoot) {
    mainWindow.webContents.send("workspace:update", payload);
  }
}

function startWorkspaceWatcher(root) {
  stopWorkspaceWatcher();
  try {
    disposeWorkspaceWatcher = createWorkspaceWatcher(root, sendWorkspaceUpdate);
  } catch (error) {
    sendWorkspaceUpdate({ root, error: error instanceof Error ? error.message : String(error) });
  }
}

const contextBroker = createContextBroker({
  onNoteWrite: (payload) => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send("context:note", payload);
  },
  onRequest: (payload) => {
    try { runCoordinator.request(payload); } catch { /* pedidos fora de uma missão continuam válidos */ }
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send("context:request", payload);
  },
  onReply: (payload) => {
    try { runCoordinator.reply({ ...payload, nodeId: payload.targetId }); } catch { /* resposta fora de uma missão */ }
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send("context:reply", payload);
  },
  runCommand: async ({ action, source, message }) => {
    if (action === "status") {
      const brief = runCoordinator.brief(source.id);
      return [
        `Missão: ${brief.id}`,
        `Estado: ${brief.state}`,
        `Objetivo: ${brief.objective}`,
        `Critério de conclusão: ${brief.successCriteria}`,
        `Revisor: ${brief.reviewerId || "não exigido"}`,
        `Pedidos pendentes: ${brief.pendingCount}`,
        `Aprovada: ${brief.approved ? "sim" : "não"}`,
      ].join("\n");
    }
    if (action === "approve") runCoordinator.approve(source.id, message);
    else if (action === "finish") runCoordinator.finish(source.id, message);
    else runCoordinator.fail(source.id, message);
    return `Missão ${action === "approve" ? "aprovada" : action === "finish" ? "concluída" : "marcada como falha"}.`;
  },
  browserCommand: async ({ action, browsers, browser, args }) => {
    if (action === "list") {
      const rows = await Promise.all(browsers.map(async (item) => {
        try {
          const info = await browserController.command(item.id, "info");
          return `- ${item.title} (${item.id}) url=${info.url} title=${JSON.stringify(info.title)}`;
        } catch {
          return `- ${item.title} (${item.id}) [ainda não pronto]`;
        }
      }));
      return rows.length ? rows.join("\n") : "Nenhum browser conectado.";
    }
    if (action === "navigate") {
      await browserController.command(browser.id, action, { url: args[0] });
      const info = await browserController.command(browser.id, "info");
      return `OK ${browser.id} → ${info.url} title=${JSON.stringify(info.title)}`;
    }
    if (action === "info") {
      const info = await browserController.command(browser.id, action);
      return `URL: ${info.url}\nTítulo: ${info.title}\nCarregando: ${info.loading ? "sim" : "não"}`;
    }
    if (action === "content") {
      const content = await browserController.command(browser.id, action);
      const flag = args.indexOf("--max");
      const requested = flag >= 0 ? Number(args[flag + 1]) : 64 * 1024;
      const limit = Number.isInteger(requested) && requested > 0 ? Math.min(requested, 64 * 1024) : 64 * 1024;
      const info = await browserController.command(browser.id, "info");
      return `${info.title}\n${String(content).slice(0, limit)}`;
    }
    if (action === "inspect") {
      const items = await browserController.command(browser.id, action);
      return items.length
        ? items.map((item) => `${item.id}\t${item.kind}\t${item.fillable ? "preenchível" : "somente ação"}\t${item.label || "(sem rótulo)"}`).join("\n")
        : "Nenhum elemento interativo visível.";
    }
    if (action === "activate") return browserController.command(browser.id, action, { id: args[0] });
    if (action === "fill") return browserController.command(browser.id, action, { id: args[0], value: args.slice(1).join(" ") });
    return browserController.command(browser.id, "screenshot", { path: args[0] });
  },
});

function registerIpc() {
  ipcMain.handle("clipboard:read-text", (event) => {
    assertTrustedSender(event);
    const text = clipboard.readText("clipboard").replaceAll("\0", "");
    return clipUtf8Text(text, MAX_CLIPBOARD_BYTES);
  });

  ipcMain.handle("clipboard:write-text", (event, value) => {
    assertTrustedSender(event);
    const text = boundedClipboardText(payloadObject(value).text);
    clipboard.writeText(text, "clipboard");
    return true;
  });

  ipcMain.handle("mission:start", (event, value) => {
    assertTrustedSender(event);
    const payload = payloadObject(value);
    return runCoordinator.start({
      id: terminalId(payload.id),
      objective: typeof payload.objective === "string" ? payload.objective : "",
      successCriteria: typeof payload.successCriteria === "string" ? payload.successCriteria : "",
      orchestratorId: terminalId(payload.orchestratorId),
      reviewerId: payload.reviewerId == null ? null : terminalId(payload.reviewerId),
      participantIds: Array.isArray(payload.participantIds) ? payload.participantIds.map(terminalId) : [],
      timeoutMs: integer(payload.timeoutMs, 15 * 60_000, 60_000, 4 * 60 * 60_000, "Prazo da missão"),
    });
  });

  ipcMain.handle("mission:delivered", (event, value) => {
    assertTrustedSender(event);
    return runCoordinator.delivered(terminalId(payloadObject(value).nodeId));
  });

  ipcMain.handle("mission:snapshot", (event) => {
    assertTrustedSender(event);
    return runCoordinator.snapshot();
  });

  ipcMain.handle("mission:cancel", (event, value) => {
    assertTrustedSender(event);
    const payload = payloadObject(value);
    return runCoordinator.cancel(typeof payload.reason === "string" ? payload.reason : "Missão cancelada pelo usuário.");
  });

  ipcMain.handle("metrics:snapshot", async (event) => {
    assertTrustedSender(event);
    const now = Date.now();
    if (!usageCache.value || now - usageCache.readAt > 30_000) {
      usageCache = { readAt: now, value: readUsageSnapshot({ now, days: 30 }) };
    }
    return { ...snapshotTerminalMetrics(terminalMetrics.values(), now), usage: await usageCache.value };
  });

  ipcMain.handle("agents:list", (event) => {
    assertTrustedSender(event);
    return listInstalledAgents();
  });

  ipcMain.handle("context:sync", (event, value) => {
    assertTrustedSender(event);
    return contextBroker.sync(payloadObject(value));
  });

  ipcMain.handle("browser:register", (event, value) => {
    assertTrustedSender(event);
    const payload = payloadObject(value);
    const nodeId = terminalId(payload.nodeId);
    const guestId = integer(payload.guestId, undefined, 1, Number.MAX_SAFE_INTEGER, "ID do webview");
    const guest = webContents.fromId(guestId);
    if (!guest || guest.isDestroyed() || guest.getType() !== "webview" || guest.hostWebContents !== event.sender) {
      throw new Error("Webview inválido para este canvas.");
    }
    return browserController.register(nodeId, guest);
  });

  ipcMain.handle("browser:unregister", (event, value) => {
    assertTrustedSender(event);
    const payload = payloadObject(value);
    return browserController.unregister(
      terminalId(payload.nodeId),
      integer(payload.guestId, undefined, 1, Number.MAX_SAFE_INTEGER, "ID do webview"),
    );
  });

  ipcMain.handle("workspace:select", async (event) => {
    assertTrustedSender(event);
    const result = await dialog.showOpenDialog(mainWindow, {
      title: "Abrir pasta de trabalho",
      properties: ["openDirectory"],
    });
    if (result.canceled || result.filePaths.length !== 1) return null;

    const selectedWorkspace = await readWorkspaceTree(result.filePaths[0]);
    const selected = selectedWorkspace.root;
    if (["preparing", "running", "reviewing"].includes(runCoordinator.snapshot()?.state)) runCoordinator.cancel("Workspace alterado.");
    closeAllTerminals();
    stopWorkspaceWatcher();
    await contextBroker.close();
    workspaceRoot = selected;
    await contextBroker.startSpool(path.join(selected, `.korda-runtime-${process.pid}-${crypto.randomUUID()}`));
    startWorkspaceWatcher(selected);
    return {
      root: selected,
      name: selectedWorkspace.name,
      tree: selectedWorkspace.tree,
      truncated: selectedWorkspace.truncated,
    };
  });

  ipcMain.handle("workspace:read-file", async (event, value) => {
    assertTrustedSender(event);
    if (!workspaceRoot) throw new Error("Escolha uma pasta de trabalho primeiro.");
    const payload = payloadObject(value);
    return readWorkspaceText(workspaceRoot, payload.path);
  });

  ipcMain.handle("workspace:write-file", async (event, value) => {
    assertTrustedSender(event);
    if (!workspaceRoot) throw new Error("Escolha uma pasta de trabalho primeiro.");
    const payload = payloadObject(value);
    return writeWorkspaceText(workspaceRoot, payload.path, payload.content, payload.revision);
  });

  ipcMain.handle("terminal:create", (event, value) => {
    assertTrustedSender(event);
    const payload = payloadObject(value);
    const id = terminalId(payload.id);
    const nodeId = terminalId(payload.nodeId);
    if (terminals.has(id)) throw new Error("Já existe um terminal com este ID.");

    const cols = integer(payload.cols, 100, 2, 500, "Número de colunas");
    const rows = integer(payload.rows, 30, 1, 200, "Número de linhas");
    const cwd = resolveTerminalCwd(payload.cwd);
    const agent = payload.command === undefined ? null : resolveInstalledAgent(payload.command);
    if (payload.command !== undefined && !agent) throw new Error("CLI de agente não instalada.");
    if (agent?.id === "hermes") ensureHermesSkill();
    const executable = agent?.path || process.env.SHELL || "/bin/bash";
    const env = Object.fromEntries(Object.entries(process.env).filter(([, item]) => typeof item === "string"));
    env.TERM = "xterm-256color";
    env.COLORTERM = "truecolor";
    env.TERM_PROGRAM = "Korda";
    const connection = contextBroker.connection(nodeId, id);
    env.KORDA_NODE_ID = nodeId;
    if (connection.spoolDir) env.KORDA_SPOOL = connection.spoolDir;
    else env.KORDA_PORT = String(connection.port);
    env.KORDA_TOKEN = connection.token;
    env.PATH = `${path.join(__dirname, "..", "bin")}${path.delimiter}${env.PATH || ""}`;
    if (agent?.id === "opencode") {
      // OpenCode consumes this as system configuration on the first real user turn.
      // Unlike typing into the TUI, it does not create a model request at boot.
      env.OPENCODE_CONFIG_CONTENT = kordaOpenCodeConfig(env.OPENCODE_CONFIG_CONTENT);
    }

    const command = agent?.command || path.basename(executable);
    const metrics = createTerminalMetrics({ id, command, cwd, cols, rows });
    const terminal = {
      pty: null,
      nodeId,
      cwd,
      cols,
      rows,
      command: agent?.command || null,
      buffer: "",
      sequence: 0,
      closed: false,
      exited: false,
      exitCode: null,
      metrics,
    };
    const onExit = ({ exitCode }) => {
      if (terminal.exited || terminal.closed) return;
      terminal.exited = true;
      terminal.exitCode = Number.isInteger(exitCode) ? exitCode : null;
      contextBroker.revokeSession(id);
      metrics.exited = true;
      metrics.exitCode = terminal.exitCode;
      metrics.exitedAt = Date.now();
      metrics.lastActivityAt = metrics.exitedAt;
      emitTerminalData(id, terminal, `\r\n[processo encerrado: ${terminal.exitCode ?? "sem código"}]\r\n`);
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send("terminal:exit", { id, nodeId, exitCode: terminal.exitCode });
      const activeRun = runCoordinator.snapshot();
      if (["preparing", "running", "reviewing"].includes(activeRun?.state) && activeRun.orchestratorId === nodeId) {
        try { runCoordinator.fail(nodeId, `Orquestrador encerrou com código ${terminal.exitCode ?? "desconhecido"}.`); } catch { /* missão já encerrada */ }
      }
    };

    try {
      spawnGatedPty({
        pty,
        executable,
        args: agent?.args || [],
        spawnOptions: { name: "xterm-256color", cols, rows, cwd, env },
        gateDirectory: connection.spoolDir,
        onSpawn: (processPty) => {
          terminal.pty = processPty;
          terminals.set(id, terminal);
          terminalMetrics.set(id, metrics);
        },
        onData: (data) => {
          recordTerminalIo(metrics, "out", data);
          emitTerminalData(id, terminal, data);
        },
        onExit,
      });
    } catch (error) {
      terminals.delete(id);
      terminalMetrics.delete(id);
      contextBroker.revokeSession(id);
      throw error;
    }
    return { id, cwd, cols, rows, command: terminal.command };
  });

  ipcMain.handle("terminal:write", (event, value) => {
    assertTrustedSender(event);
    const payload = payloadObject(value);
    const [, terminal] = getTerminal(payload.id);
    if (terminal.exited) throw new Error("O processo do terminal já encerrou.");
    if (typeof payload.data !== "string" || payload.data.length > 64 * 1024) {
      throw new TypeError("Entrada de terminal inválida.");
    }
    terminal.pty.write(payload.data);
    recordTerminalIo(terminal.metrics, "in", payload.data);
    return true;
  });

  ipcMain.handle("terminal:resize", (event, value) => {
    assertTrustedSender(event);
    const payload = payloadObject(value);
    const id = terminalId(payload.id);
    const terminal = terminals.get(id);
    if (!terminal || terminal.closed || terminal.exited) return false;
    const cols = integer(payload.cols, undefined, 2, 500, "Número de colunas");
    const rows = integer(payload.rows, undefined, 1, 200, "Número de linhas");
    terminal.pty.resize(cols, rows);
    terminal.cols = cols;
    terminal.rows = rows;
    terminal.metrics.cols = cols;
    terminal.metrics.rows = rows;
    return true;
  });

  ipcMain.handle("terminal:close", (event, value) => {
    assertTrustedSender(event);
    const payload = payloadObject(value);
    const [id, terminal] = getTerminal(payload.id);
    closeTerminal(id, terminal);
    return true;
  });

  ipcMain.handle("terminal:snapshot", (event, value) => {
    assertTrustedSender(event);
    const payload = payloadObject(value);
    const [id, terminal] = getTerminal(payload.id);
    return {
      id,
      nodeId: terminal.nodeId,
      data: terminal.buffer,
      sequence: terminal.sequence,
      exited: terminal.exited,
      exitCode: terminal.exitCode,
      cwd: terminal.cwd,
      command: terminal.command,
      cols: terminal.cols,
      rows: terminal.rows,
    };
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 1024,
    minWidth: 960,
    minHeight: 640,
    show: false,
    icon: path.join(__dirname, "..", "dist", "brand", "korda-mark.png"),
    backgroundColor: "#f7f8f5",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: true,
    },
  });

  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  mainWindow.webContents.on("will-navigate", (event) => event.preventDefault());
  mainWindow.webContents.on("will-attach-webview", (event, webPreferences, params) => {
    delete webPreferences.preload;
    webPreferences.nodeIntegration = false;
    webPreferences.contextIsolation = true;
    webPreferences.sandbox = true;
    if (!allowedWebviewUrl(params.src)) event.preventDefault();
  });
  mainWindow.webContents.on("did-attach-webview", (_event, contents) => {
    contents.setWindowOpenHandler(() => ({ action: "deny" }));
    const guardNavigation = (event, target) => {
      if (!allowedWebviewUrl(target)) event.preventDefault();
    };
    contents.on("will-navigate", guardNavigation);
    contents.on("will-redirect", guardNavigation);
  });
  mainWindow.once("ready-to-show", () => mainWindow.show());
  mainWindow.on("closed", () => {
    stopWorkspaceWatcher();
    closeAllTerminals();
    mainWindow = null;
  });
  mainWindow.loadFile(path.join(__dirname, "..", "dist", "index.html"));
}

registerIpc();
app.whenReady().then(async () => {
  createWindow();
});
app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
app.on("before-quit", () => {
  stopWorkspaceWatcher();
  closeAllTerminals();
  runCoordinator.close();
  void contextBroker.close();
});
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
