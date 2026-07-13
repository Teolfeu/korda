const test = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createContextBroker } = require("../electron/context-broker.cjs");

function runCli(args, env, input = "") {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(__dirname, "..", "bin", "korda"), ...args], { env: { ...process.env, ...env } });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("error", reject);
    child.once("exit", (code) => resolve({ code, stdout, stderr }));
    child.stdin.end(input);
  });
}

function setup(options = {}) {
  const noteWrites = [];
  const requestNotices = [];
  const replyNotices = [];
  const browserCalls = [];
  const runCalls = [];
  const broker = createContextBroker({
    onNoteWrite: (value) => noteWrites.push(value),
    onRequest: (value) => requestNotices.push(value),
    onReply: (value) => replyNotices.push(value),
    browserCommand: async (value) => {
      browserCalls.push(value);
      if (value.action === "list") return value.browsers.map((browser) => `- ${browser.title} (${browser.id})`).join("\n");
      return `${value.action}:${value.browser.id}:${value.args.join(" ")}`;
    },
    runCommand: options.runCommand || (async (value) => {
      runCalls.push(value);
      return `run:${value.action}`;
    }),
  });
  broker.sync({
    nodes: [
      { id: "a", type: "agent", agentName: "Codex", role: "orchestrator", objective: "Delegar" },
      { id: "b", type: "agent", agentName: "OpenCode", role: "executor", objective: "Implementar" },
      { id: "c", type: "agent", agentName: "Claude" },
      { id: "note", type: "note", title: "Brief", content: "Escopo inicial" },
      { id: "browser", type: "browser", title: "Navegador · Chromium" },
      { id: "browser-off", type: "browser", title: "Browser sem corda" },
    ],
    edges: [{ source: "a", target: "b" }, { source: "a", target: "note" }, { source: "a", target: "browser" }],
  });
  return { broker, noteWrites, requestNotices, replyNotices, browserCalls, runCalls };
}

test("encaminha comandos da missão com a identidade autenticada do agente", async () => {
  const { broker, runCalls } = setup();
  const a = broker.connection("a", "session-a");
  const run = (args) => broker.command({ nodeId: "a", suppliedToken: a.token, name: "run", args });

  assert.equal(await run(["status"]), "run:status");
  assert.equal(await run(["approve", "Pronto", "para revisão"]), "run:approve");
  assert.deepEqual(runCalls.map(({ action, source, message }) => ({ action, id: source.id, role: source.role, message })), [
    { action: "status", id: "a", role: "orchestrator", message: "" },
    { action: "approve", id: "a", role: "orchestrator", message: "Pronto para revisão" },
  ]);
  await assert.rejects(run(["remove"]), /run status\|approve\|finish\|fail/);
  await assert.rejects(run(["status", "texto"]), /run status\.$/);
  await broker.close();
});

test("rejeita comando de missão quando o coordenador não está disponível", async () => {
  const broker = createContextBroker({});
  broker.sync({ nodes: [{ id: "a", type: "agent", role: "executor" }], edges: [] });
  const a = broker.connection("a", "session-a");
  await assert.rejects(
    broker.command({ nodeId: "a", suppliedToken: a.token, name: "run", args: ["finish"] }),
    /missão indisponível/,
  );
  await broker.close();
});

test("CLI envia mensagem multilinha de missão por stdin", async () => {
  const { broker, runCalls } = setup();
  const spoolDir = path.join(os.tmpdir(), `korda-run-stdin-${process.pid}-${Date.now()}`);
  await broker.startSpool(spoolDir);
  const connection = broker.connection("b", "session-b");
  const result = await runCli(["run", "finish", "--stdin"], {
    KORDA_NODE_ID: "b",
    KORDA_SPOOL: spoolDir,
    KORDA_TOKEN: connection.token,
  }, "feito\ncom evidências\n");

  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.stdout.trim(), "run:finish");
  assert.equal(runCalls[0].source.id, "b");
  assert.equal(runCalls[0].source.role, "executor");
  assert.equal(runCalls[0].message, "feito\ncom evidências");
  await broker.close();
});

