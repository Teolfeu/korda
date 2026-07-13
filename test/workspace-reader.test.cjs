const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  MAX_TEXT_BYTES,
  MAX_TREE_ENTRIES,
  createWorkspaceWatcher,
  readWorkspaceText,
  readWorkspaceTree,
  writeWorkspaceText,
} = require("../electron/workspace-reader.cjs");

function workspace(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "korda-workspace-reader-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

function flatten(nodes) {
  return nodes.flatMap((node) => [node, ...flatten(node.children || [])]);
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function nextUpdate(updates, predicate = () => true, timeoutMs = 2000) {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    const poll = () => {
      const match = updates.find(predicate);
      if (match) return resolve(match);
      if (Date.now() - startedAt >= timeoutMs) return reject(new Error("Workspace não atualizou a tempo."));
      setTimeout(poll, 10);
    };
    poll();
  });
}

test("lista árvore ordenada sem diretórios ignorados nem symlinks", async (t) => {
  const root = workspace(t);
  fs.mkdirSync(path.join(root, "src"));
  fs.writeFileSync(path.join(root, "src", "index.js"), "export {}\n");
  for (const ignored of ["node_modules", ".git", "dist", ".korda-runtime-1234-test"]) {
    fs.mkdirSync(path.join(root, ignored));
    fs.writeFileSync(path.join(root, ignored, "secret.txt"), "não listar");
  }
  fs.symlinkSync(path.join(root, "src"), path.join(root, "atalho"));

  const result = await readWorkspaceTree(root);
  assert.equal(result.root, fs.realpathSync(root));
  assert.deepEqual(flatten(result.tree).map((node) => node.path), ["src", "src/index.js"]);
  assert.equal(result.truncated, false);
});

test("limita profundidade e quantidade total da árvore", async (t) => {
  const root = workspace(t);
  let nested = root;
  for (let index = 0; index < 8; index += 1) {
    nested = path.join(nested, `d${index}`);
    fs.mkdirSync(nested);
  }
  for (let index = 0; index < MAX_TREE_ENTRIES + 20; index += 1) {
    fs.writeFileSync(path.join(root, `f-${String(index).padStart(4, "0")}.txt`), "x");
  }

  const result = await readWorkspaceTree(root);
  const nodes = flatten(result.tree);
  assert.equal(result.truncated, true);
  assert.equal(nodes.length, MAX_TREE_ENTRIES);
  assert.equal(nodes.find((node) => node.path === "d0/d1/d2/d3/d4/d5")?.children.length, 0);
});

test("lê somente texto UTF-8 dentro da raiz real e retorna revisão estável", async (t) => {
  const root = workspace(t);
  fs.mkdirSync(path.join(root, "docs"));
  fs.writeFileSync(path.join(root, "docs", "olá.txt"), "conteúdo seguro\n");

  const first = await readWorkspaceText(root, "docs/olá.txt");
  const second = await readWorkspaceText(root, "docs/olá.txt");
  assert.deepEqual(first, {
    path: "docs/olá.txt",
    content: "conteúdo seguro\n",
    bytes: Buffer.byteLength("conteúdo seguro\n"),
    revision: first.revision,
  });
  assert.match(first.revision, /^sha256:[0-9a-f]{64}$/);
  assert.equal(second.revision, first.revision);
});

test("salva arquivo existente de forma atômica e atualiza a revisão", async (t) => {
  const root = workspace(t);
  fs.mkdirSync(path.join(root, "src"));
  const target = path.join(root, "src", "index.js");
  fs.writeFileSync(target, "export const old = true;\n");
  fs.chmodSync(target, 0o666);
  const before = await readWorkspaceText(root, "src/index.js");

  const saved = await writeWorkspaceText(root, "src/index.js", "export const next = true;\n", before.revision);

  assert.deepEqual(saved, {
    path: "src/index.js",
    content: "export const next = true;\n",
    bytes: Buffer.byteLength("export const next = true;\n"),
    revision: saved.revision,
  });
  assert.notEqual(saved.revision, before.revision);
  assert.equal(fs.readFileSync(target, "utf8"), saved.content);
  assert.equal(fs.statSync(target).mode & 0o777, 0o666);
  assert.deepEqual(fs.readdirSync(path.dirname(target)).filter((name) => name.startsWith(".korda-write-")), []);
});

test("detecta conflito e preserva a alteração externa", async (t) => {
  const root = workspace(t);
  const target = path.join(root, "notes.md");
  fs.writeFileSync(target, "versão inicial\n");
  const opened = await readWorkspaceText(root, "notes.md");
  fs.writeFileSync(target, "mudança externa\n");

  await assert.rejects(
    writeWorkspaceText(root, "notes.md", "mudança do editor\n", opened.revision),
    (error) => error?.code === "WORKSPACE_REVISION_CONFLICT" && /mudou no disco/.test(error.message),
  );
  assert.equal(fs.readFileSync(target, "utf8"), "mudança externa\n");
  assert.deepEqual(fs.readdirSync(root).filter((name) => name.startsWith(".korda-write-")), []);
});

