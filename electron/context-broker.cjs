const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const http = require("node:http");
const path = require("node:path");

const MAX_BODY = 64 * 1024;
const MAX_TEXT = 20_000;
const MAX_PENDING_PER_AGENT = 8;

function text(value, limit = 240) {
  return typeof value === "string" ? value.trim().slice(0, limit) : "";
}

function createContextBroker({ onNoteWrite, onRequest, onReply, browserCommand, runCommand }) {
  const sessions = new Map();
  const requests = new Map();
  let nodes = new Map();
  let edges = [];
  let server;
  let port;
  let spoolDir;
  let spoolTimer;
  let spoolRun;

  function neighbors(id) {
    const result = new Set();
    for (const edge of edges) {
      if (edge.source === id) result.add(edge.target);
      if (edge.target === id) result.add(edge.source);
    }
    return result;
  }

  function cancelInvalidRequests() {
    for (const request of requests.values()) {
      if (request.status !== "pending") continue;
      if (!nodes.has(request.sourceId) || !nodes.has(request.targetId) || !neighbors(request.sourceId).has(request.targetId)) {
        request.status = "cancelled";
        request.answer = "A corda foi removida ou um dos agentes saiu do canvas.";
      }
    }
  }

  function sync(value) {
    const rawNodes = Array.isArray(value?.nodes) ? value.nodes.slice(0, 250) : [];
    nodes = new Map(rawNodes.flatMap((raw) => {
      const id = text(raw?.id, 64);
      const type = ["agent", "note", "browser", "file"].includes(raw?.type) ? raw.type : "";
      if (!id || !type) return [];
      return [[id, {
        id,
        type,
        title: text(raw.title) || id,
        agentName: text(raw.agentName) || text(raw.title) || id,
        role: text(raw.role, 40),
        objective: text(raw.objective, 2_000),
        content: text(raw.content, MAX_TEXT),
      }]];
    }));
    edges = (Array.isArray(value?.edges) ? value.edges : []).slice(0, 1_000).flatMap((raw) => {
      const source = text(raw?.source, 64);
      const target = text(raw?.target, 64);
      return source !== target && nodes.has(source) && nodes.has(target) ? [{ source, target, kind: text(raw.kind, 40) || "context" }] : [];
    });
    cancelInvalidRequests();
    return true;
  }

  function accessibleNotes(id) {
    const found = new Set();
    const queue = [...neighbors(id)].filter((candidate) => nodes.get(candidate)?.type === "note");
    for (let cursor = 0; cursor < queue.length; cursor += 1) {
      const noteId = queue[cursor];
      if (found.has(noteId)) continue;
      found.add(noteId);
      for (const candidate of neighbors(noteId)) {
        if (nodes.get(candidate)?.type === "note" && !found.has(candidate)) queue.push(candidate);
      }
    }
    return [...found].map((noteId) => nodes.get(noteId));
  }

  function requireSource(nodeId, suppliedToken) {
    const id = text(nodeId, 64);
    const session = sessions.get(suppliedToken);
    if (!session || session.nodeId !== id) throw new Error("Autenticação Korda inválida.");
    const source = nodes.get(id);
    if (!source || source.type !== "agent") throw new Error("Agente Korda não encontrado no canvas.");
    return source;
  }

  function connectedTarget(source, selector) {
    const wanted = text(selector).toLocaleLowerCase("pt-BR");
    const candidates = [...neighbors(source.id)].map((id) => nodes.get(id)).filter((node) => node?.type === "agent");
    const target = candidates.find((node) => [node.id, node.title, node.agentName].some((value) => value.toLocaleLowerCase("pt-BR") === wanted));
    if (!target) throw new Error(`Agente conectado não encontrado: ${selector || "(sem nome)"}.`);
    return target;
  }

  function connectedNote(source, selector) {
    const wanted = text(selector).toLocaleLowerCase("pt-BR");
    const note = accessibleNotes(source.id).find((item) => [item.id, item.title].some((value) => value.toLocaleLowerCase("pt-BR") === wanted));
    if (!note) throw new Error(`Nota conectada não encontrada: ${selector || "(sem nome)"}.`);
    return note;
  }

  function connectedBrowsers(source) {
    return [...neighbors(source.id)].map((id) => nodes.get(id)).filter((node) => node?.type === "browser");
  }

  function connectedBrowser(source, selector) {
    const wanted = text(selector).toLocaleLowerCase("pt-BR");
    if (!wanted) throw new Error("Informe o browser conectado.");
    const candidates = connectedBrowsers(source);
    const exact = candidates.find((node) => [node.id, node.title].some((value) => value.toLocaleLowerCase("pt-BR") === wanted));
    if (exact) return exact;
    const partial = candidates.filter((node) => [node.id, node.title].some((value) => value.toLocaleLowerCase("pt-BR").includes(wanted)));
    if (partial.length === 1) return partial[0];
    throw new Error(`Browser conectado não encontrado: ${selector || "(sem nome)"}.`);
  }

  async function command({ nodeId, suppliedToken, name, args = [] }) {
    const source = requireSource(nodeId, suppliedToken);
    const commandName = text(name, 40);
    const values = Array.isArray(args) ? args.map((item) => text(item, MAX_TEXT)) : [];

    if (commandName === "self") {
      return `Nome: ${source.agentName}\nPapel: ${source.role || "sem papel"}\nObjetivo: ${source.objective || "não definido"}`;
    }
    if (commandName === "list") {
      const connected = [...neighbors(source.id)].map((id) => nodes.get(id)).filter(Boolean);
      return connected.length
        ? connected.map((node) => `- ${node.agentName || node.title} (${node.id}) [${node.type}${node.role ? ` · ${node.role}` : ""}]`).join("\n")
        : "Nenhuma conexão disponível.";
    }
    if (commandName === "browser") {
      const action = values.shift();
      if (!["list", "info", "navigate", "content", "screenshot", "inspect", "activate", "fill"].includes(action)) {
        throw new Error("Use: korda browser list|info|navigate|content|screenshot|inspect|activate|fill [browser] [argumento].");
      }
      if (!browserCommand) throw new Error("Controle do browser indisponível.");
      if (action === "list") return browserCommand({ action, source, browsers: connectedBrowsers(source), args: values });
      const browser = connectedBrowser(source, values.shift());
      if (action === "navigate") {
        const url = values[0];
        let parsed;
        try { parsed = new URL(url); } catch { throw new Error("Use: korda browser navigate <browser> <url http(s)>."); }
        if (!["http:", "https:"].includes(parsed.protocol)) throw new Error("O browser aceita somente URLs http(s).");
        values[0] = parsed.href;
      }
      if (action === "activate" && !values[0]) throw new Error("Use: korda browser activate <browser> <elemento>.");
      if (action === "fill" && (!values[0] || values.length < 2)) throw new Error("Use: korda browser fill <browser> <elemento> <texto>.");
      const output = await browserCommand({ action, source, browser, args: values });
      if (!neighbors(source.id).has(browser.id)) throw new Error("A corda deste browser não existe mais.");
      return output;
    }
    if (commandName === "note") {
      const action = values.shift();
      const note = connectedNote(source, values.shift());
      if (action === "read") return note.content || "";
      if (action !== "write") throw new Error("Use: korda note read|write <nota> [texto].");
      const content = values.join(" ").slice(0, MAX_TEXT);
      note.content = content;
      onNoteWrite?.({ id: note.id, text: content });
      return `Nota atualizada: ${note.title}`;
    }
    if (commandName === "run") {
      const action = values.shift();
      if (!["status", "approve", "finish", "fail"].includes(action)) {
        throw new Error("Use: korda run status|approve|finish|fail [mensagem].");
      }
      if (!runCommand) throw new Error("Controle de missão indisponível.");
      const message = values.join(" ").slice(0, MAX_TEXT);
      if (action === "status" && message) throw new Error("Use: korda run status.");
      const output = await runCommand({ action, source, message });
      return typeof output === "string" ? output : `Comando da missão enviado: ${action}.`;
    }
    if (commandName === "ask") {
      const target = connectedTarget(source, values.shift());
      const prompt = values.join(" ").slice(0, MAX_TEXT);
      if (!prompt) throw new Error("Use: korda ask <agente> <mensagem>.");
      const open = [...requests.values()].filter((item) => item.sourceId === source.id && item.status === "pending").length;
      if (open >= MAX_PENDING_PER_AGENT) throw new Error("Limite de 8 pedidos pendentes atingido.");
      const id = crypto.randomUUID();
      requests.set(id, { id, sourceId: source.id, sourceName: source.agentName, targetId: target.id, prompt, status: "pending", answer: "" });
      onRequest?.({ id, sourceId: source.id, sourceName: source.agentName, targetId: target.id });
      return `Pedido ${id} enviado para ${target.agentName}. O agente pode lê-lo com \`korda inbox\`; consulte depois com \`korda wait ${id}\`.`;
    }
    if (commandName === "inbox") {
      const incoming = [...requests.values()].filter((item) => item.targetId === source.id && item.status === "pending");
      return incoming.length
        ? incoming.map((item) => `[${item.id}] de ${item.sourceName}\n${item.prompt}`).join("\n\n")
        : "Nenhum pedido pendente.";
    }
    if (commandName === "reply") {
      const requestId = values.shift();
      const request = requests.get(requestId);
      if (!request || request.targetId !== source.id || request.status !== "pending") throw new Error("Pedido Korda inválido, cancelado ou já respondido.");
      if (!neighbors(request.sourceId).has(request.targetId)) throw new Error("A corda deste pedido não existe mais.");
      const reply = values.join(" ").slice(0, MAX_TEXT);
      if (!reply) throw new Error("Use: korda reply <pedido> <resposta>.");
      request.status = "answered";
      request.answer = reply;
      onReply?.({ id: request.id, sourceId: request.sourceId, targetId: request.targetId });
      return "Resposta entregue.";
    }
    if (commandName === "wait") {
      const requestId = values.shift();
      const request = requests.get(requestId);
      if (!request || request.sourceId !== source.id) throw new Error("Pedido Korda não encontrado.");
      if (request.status === "pending") return "Pendente.";
      requests.delete(requestId);
      if (request.status === "cancelled") throw new Error(request.answer);
      return request.answer;
    }
    throw new Error("Comando inválido. Use: self, list, browser, run, ask, inbox, reply, wait ou note.");
  }

  async function start() {
    if (server) return port;
    server = http.createServer((request, response) => {
      if (request.method !== "POST" || request.url !== "/command") {
        response.writeHead(404).end();
        return;
      }
      let body = "";
      request.setEncoding("utf8");
      request.on("data", (chunk) => {
        body += chunk;
        if (body.length > MAX_BODY) request.destroy();
      });
      request.on("end", async () => {
        try {
          const payload = JSON.parse(body);
          const output = await command({
            nodeId: request.headers["x-korda-node"],
            suppliedToken: request.headers["x-korda-token"],
            name: payload.command,
            args: payload.args,
          });
          response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ output }));
        } catch (error) {
          response.writeHead(400, { "content-type": "application/json" }).end(JSON.stringify({ error: error.message }));
        }
      });
    });
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    port = server.address().port;
    return port;
  }

  async function writeSpool(file, payload) {
    const body = JSON.stringify(payload);
    if (Buffer.byteLength(body) > MAX_BODY) throw new Error("Resposta Korda excede o limite permitido.");
    const temporary = `${file}.${crypto.randomUUID()}.tmp`;
    await fs.writeFile(temporary, body, { encoding: "utf8", mode: 0o600, flag: "wx" });
    await fs.rename(temporary, file);
  }

  async function processSpool() {
    const entries = await fs.readdir(spoolDir, { withFileTypes: true });
    for (const entry of entries) {
      const match = /^request-([0-9a-f-]{36})\.json$/.exec(entry.name);
      if (!match || !entry.isFile()) continue;
      const requestFile = path.join(spoolDir, entry.name);
      const responseFile = path.join(spoolDir, `response-${match[1]}.json`);
      try {
        const stat = await fs.stat(requestFile);
        if (stat.size > MAX_BODY) throw new Error("Pedido Korda excede o limite permitido.");
        const payload = JSON.parse(await fs.readFile(requestFile, "utf8"));
        const output = await command({
          nodeId: payload.nodeId,
          suppliedToken: payload.token,
          name: payload.command,
          args: payload.args,
        });
        await writeSpool(responseFile, { output });
      } catch (error) {
        await writeSpool(responseFile, { error: error.message }).catch(() => {});
      } finally {
        await fs.rm(requestFile, { force: true });
      }
    }
  }

  async function startSpool(requestedDir) {
    if (spoolDir) return spoolDir;
    const directory = text(requestedDir, 4_096);
    if (!directory) throw new Error("Informe o diretório de spool Korda.");
    await fs.mkdir(directory, { mode: 0o700 });
    await fs.chmod(directory, 0o700);
    spoolDir = directory;
    spoolTimer = setInterval(() => {
      if (spoolRun) return;
      spoolRun = processSpool().catch(() => {}).finally(() => { spoolRun = null; });
    }, 20);
    spoolTimer.unref();
    return spoolDir;
  }

  async function close() {
    sessions.clear();
    requests.clear();
    clearInterval(spoolTimer);
    if (spoolRun) await spoolRun;
    if (spoolDir) await fs.rm(spoolDir, { recursive: true, force: true });
    spoolDir = undefined;
    spoolTimer = undefined;
    if (server) await new Promise((resolve) => server.close(resolve));
    server = null;
    port = undefined;
  }

  return {
    close,
    command,
    connection: (nodeId, sessionId) => {
      const token = crypto.randomBytes(24).toString("hex");
      sessions.set(token, { nodeId, sessionId });
      return { nodeId, port, spoolDir, token };
    },
    revokeSession: (sessionId) => {
      const revokedNodes = new Set();
      for (const [token, session] of sessions) {
        if (session.sessionId !== sessionId) continue;
        revokedNodes.add(session.nodeId);
        sessions.delete(token);
      }
      for (const nodeId of revokedNodes) {
        const stillActive = [...sessions.values()].some((session) => session.nodeId === nodeId);
        if (stillActive) continue;
        for (const request of requests.values()) {
          if (request.status === "pending" && (request.sourceId === nodeId || request.targetId === nodeId)) {
            request.status = "cancelled";
            request.answer = "A sessão de um dos agentes deste pedido foi encerrada.";
          }
        }
      }
    },
    start,
    startSpool,
    sync,
  };
}

module.exports = { createContextBroker };