test("delega browser conectado e rejeita browser sem corda", async () => {
  const { broker, browserCalls } = setup();
  const a = broker.connection("a", "session-a");
  const run = (args) => broker.command({ nodeId: "a", suppliedToken: a.token, name: "browser", args });

  assert.match(await run(["list"]), /Navegador · Chromium \(browser\)/);
  assert.equal(await run(["info", "Navegador"]), "info:browser:");
  assert.equal(await run(["navigate", "browser", "https://example.com"]), "navigate:browser:https://example.com/");
  assert.equal(await run(["content", "browser"]), "content:browser:");
  assert.equal(await run(["screenshot", "browser", "evidencia.png"]), "screenshot:browser:evidencia.png");
  assert.equal(await run(["inspect", "browser"]), "inspect:browser:");
  assert.equal(await run(["activate", "browser", "abc:0"]), "activate:browser:abc:0");
  assert.equal(await run(["fill", "browser", "abc:1", "texto", "seguro"]), "fill:browser:abc:1 texto seguro");
  assert.equal(browserCalls.length, 8);
  await assert.rejects(run(["info", "browser-off"]), /Browser conectado não encontrado/);
  await assert.rejects(run(["navigate", "browser", "file:\/\/\/etc\/passwd"]), /somente URLs http/);
  await assert.rejects(run(["activate", "browser"]), /activate <browser> <elemento>/);
  await assert.rejects(run(["fill", "browser", "abc:1"]), /fill <browser> <elemento> <texto>/);
  await broker.close();
});

test("limita comunicação às cordas e troca pedidos sem bloquear o PTY", async () => {
  const { broker, noteWrites, requestNotices, replyNotices } = setup();
  const a = broker.connection("a", "session-a");
  const b = broker.connection("b", "session-b");
  assert.match(await broker.command({ nodeId: "a", suppliedToken: a.token, name: "self" }), /orchestrator/i);
  assert.match(await broker.command({ nodeId: "a", suppliedToken: a.token, name: "list" }), /OpenCode/);
  assert.equal(await broker.command({ nodeId: "a", suppliedToken: a.token, name: "note", args: ["read", "Brief"] }), "Escopo inicial");
  await broker.command({ nodeId: "a", suppliedToken: a.token, name: "note", args: ["write", "Brief", "Escopo", "novo"] });
  assert.deepEqual(noteWrites, [{ id: "note", text: "Escopo novo" }]);

  const sent = await broker.command({ nodeId: "a", suppliedToken: a.token, name: "ask", args: ["OpenCode", "Revise", "isto"] });
  const requestId = sent.match(/Pedido ([0-9a-f-]+)/)[1];
  assert.deepEqual(requestNotices, [{ id: requestId, sourceId: "a", sourceName: "Codex", targetId: "b" }]);
  assert.match(await broker.command({ nodeId: "b", suppliedToken: b.token, name: "inbox" }), /Revise isto/);
  assert.equal(await broker.command({ nodeId: "a", suppliedToken: a.token, name: "wait", args: [requestId] }), "Pendente.");
  await broker.command({ nodeId: "b", suppliedToken: b.token, name: "reply", args: [requestId, "Aprovado"] });
  assert.deepEqual(replyNotices, [{ id: requestId, sourceId: "a", targetId: "b" }]);
  assert.equal(await broker.command({ nodeId: "a", suppliedToken: a.token, name: "wait", args: [requestId] }), "Aprovado");
  await assert.rejects(broker.command({ nodeId: "a", suppliedToken: a.token, name: "ask", args: ["Claude", "Oi"] }), /não encontrado/);
  await broker.close();
});

