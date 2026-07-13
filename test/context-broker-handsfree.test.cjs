const test = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createContextBroker } = require("../electron/context-broker.cjs");

const cli = path.join(__dirname, "..", "bin", "korda");
const fakeAgent = path.join(__dirname, "fixtures", "korda-fake-agent");

function runCli(args, env, timeout = 2_000) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cli, ...args], { env: { ...process.env, ...env } });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => child.kill("SIGKILL"), timeout);
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("error", reject);
    child.once("exit", (code) => {
      clearTimeout(timer);
      if (code !== 0) return reject(new Error(stderr.trim() || `korda saiu com código ${code}`));
      resolve(stdout.trim());
    });
  });
}

function waitForReady(child) {
  return new Promise((resolve, reject) => {
    let output = "";
    const timer = setTimeout(() => reject(new Error("agente falso não ficou pronto")), 2_000);
    child.stdout.on("data", (chunk) => {
      output += chunk;
      if (!output.includes("READY\n")) return;
      clearTimeout(timer);
      resolve();
    });
    child.once("error", reject);
    child.once("exit", (code) => reject(new Error(`agente falso encerrou antes de ficar pronto (${code})`)));
  });
}

function stop(child) {
  return new Promise((resolve) => {
    if (child.exitCode !== null) return resolve();
    const timer = setTimeout(() => child.kill("SIGKILL"), 1_000);
    child.once("exit", () => { clearTimeout(timer); resolve(); });
    child.kill("SIGTERM");
  });
}

test("agente falso responde via ask/inbox/reply/wait sem Enter humano", { timeout: 10_000 }, async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "korda-handsfree-"));
  const spool = path.join(root, "spool");
  const broker = createContextBroker({});
  let worker;
  try {
    broker.sync({
      nodes: [
        { id: "orchestrator", type: "agent", agentName: "Orquestrador", role: "orchestrator" },
        { id: "executor", type: "agent", agentName: "Executor Fake", role: "executor" },
      ],
      edges: [{ source: "orchestrator", target: "executor" }],
    });
    await broker.startSpool(spool);
    const orchestrator = broker.connection("orchestrator", "session-orchestrator");
    const executor = broker.connection("executor", "session-executor");
    const env = (connection) => ({
      KORDA_NODE_ID: connection.nodeId,
      KORDA_SPOOL: connection.spoolDir,
      KORDA_TOKEN: connection.token,
    });

    worker = spawn(process.execPath, [fakeAgent], {
      env: { ...process.env, ...env(executor) },
      stdio: ["ignore", "pipe", "pipe"],
    });
    await waitForReady(worker);

    const asked = await runCli(["ask", "Executor Fake", "responda sem interação"], env(orchestrator));
    const requestId = asked.match(/Pedido ([0-9a-f-]{36})/)?.[1];
    assert.ok(requestId, asked);

    const deadline = Date.now() + 3_000;
    let answer = "Pendente.";
    while (answer === "Pendente." && Date.now() < deadline) {
      answer = await runCli(["wait", requestId], env(orchestrator));
      if (answer === "Pendente.") await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert.equal(answer, "fake-ok: responda sem interação");
  } finally {
    if (worker) await stop(worker);
    await broker.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
  assert.equal(fs.existsSync(root), false);
});