test("recusa criação, traversal, symlink, binário e conteúdo inválido ao salvar", async (t) => {
  const root = workspace(t);
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "korda-workspace-write-outside-"));
  t.after(() => fs.rmSync(outside, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, "plain.txt"), "texto\n");
  fs.mkdirSync(path.join(root, "nested"));
  fs.symlinkSync(path.join(root, "plain.txt"), path.join(root, "inside-link.txt"));
  fs.writeFileSync(path.join(root, "binary.dat"), Buffer.from([0, 1, 2]));
  fs.writeFileSync(path.join(outside, "secret.txt"), "fora\n");
  fs.symlinkSync(path.join(outside, "secret.txt"), path.join(root, "escape.txt"));
  const plain = await readWorkspaceText(root, "plain.txt");

  await assert.rejects(writeWorkspaceText(root, "new.txt", "novo", plain.revision), /ENOENT|realpath/);
  await assert.rejects(writeWorkspaceText(root, "../outside.txt", "não", plain.revision), /Travessia/);
  await assert.rejects(writeWorkspaceText(root, "nested/../plain.txt", "não", plain.revision), /Travessia/);
  await assert.rejects(writeWorkspaceText(root, "inside-link.txt", "não", plain.revision), /simbólicos/);
  await assert.rejects(writeWorkspaceText(root, "escape.txt", "não", plain.revision), /fora do workspace/);
  await assert.rejects(writeWorkspaceText(root, "binary.dat", "não", plain.revision), /binário/);
  await assert.rejects(writeWorkspaceText(root, "plain.txt", "x\0y", plain.revision), /Conteúdo.*inválido/);
  await assert.rejects(writeWorkspaceText(root, "plain.txt", "x".repeat(MAX_TEXT_BYTES + 1), plain.revision), /grande demais/);
  await assert.rejects(writeWorkspaceText(root, "plain.txt", "válido", "revisão falsa"), /Revisão.*inválida/);
  assert.equal(fs.readFileSync(path.join(root, "plain.txt"), "utf8"), "texto\n");
});

test("bloqueia traversal, escape por symlink, binários e arquivos grandes", async (t) => {
  const root = workspace(t);
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "korda-workspace-outside-"));
  t.after(() => fs.rmSync(outside, { recursive: true, force: true }));
  fs.writeFileSync(path.join(outside, "secret.txt"), "segredo");
  fs.symlinkSync(outside, path.join(root, "escape"));
  fs.writeFileSync(path.join(root, "binary.dat"), Buffer.from([0, 1, 2, 3]));
  fs.writeFileSync(path.join(root, "invalid.dat"), Buffer.from([0xff, 0xfe, 0xfd]));
  fs.writeFileSync(path.join(root, "large.txt"), Buffer.alloc(MAX_TEXT_BYTES + 1, 97));

  await assert.rejects(readWorkspaceText(root, "../secret.txt"), /Travessia/);
  await assert.rejects(readWorkspaceText(root, path.join(outside, "secret.txt")), /Caminho de arquivo inválido/);
  await assert.rejects(readWorkspaceText(root, "escape/secret.txt"), /fora do workspace/);
  await assert.rejects(readWorkspaceText(root, "binary.dat"), /binário/);
  await assert.rejects(readWorkspaceText(root, "invalid.dat"), /binário/);
  await assert.rejects(readWorkspaceText(root, "large.txt"), /grande demais/);
});

test("watcher atualiza subpastas e agrupa rajadas em uma releitura", async (t) => {
  const root = workspace(t);
  fs.mkdirSync(path.join(root, "src"));
  const updates = [];
  const dispose = createWorkspaceWatcher(root, (payload) => updates.push(payload), { debounceMs: 40 });
  t.after(dispose);

  fs.writeFileSync(path.join(root, "src", "one.txt"), "1");
  fs.writeFileSync(path.join(root, "src", "two.txt"), "2");
  fs.writeFileSync(path.join(root, "src", "three.txt"), "3");

  const update = await nextUpdate(updates, (payload) => flatten(payload.tree || []).some((node) => node.path === "src/three.txt"));
  assert.equal(update.root, fs.realpathSync(root));
  await delay(120);
  assert.equal(updates.length, 1);
});

test("watcher ignora diretórios excluídos e para após dispose", async (t) => {
  const root = workspace(t);
  const updates = [];
  for (const ignored of ["node_modules", ".git", "dist", ".korda-runtime-test"]) fs.mkdirSync(path.join(root, ignored));
  const dispose = createWorkspaceWatcher(root, (payload) => updates.push(payload), { debounceMs: 30 });

  for (const ignored of ["node_modules", ".git", "dist", ".korda-runtime-test"]) {
    fs.writeFileSync(path.join(root, ignored, "ignored.txt"), "x");
  }
  await delay(120);
  assert.equal(updates.length, 0);

  dispose();
  fs.writeFileSync(path.join(root, "after-close.txt"), "x");
  await delay(100);
  assert.equal(updates.length, 0);
});
