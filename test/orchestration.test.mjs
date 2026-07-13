import test from 'node:test';
import assert from 'node:assert/strict';
import {
  EDGE_KINDS,
  buildContextPacket,
  edgeStyle,
  traversalOrder,
  traversalPlan,
} from '../src/orchestration.js';

const nodes = [
  { id: 'lead', data: { title: 'Codex orquestrador' } },
  { id: 'worker', data: { title: 'Executor' } },
  { id: 'review', data: { title: 'Revisor' } },
  { id: 'isolated', data: { title: 'Isolado' } },
];

test('propaga em ordem dirigida e cria um pacote para shapes do React Flow', () => {
  const edges = [
    { id: 'b', source: 'lead', target: 'review', data: { kind: EDGE_KINDS.validate } },
    { id: 'a', source: 'lead', target: 'worker', data: { kind: EDGE_KINDS.delegate } },
  ];

  assert.deepEqual(traversalOrder(nodes, edges, 'lead').map(({ id }) => id), ['lead', 'review', 'worker']);
  assert.deepEqual(edgeStyle(EDGE_KINDS.delegate), {
    label: 'delegar', color: '#e87824', animated: false, dash: '',
  });

  const packet = buildContextPacket({
    source: nodes[0],
    target: nodes[1],
    edge: edges[1],
    transcript: 'Identifiquei a causa raiz.',
    context: [{ path: 'src/App.jsx', content: 'Revise o fluxo atual.' }],
  });
  assert.match(packet, /corda: delegar \(delegate\)/);
  assert.match(packet, /Codex orquestrador/);
  assert.match(packet, /\[src\/App\.jsx\]/);
});

test('encerra ciclos e não inclui nós inalcançáveis', () => {
  const edges = [
    { source: 'lead', target: 'worker' },
    { source: 'worker', target: 'review' },
    { source: 'review', target: 'lead' },
  ];
  assert.deepEqual(traversalOrder(nodes, edges, 'lead').map(({ id }) => id), ['lead', 'worker', 'review']);
});

test('preserva a corda que tornou cada nó alcançável', () => {
  const misleading = { id: 'isolated-first', source: 'isolated', target: 'worker', data: { kind: EDGE_KINDS.context } };
  const reachable = { id: 'lead-worker', source: 'lead', target: 'worker', data: { kind: EDGE_KINDS.delegate } };
  const plan = traversalPlan(nodes, [misleading, reachable], 'lead');

  assert.deepEqual(plan.map(({ node }) => node.id), ['lead', 'worker']);
  assert.equal(plan[1].source.id, 'lead');
  assert.equal(plan[1].edge.id, 'lead-worker');
});

test('trunca conteúdo e rejeita entradas inválidas com mensagens claras', () => {
  const edge = { source: 'lead', target: 'worker', data: { kind: EDGE_KINDS.context } };
  const packet = buildContextPacket({
    source: nodes[0], target: nodes[1], edge,
    transcript: 't'.repeat(8_000),
    context: ['c'.repeat(5_000)],
  });

  assert.ok(packet.length <= 10_000);
  assert.match(packet, /conteúdo truncado pelo Korda/);
  assert.throws(() => edgeStyle('inventada'), /Tipo de corda inválido/);
  assert.throws(
    () => buildContextPacket({ source: nodes[0], target: nodes[1], edge, context: 'texto' }),
    /context deve ser um array/,
  );
  assert.throws(() => traversalOrder(nodes, [], 'ausente'), /Nó inicial não encontrado/);
});
