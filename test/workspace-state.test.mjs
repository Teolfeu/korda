import test from "node:test";
import assert from "node:assert/strict";
import {
  WORKSPACE_STATE_VERSION,
  clearWorkspaceState,
  readLastWorkspace,
  readWorkspaceState,
  saveWorkspaceState,
  workspaceScopeId,
  workspaceStorageKey,
} from "../src/workspace-state.js";

class MemoryStorage {
  values = new Map();
  getItem(key) { return this.values.get(key) ?? null; }
  setItem(key, value) { this.values.set(key, String(value)); }
  removeItem(key) { this.values.delete(key); }
}

const workspace = { name: "Korda", root: "/tmp/korda", tree: [{ name: "segredo" }] };

test("faz roundtrip do canvas e mantém apenas metadados úteis do workspace", () => {
  const storage = new MemoryStorage();
  const nodes = [
    { id: "agent", type: "agent", position: { x: 12, y: 34 }, style: { width: 420, height: 260 }, data: { title: "Codex · Orquestrador", agentId: "codex", agentName: "Codex", command: "/usr/bin/codex", kind: "codex", role: "orchestrator", accent: "#1677ff", objective: "Orquestrar", terminal: true, ports: [{ id: "delegate", label: "delegar", color: "#f97316" }] } },
    { id: "note", type: "note", position: { x: 500, y: 120 }, width: 460, height: 250, style: { width: 300, height: 180 }, data: { title: "Decisões", text: "Manter tudo local.", variant: "text", fontSize: 28, fontWeight: 600 } },
    { id: "browser", type: "browser", position: { x: 40, y: 500 }, data: { title: "Docs", url: "https://example.com/docs" } },
  ];
  const edges = [{ id: "edge", source: "agent", target: "note", sourceHandle: "borda-right-44", targetHandle: "borda-left-44", type: "smoothstep", animated: false, label: "contexto", data: { kind: "context" }, style: { stroke: "#2868d8", strokeWidth: 2.2 }, markerEnd: { type: "arrowclosed", color: "#2868d8", width: 18, height: 18 } }];

  assert.equal(saveWorkspaceState(workspace, { nodes, edges }, storage), true);
  const restored = readWorkspaceState(workspace, storage);
  assert.equal(restored.version, WORKSPACE_STATE_VERSION);
  assert.deepEqual(restored.workspace, { name: "Korda", root: "/tmp/korda" });
  assert.deepEqual(restored.nodes[0].style, { width: 560, height: 380 });
  assert.equal(restored.nodes[1].data.text, "Manter tudo local.");
  assert.deepEqual(restored.nodes[1].data, { title: "Decisões", text: "Manter tudo local.", variant: "text", fontSize: 28, fontWeight: 600 });
  assert.deepEqual(restored.nodes[1].style, { width: 460, height: 250 });
  assert.equal(restored.nodes[2].data.url, "https://example.com/docs");
  assert.deepEqual(restored.edges[0].sourceHandle, "borda-right-44");
  assert.deepEqual(restored.edges[0].targetHandle, "borda-left-44");
  assert.deepEqual(restored.edges[0].markerEnd, { type: "arrowclosed", color: "#2868d8", width: 18, height: 18 });
  assert.deepEqual(readLastWorkspace(storage), { name: "Korda", root: "/tmp/korda" });
});

test("remove callbacks, seleção, internals e qualquer conteúdo transitório de PTY", () => {
  const storage = new MemoryStorage();
  const node = {
    id: "agent", type: "agent", position: { x: 1, y: 2 }, selected: true, dragging: true,
    measured: { width: 999, height: 999 }, internals: { secret: true }, initialWidth: 999,
    data: {
      title: "Codex", command: "codex", role: "executor", objective: "Executar", terminal: true,
      onRemove() {}, onTerminalSession() {}, feed: "pacote secreto", activity: "executando",
      status: "Concluído", statusTone: "running", cwd: "/privado", output: "snapshot do terminal",
      terminalSnapshot: "tokens e prompt", text: "outro snapshot indevido",
    },
  };

  assert.equal(saveWorkspaceState(workspace, { nodes: [node], edges: [] }, storage), true);
  const restored = readWorkspaceState(workspace, storage).nodes[0];
  assert.deepEqual(Object.keys(restored).sort(), ["data", "id", "position", "type"]);
  assert.deepEqual(restored.data, { title: "Codex", command: "codex", role: "executor", objective: "Executar", terminal: true });
  const raw = storage.getItem(workspaceStorageKey(workspace));
  for (const forbidden of ["snapshot do terminal", "outro snapshot indevido", "pacote secreto", "/privado", "terminalSnapshot", "measured", "selected"]) assert.doesNotMatch(raw, new RegExp(forbidden));
});

test("isola workspaces e limpa somente o canvas solicitado", () => {
  const storage = new MemoryStorage();
  const other = { name: "Outro", root: "/tmp/outro" };
  const node = (id) => ({ id, type: "note", position: { x: 0, y: 0 }, data: { title: id, text: id } });

  saveWorkspaceState(workspace, { nodes: [node("a")], edges: [] }, storage);
  saveWorkspaceState(other, { nodes: [node("b")], edges: [] }, storage);
  assert.notEqual(workspaceStorageKey(workspace), workspaceStorageKey(other));
  assert.notEqual(workspaceScopeId({ name: "Korda", root: "/tmp/korda" }), workspaceScopeId({ name: "Korda", root: "/outro/korda" }));
  assert.equal(readWorkspaceState(workspace, storage).nodes[0].id, "a");
  assert.equal(readWorkspaceState(other, storage).nodes[0].id, "b");
  assert.equal(clearWorkspaceState(workspace, storage), true);
  assert.equal(readWorkspaceState(workspace, storage), null);
  assert.equal(readWorkspaceState(other, storage).nodes[0].id, "b");
  assert.deepEqual(readLastWorkspace(storage), { name: "Outro", root: "/tmp/outro" });
});

test("ignora JSON corrompido, rejeita versões futuras e corrige estado legado", () => {
  const storage = new MemoryStorage();
  const key = workspaceStorageKey(workspace);
  storage.setItem(key, "{incompleto");
  assert.equal(readWorkspaceState(workspace, storage), null);

  storage.setItem(key, JSON.stringify({ version: 99, workspace, nodes: [], edges: [] }));
  assert.equal(readWorkspaceState(workspace, storage), null);

  storage.setItem(key, JSON.stringify({
    workspace,
    state: {
      nodes: [
        { id: "ok", type: "note", position: { x: Infinity, y: -2_000_000 }, style: { width: 10, height: 99_999 }, selected: true, data: { title: "Nota", text: "legada" } },
        { id: "ok", type: "note", position: { x: 1, y: 1 }, data: {} },
        { id: "bad", type: "desconhecido", position: {}, data: {} },
      ],
      edges: [{ id: "dangling", source: "ok", target: "ausente" }],
    },
  }));
  const restored = readWorkspaceState(workspace, storage);
  assert.equal(restored.version, WORKSPACE_STATE_VERSION);
  assert.equal(restored.nodes.length, 1);
  assert.deepEqual(restored.nodes[0].position, { x: 0, y: -1_000_000 });
  assert.deepEqual(restored.nodes[0].style, { width: 80, height: 3_000 });
  assert.deepEqual(restored.edges, []);
});
