# Korda

Bancada desktop open source para abrir agentes e terminais locais, conectá-los por cordas e acompanhar a colaboração em um canvas visual.

[Site](https://teolfeu.github.io/korda-site/) · [Download para Linux](https://github.com/Teolfeu/korda/releases/latest) · [Issues](https://github.com/Teolfeu/korda/issues)

## Download

Baixe o AppImage Linux x86_64 na [última Release](https://github.com/Teolfeu/korda/releases/latest), torne-o executável e abra:

```bash
chmod +x Korda-0.1.1-x86_64.AppImage
./Korda-0.1.1-x86_64.AppImage
```

O Korda detecta CLIs já instaladas no computador, como Codex, OpenCode, Hermes, Grok e Claude Code. Essas ferramentas e suas assinaturas não são incluídas no aplicativo.

## Executar a partir do código

Requer Node.js 22, npm e as dependências nativas de compilação do `node-pty`.

```bash
git clone https://github.com/Teolfeu/korda.git
cd korda
npm ci
npm run app
```

O canvas abre vazio em todo lançamento, com um guia de três passos e ações para abrir uma pasta, adicionar o primeiro agente ou criar um terminal. Escolha uma pasta antes de usar PTYs reais; se ela já tiver um canvas salvo, o estado é restaurado nesse momento. Em `Agente`, selecione uma CLI detectada no computador e defina seu papel: Orquestrador, Executor, Revisor ou Pesquisador. O primeiro agente sugere o papel de Orquestrador; o papel pode ser trocado depois pelo Inspector. O canvas aceita zero ou um Orquestrador e `Iniciar missão` só fica disponível quando um deles foi definido.

`Iniciar missão` coleta objetivo, critério de conclusão e prazo. O Orquestrador lê o briefing efêmero com `korda run status`; conclui com `korda run finish "resumo"` ou falha com `korda run fail "motivo"`. Se houver Revisor no canvas, a conclusão exige `korda run approve "parecer"` desse agente. Entregar o protocolo ao terminal não encerra mais a execução: o ledger permanece em andamento até conclusão explícita, cancelamento ou timeout.

O canvas é salvo automaticamente por pasta de workspace. Posições, tamanhos, papéis, objetivos, notas, URLs do navegador e cordas voltam após recarregar ou reabrir o Korda. A lateral permite buscar e visualizar arquivos de texto da pasta; binários, arquivos grandes, symlinks e caminhos fora da raiz são recusados. O aplicativo não persiste saída de terminal, prompts, callbacks, sessão PTY nem credenciais. Por segurança, um workspace restaurado pede que a pasta seja escolhida novamente antes de reativar os processos. A prévia web sem pasta sempre recarrega vazia.

As cordas agora funcionam como permissões bidirecionais, no modelo público do Maestri. Dentro de um agente, `korda self` mostra identidade e papel; `korda list` mostra agentes e notas conectados; `korda ask "OpenCode" "revise esta mudança"` cria um pedido sem bloquear o terminal; o executor usa `korda inbox` e `korda reply`; o solicitante consulta com `korda wait ID`. `korda note read|write "Brief"` lê ou altera uma nota conectada. Sem corda, a operação é recusada. Para texto multilinha, use `--stdin`, por exemplo `printf 'linha 1\nlinha 2' | korda reply ID --stdin`.

Ao abrir ou reconectar um agente, o Korda entrega uma única instrução de presença com papel, objetivo e vizinhos atuais. Quando uma corda ou papel muda, apenas a nova topologia é reapresentada. Assim, uma tarefa normal escrita no Orquestrador já é decomposta e delegada aos Executores, Pesquisadores e Revisores conectados sem o usuário precisar citar Korda ou comandos internos. `Iniciar missão` continua separado para prazo, ledger e aprovação formal.

No Linux, a CLI usa uma fila autenticada de arquivos temporários dentro do workspace (`KORDA_SPOOL`), evitando o bloqueio de TCP/Unix sockets em agentes Codex sem permissão de rede. O diretório tem modo `0700`, os arquivos `0600` e é removido ao fechar ou trocar o workspace; TCP permanece apenas como fallback.

`Iniciar missão` não cola a transcrição inteira nos terminais. Ela acrescenta ao protocolo de presença o briefing efêmero e os comandos `korda run`; os pedidos continuam em `ask` / `inbox` / `reply` / `wait`. Quando um `korda ask` chega, o canvas atualiza o status do alvo, anima a corda correspondente e envia um lembrete de **uma linha** no PTY do alvo (texto cru + Enter), para TUIs como o Hermes não ficarem com a mensagem só no buffer esperando Enter manual — o texto do pedido permanece na caixa de entrada local, nunca é injetado no PTY. Ao remover uma corda ou encerrar a sessão, a autorização é revogada. O OpenCode inicia em `--mini --no-replay`, adequado ao terminal embutido; os demais agentes mantêm seus comandos normais.

O Hermes inicia em `--tui` com a skill exclusiva `korda-studio` pré-carregada. O app sincroniza essa skill em `${HERMES_HOME:-~/.hermes}/skills` antes de abrir o PTY, evitando conflito com skills antigas chamadas apenas `korda`. Assim ele aprende no boot a executar `self/list/inbox/reply` e que arquivos como `STATUS.md` não substituem a resposta ao Orquestrador.

Browsers ligados por corda podem ser operados pelo agente no próprio webview do canvas: `korda browser list`, `info <browser>`, `navigate <browser> <url>`, `content <browser> [--max N]` e `screenshot <browser> [arquivo.png]`. Para interagir, use `inspect <browser>` e depois `activate <browser> <id>` ou `fill <browser> <id> <texto>`; os IDs são efêmeros, não aceitam seletores arbitrários e campos sensíveis ficam bloqueados. URLs são limitadas a HTTP(S) e capturas ficam obrigatoriamente dentro do workspace aberto.

`Orquestração` abre o ledger operacional do workspace. A timeline diferencia início entregue ao Orquestrador, bloqueio por PTY ausente e simulação da prévia. O histórico mantém até 25 execuções e 200 eventos curtos; ele nunca armazena mensagens, respostas, transcrições ou o ambiente do processo.

`Estatísticas` abre a visão operacional da sessão: duração, PTYs ativos, bytes de entrada e saída, pacotes de contexto entregues, atividade local e detalhamento por agente. A telemetria é filtrada pelo workspace atual e não lê o conteúdo dos terminais. Tokens e custo aparecem como indisponíveis enquanto a CLI não fornecer esses valores de forma verificável.

Arraste de qualquer trecho da borda de um bloco até a borda de outro para criar uma corda; as portas coloridas continuam disponíveis para conexões semânticas. Auto-conexões no mesmo bloco são bloqueadas. A borda também aceita conexão por teclado pelos quatro pontos acessíveis.

Selecione um bloco e arraste qualquer alça azul para redimensionar agentes, terminais, browser, notas e grupos. Agentes abrem em `700 × 460` com terminal escuro; workspaces antigos são elevados ao mínimo legível de `560 × 380`. Para informar um tamanho exato, use Largura e Altura no Inspector. No cabeçalho de cada terminal, **parar** encerra o PTY sem remover o bloco e **reiniciar** abre uma sessão nova.

Para remover uma corda, clique diretamente nela e use o botão **Remover corda** que aparece acima do canvas. `Delete` e `Backspace` continuam disponíveis quando a corda está selecionada.

Para a prévia visual sem PTY nativo:

```bash
npm run dev -- --port 4173
```

Na prévia web os terminais são simulados: ela serve para testar o onboarding, canvas, cordas e layout, mas não executa comandos nem abre pastas locais. Para trabalhar de verdade, use sempre `npm run app`.

A árvore do workspace usa observação nativa do sistema de arquivos. Arquivos novos aparecem automaticamente após uma curta consolidação de eventos; `.git`, `node_modules`, `dist` e runtimes privados do Korda continuam ocultos. O terminal compensa o zoom do canvas ao selecionar texto, e `Shift + arraste` força seleção quando uma TUI estiver usando o mouse.

## Segurança, privacidade e licença

O Korda executa processos locais com as permissões do usuário. Revise comandos antes de executá-los e use workspaces confiáveis. Consulte [SECURITY.md](./SECURITY.md) para relatar vulnerabilidades.

O código é licenciado sob [Apache License 2.0](./LICENSE). A marca e o logotipo Korda não recebem licença de marca; dependências e fontes mantêm suas próprias licenças em [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md).

## Site

O site público [teolfeu.github.io/korda-site](https://teolfeu.github.io/korda-site/) vive no repositório separado [Teolfeu/korda-site](https://github.com/Teolfeu/korda-site) (React + Vite, publicado via branch `gh-pages`).