test("revoga tokens de PTY e cancela pedidos quando a corda some", async () => {
  const { broker } = setup();
  const a = broker.connection("a", "session-a");
  const b = broker.connection("b", "session-b");
  const sent = await broker.command({ nodeId: "a", suppliedToken: a.token, name: "ask", args: ["OpenCode", "Faça"] });
  const requestId = sent.match(/Pedido ([0-9a-f-]+)/)[1];
  broker.sync({ nodes: [{ id: "a", type: "agent" }, { id: "b", type: "agent" }], edges: [] });
  await assert.rejects(broker.command({ nodeId: "b", suppliedToken: b.token, name: "reply", args: [requestId, "feito"] }), /cancelado/);
  await assert.rejects(broker.command({ nodeId: "a", suppliedToken: a.token, name: "wait", args: [requestId] }), /corda foi removida/);
  broker.revokeSession("session-a");
  await assert.rejects(broker.command({ nodeId: "a", suppliedToken: a.token, name: "self" }), /Autenticação/);
  await broker.close();
});

test("CLI aceita conteúdo multilinha por stdin", async () => {
  const { broker, noteWrites } = setup();
  const spoolDir = path.join(os.tmpdir(), `korda-stdin-${process.pid}-${Date.now()}`);
  await broker.startSpool(spoolDir);
  const connection = broker.connection("a", "session-a");
  const result = await runCli(["note", "write", "Brief", "--stdin"], {
    KORDA_NODE_ID: "a",
    KORDA_SPOOL: spoolDir,
    KORDA_TOKEN: connection.token,
  }, "linha 1\nlinha 2\n");
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /Nota atualizada/);
  assert.deepEqual(noteWrites, [{ id: "note", text: "linha 1\nlinha 2" }]);
  await broker.close();
});

test("CLI prefere spool privado, sem rede, e limpa ao fechar", async () => {
  const { broker } = setup();
  const spoolDir = path.join(os.tmpdir(), `korda-${process.pid}-${Date.now()}`);
  await broker.startSpool(spoolDir);
  const connection = broker.connection("a", "session-a");
  assert.equal(connection.spoolDir, spoolDir);
  assert.equal(fs.statSync(spoolDir).mode & 0o777, 0o700);

  const result = await runCli(["self"], {
    KORDA_NODE_ID: "a",
    KORDA_SPOOL: spoolDir,
    KORDA_PORT: "1",
    KORDA_TOKEN: connection.token,
  });
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /Codex/);
  assert.deepEqual(fs.readdirSync(spoolDir), []);
  await broker.close();
  assert.equal(fs.existsSync(spoolDir), false);
});

test("encerrar o último PTY do alvo cancela pedidos pendentes", async () => {
  const { broker } = setup();
  const a = broker.connection("a", "session-a");
  broker.connection("b", "session-b");
  const sent = await broker.command({ nodeId: "a", suppliedToken: a.token, name: "ask", args: ["OpenCode", "Faça"] });
  const requestId = sent.match(/Pedido ([0-9a-f-]+)/)[1];
  broker.revokeSession("session-b");
  await assert.rejects(
    broker.command({ nodeId: "a", suppliedToken: a.token, name: "wait", args: [requestId] }),
    /sessão.*encerrada/i,
  );
  await broker.close();
});

test("CLI completa ask, inbox, reply e wait entre dois agentes", async () => {
  const { broker } = setup();
  const spoolDir = path.join(os.tmpdir(), `korda-cycle-${process.pid}-${Date.now()}`);
  await broker.startSpool(spoolDir);
  const a = broker.connection("a", "session-a");
  const b = broker.connection("b", "session-b");
  const env = (nodeId, token) => ({ KORDA_NODE_ID: nodeId, KORDA_SPOOL: spoolDir, KORDA_TOKEN: token });

  const asked = await runCli(["ask", "OpenCode", "ping"], env("a", a.token));
  assert.equal(asked.code, 0, asked.stderr);
  const requestId = asked.stdout.match(/Pedido ([0-9a-f-]+)/)[1];
  const inbox = await runCli(["inbox"], env("b", b.token));
  assert.match(inbox.stdout, new RegExp(`${requestId}.*ping`, "s"));
  const replied = await runCli(["reply", requestId, "pong"], env("b", b.token));
  assert.equal(replied.code, 0, replied.stderr);
  const waited = await runCli(["wait", requestId], env("a", a.token));
  assert.equal(waited.stdout.trim(), "pong");
  await broker.close();
});
