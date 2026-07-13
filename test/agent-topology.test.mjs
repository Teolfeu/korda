import test from "node:test";
import assert from "node:assert/strict";
import {
  agentTopologySignature,
  agentTopologySnapshot,
  buildAgentProtocol,
} from "../src/agent-topology.js";

const nodes = [
  { id: "orch", type: "agent", position: { x: 1, y: 2 }, data: { agentName: "Codex", role: "orchestrator", objective: "Coordenar", status: "Pronto", output: "segredo" } },
  { id: "review", type: "agent", data: { agentName: "Hermes", role: "reviewer", objective: "Revisar" } },
  { id: "exec", type: "agent", data: { agentName: "OpenCode", role: "executor", objective: "Implementar" } },
  { id: "note", type: "note", data: { title: "Contexto", text: "privado" } },
];

const edges = [
  { source: "orch", target: "review", data: { kind: "validate" } },
  { source: "exec", target: "orch", data: { kind: "delegate" } },
  { source: "orch", target: "note", data: { kind: "context" } },
];

test("gera protocolo curto com papel, objetivo e vizinhos ordenados", () => {
  const snapshot = agentTopologySnapshot({ nodeId: "orch", sessionId: "pty-1", nodes, edges });

  assert.deepEqual(snapshot.neighbors, ["exec", "note", "review"]);
  assert.match(snapshot.protocol, /^\[Korda · Orquestrador\]/);
  assert.match(snapshot.protocol, /Objetivo: Coordenar/);
  assert.ok(snapshot.protocol.indexOf("OpenCode") < snapshot.protocol.indexOf("Contexto"));
  assert.ok(snapshot.protocol.indexOf("Contexto") < snapshot.protocol.indexOf("Hermes"));
  assert.match(snapshot.protocol, /assuma automaticamente a coordenação/);
  assert.match(snapshot.protocol, /não espere que ele cite Korda, Hermes ou comandos internos/);
  assert.match(snapshot.protocol, /Executores e Pesquisadores/);
  assert.match(snapshot.protocol, /Revisor conectado/);
  assert.doesNotMatch(snapshot.protocol, /segredo|privado/);
});

test("assinatura muda somente com sessão, papel, objetivo ou topologia relevante", () => {
  const input = { nodeId: "orch", sessionId: "pty-1", nodes, edges };
  const baseline = agentTopologySignature(input);
  const noisyNodes = nodes.map((node) => node.id === "orch"
    ? { ...node, position: { x: 999, y: 888 }, data: { ...node.data, status: "Executando", output: "outra saída", transcript: "pedido secreto" } }
    : node);

  assert.equal(agentTopologySignature({ ...input, nodes: noisyNodes }), baseline);
  assert.equal(agentTopologySignature({ ...input, edges: [...edges].reverse() }), baseline);
  assert.equal(agentTopologySignature({ ...input, nodes: [...nodes].reverse() }), baseline);
  assert.notEqual(agentTopologySignature({ ...input, sessionId: "pty-2" }), baseline);
  assert.notEqual(agentTopologySignature({ ...input, nodes: nodes.map((node) => node.id === "orch" ? { ...node, data: { ...node.data, role: "executor" } } : node) }), baseline);
  assert.notEqual(agentTopologySignature({ ...input, nodes: nodes.map((node) => node.id === "orch" ? { ...node, data: { ...node.data, objective: "Outro objetivo" } } : node) }), baseline);
  assert.notEqual(agentTopologySignature({ ...input, edges: edges.slice(1) }), baseline);
  assert.notEqual(agentTopologySignature({ ...input, nodes: nodes.map((node) => node.id === "exec" ? { ...node, data: { ...node.data, role: "researcher" } } : node) }), baseline);
});

test("mudanças desconectadas não reenviam protocolo para o agente", () => {
  const extraNodes = [...nodes, { id: "other-a", type: "agent", data: { role: "executor" } }, { id: "other-b", type: "agent", data: { role: "reviewer" } }];
  const baseline = agentTopologySignature({ nodeId: "orch", sessionId: "pty-1", nodes: extraNodes, edges });
  const unrelated = [...edges, { source: "other-a", target: "other-b", kind: "validate" }];

  assert.equal(agentTopologySignature({ nodeId: "orch", sessionId: "pty-1", nodes: extraNodes, edges: unrelated }), baseline);
});

test("protocolo de trabalhador usa inbox/reply sem incorporar prompt ou transcrição", () => {
  const workerNodes = nodes.map((node) => node.id === "exec"
    ? { ...node, data: { ...node.data, prompt: "PROMPT_PRIVADO", transcript: "TRANSCRIPT_PRIVADO", output: "OUTPUT_PRIVADO" } }
    : node);
  const protocol = buildAgentProtocol({ nodeId: "exec", sessionId: "exec-1", nodes: workerNodes, edges });

  assert.match(protocol, /\[Korda · Executor\]/);
  assert.match(protocol, /korda inbox/);
  assert.match(protocol, /korda reply/);
  assert.doesNotMatch(protocol, /PROMPT_PRIVADO|TRANSCRIPT_PRIVADO|OUTPUT_PRIVADO/);
  const researcher = buildAgentProtocol({
    nodeId: "exec",
    sessionId: "research-1",
    nodes: workerNodes.map((node) => node.id === "exec" ? { ...node, data: { ...node.data, role: "researcher" } } : node),
    edges,
  });
  assert.match(researcher, /fontes verificáveis/);
});

test("rejeita agente ausente e entradas estruturais inválidas", () => {
  assert.throws(() => buildAgentProtocol({ nodeId: "missing", nodes, edges }), /Agente não encontrado/);
  assert.throws(() => buildAgentProtocol({ nodeId: "orch", nodes: null, edges }), /nodes deve ser um array/);
  assert.throws(() => buildAgentProtocol({ nodeId: "note", nodes, edges }), /não é um agente/);
});
