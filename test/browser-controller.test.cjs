const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { createBrowserController, MAX_CONTENT_LENGTH, MAX_INTERACTIVE_ITEMS, MAX_FIELD_LENGTH } = require("../electron/browser-controller.cjs");

function fakeWebContents(id = 1) {
  let url = "https://example.com/";
  let lastInventory = [];
  return {
    id,
    getURL: () => url,
    getTitle: () => "Example",
    isLoading: () => false,
    loadURL: async (value) => { url = value; },
    executeJavaScript: async (script) => {
      if (script === 'document.body?.innerText || ""') return "conteúdo visível ".repeat(10_000);
      const prefix = script.match(/const prefix = "([a-f0-9]+)"/)?.[1];
      if (prefix) {
        assert.ok(!script.includes("|| element.value"));
        assert.ok(script.includes('autocomplete.startsWith("cc-")'));
        lastInventory = [
          { id: `${prefix}:0`, kind: "action", label: "Documentação", type: "", fillable: false, sensitive: false },
          { id: `${prefix}:1`, kind: "field", label: "Busca", type: "search", fillable: true, sensitive: false },
          { id: `${prefix}:2`, kind: "field", label: "Senha", type: "password", fillable: false, sensitive: true },
          { id: `${prefix}:3`, kind: "action", label: "Finalizar compra", type: "submit", fillable: false, sensitive: false, requiresConfirmation: true },
        ];
        return lastInventory;
      }
      const target = script.match(/const id = "([a-f0-9]+:\d+)"/)?.[1];
      if (!lastInventory.some((item) => item.id === target)) return { ok: false };
      return { ok: true };
    },
    capturePage: async () => ({ toPNG: () => Buffer.from("png") }),
    once: () => {},
  };
}

test("controla somente ações explícitas e URLs web", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "korda-browser-"));
  const controller = createBrowserController({ getWorkspaceRoot: () => root });
  const contents = fakeWebContents();
  controller.register("browser-1", contents);

  assert.deepEqual(await controller.command("browser-1", "info"), {
    url: "https://example.com/", title: "Example", loading: false,
  });
  assert.equal(await controller.command("browser-1", "navigate", { url: "https://openai.com/docs" }), "https://openai.com/docs");
  await assert.rejects(controller.command("browser-1", "navigate", { url: "file:///etc/passwd" }), /HTTP e HTTPS/);
  await assert.rejects(controller.command("browser-1", "navigate", { url: "https://user:secret@example.com" }), /Credenciais/);
  assert.equal((await controller.command("browser-1", "content")).length, MAX_CONTENT_LENGTH);
  await assert.rejects(controller.command("browser-1", "click", {}), /Ação.*inválida/);

  assert.equal(controller.unregister("browser-1", 999), false);
  assert.equal(controller.unregister("browser-1", 1), true);
  await assert.rejects(controller.command("browser-1", "info"), /não encontrado/);
  fs.rmSync(root, { recursive: true, force: true });
});

test("inspeciona, ativa e preenche somente IDs efêmeros emitidos pelo controlador", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "korda-browser-"));
  const controller = createBrowserController({ getWorkspaceRoot: () => root });
  controller.register("browser", fakeWebContents());

  const first = await controller.command("browser", "inspect");
  assert.equal(first.length, 4);
  assert.deepEqual(first.map(({ kind, label, fillable, requiresConfirmation }) => ({ kind, label, fillable, requiresConfirmation })), [
    { kind: "action", label: "Documentação", fillable: false, requiresConfirmation: false },
    { kind: "field", label: "Busca", fillable: true, requiresConfirmation: false },
    { kind: "field", label: "Senha", fillable: false, requiresConfirmation: false },
    { kind: "action", label: "Finalizar compra", fillable: false, requiresConfirmation: true },
  ]);
  assert.equal(await controller.command("browser", "activate", { id: first[0].id }), "Elemento ativado.");
  await assert.rejects(controller.command("browser", "activate", { id: first[1].id }), /não pode ser ativado/);
  assert.equal(await controller.command("browser", "fill", { id: first[1].id, value: "Korda" }), "Campo preenchido.");
  await assert.rejects(controller.command("browser", "fill", { id: first[2].id, value: "segredo" }), /segurança/);
  await assert.rejects(controller.command("browser", "activate", { id: first[3].id }), /confirmação humana/);
  await assert.rejects(controller.command("browser", "activate", { id: "inventado:0" }), /inexistente ou obsoleto/);

  const second = await controller.command("browser", "inspect");
  await assert.rejects(controller.command("browser", "activate", { id: first[0].id }), /inexistente ou obsoleto/);
  assert.notEqual(first[0].id, second[0].id);
  fs.rmSync(root, { recursive: true, force: true });
});

test("limita inventário, rótulos e texto preenchido", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "korda-browser-"));
  const contents = fakeWebContents();
  contents.executeJavaScript = async (script) => {
    const prefix = script.match(/const prefix = "([a-f0-9]+)"/)?.[1];
    if (prefix) return Array.from({ length: MAX_INTERACTIVE_ITEMS + 20 }, (_, index) => ({
      id: `${prefix}:${index}`, kind: "field", label: "x".repeat(500), fillable: true,
    }));
    assert.ok(script.includes(JSON.stringify("x".repeat(MAX_FIELD_LENGTH))));
    assert.ok(!script.includes(JSON.stringify("x".repeat(MAX_FIELD_LENGTH + 1))));
    return { ok: true };
  };
  const controller = createBrowserController({ getWorkspaceRoot: () => root });
  controller.register("browser", contents);

  const inventory = await controller.command("browser", "inspect");
  assert.equal(inventory.length, MAX_INTERACTIVE_ITEMS);
  assert.equal(inventory[0].label.length, 200);
  await controller.command("browser", "fill", { id: inventory[0].id, value: "x".repeat(MAX_FIELD_LENGTH + 100) });
  fs.rmSync(root, { recursive: true, force: true });
});

test("salva captura somente dentro do workspace e sem sobrescrever", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "korda-browser-"));
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "korda-outside-"));
  try {
    const controller = createBrowserController({ getWorkspaceRoot: () => root });
    controller.register("browser", fakeWebContents());

    const saved = await controller.command("browser", "screenshot", { path: "captura.png" });
    assert.equal(saved, path.join(root, "captura.png"));
    assert.equal(fs.readFileSync(saved, "utf8"), "png");
    await assert.rejects(controller.command("browser", "screenshot", { path: "captura.png" }), /EEXIST/);
    await assert.rejects(controller.command("browser", "screenshot", { path: path.join(outside, "escape.png") }), /raiz da pasta/);
    await assert.rejects(controller.command("browser", "screenshot", { path: "../escape.png" }), /raiz da pasta/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  }
});
