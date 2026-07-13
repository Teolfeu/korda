const ROLE_LABELS = Object.freeze({
  orchestrator: "Orquestrador",
  executor: "Executor",
  reviewer: "Revisor",
  researcher: "Pesquisador",
});

function requiredText(value, name) {
  if (typeof value !== "string" || !value.trim()) throw new TypeError(`${name} deve ser uma string não vazia.`);
  return value.trim();
}

function nodeValue(node, key) {
  return node?.data?.[key] ?? node?.[key];
}

function nodeType(node) {
  return node?.type || nodeValue(node, "type") || "agent";
}

function nodeName(node) {
  return [nodeValue(node, "agentName"), nodeValue(node, "title"), nodeValue(node, "label"), node?.id]
    .find((value) => typeof value === "string" && value.trim())?.trim();
}

function roleOf(node) {
  const role = nodeValue(node, "role");
  return typeof role === "string" && role.trim() ? role.trim() : "agent";
}

function objectiveOf(node) {
  const objective = nodeValue(node, "objective");
  return typeof objective === "string" ? objective.trim() : "";
}

function edgeKind(edge) {
  const kind = edge?.data?.kind ?? edge?.kind;
  return typeof kind === "string" && kind.trim() ? kind.trim() : "context";
}

function prepare({ nodeId, sessionId = "", nodes, edges } = {}) {
  const id = requiredText(nodeId, "nodeId");
  if (typeof sessionId !== "string") throw new TypeError("sessionId deve ser uma string.");
  if (!Array.isArray(nodes)) throw new TypeError("nodes deve ser um array.");
  if (!Array.isArray(edges)) throw new TypeError("edges deve ser um array.");

  const byId = new Map();
  for (const [index, node] of nodes.entries()) {
    if (!node || typeof node !== "object" || Array.isArray(node)) {
      throw new TypeError(`nodes[${index}] deve ser um objeto.`);
    }
    const candidateId = requiredText(node.id, `nodes[${index}].id`);
    if (byId.has(candidateId)) throw new Error(`ID de nó duplicado: ${candidateId}.`);
    byId.set(candidateId, node);
  }

  const node = byId.get(id);
  if (!node) throw new Error(`Agente não encontrado: ${id}.`);
  if (nodeType(node) !== "agent") throw new Error(`O nó ${id} não é um agente.`);

  const connections = [];
  for (const edge of edges) {
    if (!edge || typeof edge !== "object" || Array.isArray(edge)) continue;
    const source = typeof edge.source === "string" ? edge.source.trim() : "";
    const target = typeof edge.target === "string" ? edge.target.trim() : "";
    const neighborId = source === id ? target : target === id ? source : "";
    const neighbor = byId.get(neighborId);
    if (!neighbor || neighborId === id) continue;
    connections.push({
      id: neighborId,
      kind: edgeKind(edge),
      name: nodeName(neighbor) || neighborId,
      role: roleOf(neighbor),
      type: nodeType(neighbor),
    });
  }

  connections.sort((left, right) => left.id.localeCompare(right.id) || left.kind.localeCompare(right.kind));
  return { node, sessionId: sessionId.trim(), connections };
}

function roleLabel(role) {
  return ROLE_LABELS[role] || "Agente";
}

/**
 * Stable, per-agent signature used to deduplicate bootstrap delivery.
 * Deliberately excludes mutable runtime/UI data such as status, position and output.
 */
export function agentTopologySignature(input) {
  const { node, sessionId, connections } = prepare(input);
  return JSON.stringify({
    sessionId,
    role: roleOf(node),
    objective: objectiveOf(node),
    connections: connections.map(({ id, kind, role, type }) => ({ id, kind, role, type })),
  });
}

export function buildAgentProtocol(input) {
  const { node, connections } = prepare(input);
  const role = roleOf(node);
  const label = roleLabel(role);
  const objective = objectiveOf(node) || "Colabore de acordo com o papel atribuído no canvas.";
  const connectionLines = connections.length
    ? connections.map(({ id, kind, name, role: neighborRole, type }) => (
      `- ${name} (${id}) — ${type === "agent" ? roleLabel(neighborRole) : type} · corda ${kind}`
    ))
    : ["- Nenhuma conexão disponível agora."];

  const common = [
    `[Korda · ${label}]`,
    `Papel: ${label}. Objetivo: ${objective}`,
    "Conexões atuais:",
    ...connectionLines,
    "Confirme o estado atual com `korda self` e `korda list`. Mensagens de trabalho ficam no broker autenticado: leia `korda inbox` e responda com `korda reply`.",
  ];

  if (role === "orchestrator") {
    common.push(
      "Ao receber qualquer tarefa normal do usuário, assuma automaticamente a coordenação; não espere que ele cite Korda, Hermes ou comandos internos.",
      "Consulte as conexões, decomponha a tarefa e delegue com `korda ask` a Executores e Pesquisadores conectados. Aguarde as respostas com `korda wait`.",
      "Quando houver Revisor conectado, envie o resultado para revisão, aguarde a resposta e só então consolide a entrega ao usuário. Uma missão formal continua opcional e separada.",
    );
  } else {
    common.push(
      "Quando houver pedido, leia-o no broker, execute somente o trabalho delegado e devolva resultado objetivo com evidências usando `korda reply`.",
      ...(role === "reviewer" ? ["Como Revisor, valide o resultado recebido e relate falhas verificáveis antes da consolidação."] : []),
      ...(role === "researcher" ? ["Como Pesquisador, busque fontes verificáveis, registre links ou evidências e não implemente mudanças fora do pedido."] : []),
      ...(role === "executor" ? ["Como Executor, implemente o escopo recebido, rode as verificações relevantes e devolva arquivos alterados e resultados."] : []),
    );
  }

  return common.join("\n");
}

export function agentTopologySnapshot(input) {
  const prepared = prepare(input);
  return {
    signature: agentTopologySignature(input),
    protocol: buildAgentProtocol(input),
    neighbors: prepared.connections.map(({ id }) => id),
  };
}
