# Korda — contrato do MVP

O fluxo crítico é: abrir workspace → iniciar PTYs → definir uma missão → Orquestrador delegar por cordas → Executor responder → Revisor aprovar quando configurado → Orquestrador concluir explicitamente.

## Invariantes

- Entregar texto ou protocolo ao PTY não conclui uma missão.
- Uma missão termina apenas por `korda run finish`, `fail`, cancelamento ou timeout.
- Com Revisor configurado, `finish` exige `korda run approve` desse agente.
- Pedidos usam `ask → inbox → reply → wait`; o corpo não é colado em outros PTYs.
- Snapshots e ledger guardam somente metadados curtos, nunca objetivo, critérios, prompts, respostas ou transcrições completas.
- Agentes fora da missão não podem consultar seu briefing.
- Fechar o Orquestrador, trocar workspace ou remover uma autorização não pode produzir sucesso falso.

## Gate automatizado

`npm test` deve provar o ciclo hands-free com agente falso e o fluxo missão → resposta → revisão → conclusão. `npm run build` e um smoke no Electron real completam o gate.
