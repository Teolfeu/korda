export const EDGE_KINDS = Object.freeze({
  delegate: 'delegate',
  validate: 'validate',
  browser: 'browser',
  context: 'context',
});

const EDGE_STYLES = Object.freeze({
  delegate: Object.freeze({ label: 'delegar', color: '#e87824', animated: false, dash: '' }),
  validate: Object.freeze({ label: 'validar', color: '#23965b', animated: false, dash: '' }),
  browser: Object.freeze({ label: 'navegador', color: '#158fa3', animated: false, dash: '' }),
  context: Object.freeze({ label: 'contexto', color: '#2868d8', animated: false, dash: '' }),
});

const KIND_INSTRUCTIONS = Object.freeze({
  delegate: 'Execute a tarefa delegada e devolva um resultado objetivo ao agente de origem.',
  validate: 'Revise o trabalho recebido, aponte falhas verificáveis e confirme apenas o que estiver correto.',
  browser: 'Use o navegador conectado para investigar ou executar a tarefa e registre as evidências relevantes.',
  context: 'Use o contexto compartilhado para continuar o trabalho sem repetir a investigação já feita.',
});

const TRUNCATION_MARKER = '\n… [conteúdo truncado pelo Korda]';
const MAX_TRANSCRIPT_CHARS = 5_000;
const MAX_CONTEXT_CHARS = 3_000;
const MAX_PACKET_CHARS = 10_000;

function requireObject(value, name) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${name} deve ser um objeto.`);
  }
  return value;
}

function requireId(value, name) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new TypeError(`${name} deve ser uma string não vazia.`);
  }
  return value;
}

function truncate(value, limit) {
  if (value.length <= limit) return value;
  return value.slice(0, limit - TRUNCATION_MARKER.length).trimEnd() + TRUNCATION_MARKER;
}

function describeNode(node, name) {
  requireObject(node, name);
  const id = requireId(node.id, `${name}.id`);
  const candidates = [node.data?.title, node.data?.label, node.title, node.label, node.name];
  const title = candidates.find((value) => typeof value === 'string' && value.trim())?.trim() || id;
  return { id, title };
}

function formatContextItem(item, index) {
  if (typeof item === 'string') return item.trim();
  if (!item || typeof item !== 'object' || Array.isArray(item)) {
    throw new TypeError(`context[${index}] deve ser texto ou objeto.`);
  }

  const heading = [item.title, item.path, item.name]
    .find((value) => typeof value === 'string' && value.trim())?.trim();
  const explicitBody = [item.content, item.text]
    .find((value) => typeof value === 'string');

  let body = explicitBody;
  if (body === undefined) {
    try {
      body = JSON.stringify(item);
    } catch {
      throw new TypeError(`context[${index}] não pode ser serializado.`);
    }
  }
  if (typeof body !== 'string') throw new TypeError(`context[${index}] não contém texto válido.`);
  return heading ? `[${heading}]\n${body.trim()}` : body.trim();
}

export function edgeStyle(kind) {
  if (typeof kind !== 'string' || !Object.hasOwn(EDGE_STYLES, kind)) {
    throw new RangeError(`Tipo de corda inválido: ${String(kind)}.`);
  }
  return { ...EDGE_STYLES[kind] };
}

export function traversalPlan(nodes, edges, startId) {
  if (!Array.isArray(nodes)) throw new TypeError('nodes deve ser um array.');
  if (!Array.isArray(edges)) throw new TypeError('edges deve ser um array.');
  requireId(startId, 'startId');

  const byId = new Map();
  for (const [index, node] of nodes.entries()) {
    requireObject(node, `nodes[${index}]`);
    const id = requireId(node.id, `nodes[${index}].id`);
    if (byId.has(id)) throw new Error(`ID de nó duplicado: ${id}.`);
    byId.set(id, node);
  }
  if (!byId.has(startId)) throw new Error(`Nó inicial não encontrado: ${startId}.`);

  const outgoing = new Map(nodes.map(({ id }) => [id, []]));
  for (const [index, edge] of edges.entries()) {
    requireObject(edge, `edges[${index}]`);
    const source = requireId(edge.source, `edges[${index}].source`);
    const target = requireId(edge.target, `edges[${index}].target`);
    if (!byId.has(source) || !byId.has(target)) {
      throw new Error(`A corda ${edge.id || index} referencia um nó inexistente.`);
    }
    outgoing.get(source).push({ edge, target });
  }

  const visited = new Set([startId]);
  const queue = [{ id: startId, source: null, edge: null }];
  const result = [];
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const step = queue[cursor];
    result.push({
      node: byId.get(step.id),
      source: step.source ? byId.get(step.source) : null,
      edge: step.edge,
    });
    for (const { edge, target } of outgoing.get(step.id)) {
      if (visited.has(target)) continue;
      visited.add(target);
      queue.push({ id: target, source: step.id, edge });
    }
  }
  return result;
}

export function traversalOrder(nodes, edges, startId) {
  return traversalPlan(nodes, edges, startId).map(({ node }) => node);
}

export function buildContextPacket({ source, target, edge, transcript = '', context = [] } = {}) {
  const from = describeNode(source, 'source');
  const to = describeNode(target, 'target');
  requireObject(edge, 'edge');
  if (edge.source !== from.id || edge.target !== to.id) {
    throw new Error('A origem e o destino da corda não correspondem aos nós informados.');
  }
  if (typeof transcript !== 'string') throw new TypeError('transcript deve ser uma string.');
  if (!Array.isArray(context)) throw new TypeError('context deve ser um array.');

  const kind = edge.data?.kind ?? edge.kind;
  const style = edgeStyle(kind);
  const sharedContext = truncate(context.map(formatContextItem).filter(Boolean).join('\n\n'), MAX_CONTEXT_CHARS);
  const recentTranscript = truncate(transcript.trim(), MAX_TRANSCRIPT_CHARS);

  return truncate([
    `[Korda — corda: ${style.label} (${kind})]`,
    `Origem: ${from.title} (${from.id})`,
    `Destino: ${to.title} (${to.id})`,
    `Ação: ${KIND_INSTRUCTIONS[kind]}`,
    `Contexto compartilhado:\n${sharedContext || '(nenhum contexto adicional)'}`,
    `Transcrição recente da origem:\n${recentTranscript || '(sem transcrição)'}`,
  ].join('\n\n'), MAX_PACKET_CHARS);
}
