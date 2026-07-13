import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Brain,
  CaretDown,
  ChartLineUp,
  CirclesFour,
  Database,
  FileCode,
  FolderOpen,
  Globe,
  Play,
  Plus,
  Question,
  Robot,
  ShareNetwork,
  SidebarSimple,
  SlidersHorizontal,
  TerminalWindow,
  TreeStructure,
  X,
} from "@phosphor-icons/react";
import {
  addEdge,
  Background,
  BackgroundVariant,
  ConnectionMode,
  ControlButton,
  Controls,
  ReactFlow,
  useEdgesState,
  useNodesState,
  useReactFlow,
} from "@xyflow/react";
import "@fontsource/inter/400.css";
import "@fontsource/inter/500.css";
import "@fontsource/inter/600.css";
import "@fontsource/jetbrains-mono/400.css";
import "@xyflow/react/dist/style.css";
import { edgeStyle } from "./orchestration.js";
import { inferEdgeKind } from "./gravity-edge.js";
import { buildNodeHandles } from "./canvas-handles.js";
import { findCanvasPosition } from "./canvas-placement.js";
import { GravityEdge } from "./components/GravityEdge.jsx";
import { AgentNode, BrowserNode, FileNode, NoteNode } from "./components/WorkbenchNodes.jsx";
import { CanvasToolbar } from "./components/CanvasToolbar.jsx";
import { QuickStartDialog } from "./components/QuickStartDialog.jsx";
import { MissionDialog } from "./components/MissionDialog.jsx";
import { MetricsView } from "./components/MetricsView.jsx";
import { OrchestrationView } from "./components/OrchestrationView.jsx";
import { OnboardingGuide } from "./components/OnboardingGuide.jsx";
import { WorkbenchDeck, WorkspaceExplorer } from "./components/WorkspaceWorkbench.jsx";
import {
  appendExecutionEvent,
  finishExecutionRun,
  readExecutionLedger,
  saveExecutionLedger,
  startExecutionRun,
} from "./execution-ledger.js";
import { readLocalActivity, recordLocalRun, saveLocalActivity } from "./session-metrics.js";
import { submitTerminalText } from "./terminal-input.js";
import { agentInputStrategy, shouldAutoSeedAgent } from "./agent-input-strategy.js";
import { agentTopologySnapshot } from "./agent-topology.js";
import { clearNodeActivities, edgeActivity, pruneEdgeActivities, updateEdgeActivities } from "./edge-activity.js";
import { createTerminalLifecycle, transitionTerminalLifecycle } from "./terminal-lifecycle.js";
import { readWorkspaceState, saveWorkspaceState, workspaceScopeId } from "./workspace-state.js";
import { markOnboardingSeen, shouldShowOnboarding } from "./onboarding-state.js";
import "./brand-polish.css";

const nodeTypes = { agent: AgentNode, browser: BrowserNode, file: FileNode, note: NoteNode };
const edgeTypes = { gravity: GravityEdge };
const colors = { delegate: "#e87824", validate: "#23965b", browser: "#158fa3", context: "#2868d8" };
const startsCompact = window.innerWidth < 1200;
const roleOrder = ["orchestrator", "executor", "reviewer", "researcher"];
const roles = {
  orchestrator: { label: "Orquestrador", accent: "#1677ff", objective: "Planejar, delegar e consolidar o trabalho" },
  executor: { label: "Executor", accent: colors.delegate, objective: "Executar a tarefa recebida e devolver evidências" },
  reviewer: { label: "Revisor", accent: colors.validate, objective: "Revisar o resultado e validar apenas o que estiver correto" },
  researcher: { label: "Pesquisador", accent: colors.browser, objective: "Pesquisar fontes e compartilhar evidências verificáveis" },
};
const simulatedAgents = [
  { id: "codex-demo", name: "Codex (simulado)", command: "codex", simulated: true },
  { id: "claude-demo", name: "Claude Code (simulado)", command: "claude", simulated: true },
  { id: "opencode-demo", name: "OpenCode (simulado)", command: "opencode", simulated: true },
];
const nodeSizes = {
  agent: { width: 700, height: 460, minWidth: 560, minHeight: 380 },
  browser: { width: 470, height: 321, minWidth: 340, minHeight: 260 },
  note: { width: 300, height: 180, minWidth: 240, minHeight: 150 },
  file: { width: 190, height: 88, minWidth: 160, minHeight: 80 },
};

function agentData(data, role) {
  const config = roles[role];
  return {
    ...data,
    role,
    title: data.title || `${data.agentName} · ${config.label}`,
    roleLabel: config.label,
    accent: config.accent,
    objective: config.objective,
  };
}

function styledEdge(id, source, target, kind, sourceHandle) {
  const config = edgeStyle(kind);
  return { id, source, target, sourceHandle, targetHandle: "input", type: "gravity", label: config.label, data: { kind }, style: { stroke: config.color, strokeWidth: 2.5 } };
}

function pasteIntoTerminal(sessionId, text, options = {}) {
  if (!sessionId || !window.kordaDesktop?.writeTerminal) return false;
  return submitTerminalText(sessionId, (data) => window.kordaDesktop.writeTerminal(sessionId, data), text, options);
}

function orchestratorProtocol(node) {
  return [
    "[Korda · modo Orquestrador]",
    `Você é ${node.data.agentName || node.data.title}. Papel: Orquestrador.`,
    node.data.objective || "Planeje, delegue e consolide o trabalho.",
    "Leia a missão atual com `korda run status`. O objetivo completo fica no coordenador local e não no histórico do terminal.",
    "As cordas são conexões bidirecionais. Execute `korda list` para ver agentes e notas conectados.",
    "Delegue sem bloquear com `korda ask \"Nome do agente\" \"tarefa\"`. O executor lê com `korda inbox` e responde com `korda reply`.",
    "Consulte a resposta com `korda wait PEDIDO`. Leia notas com `korda note read \"Nome\"`.",
    "Controle browsers conectados com `korda browser list` e `korda browser navigate|info|content|screenshot`.",
    "Se houver Revisor, peça a validação e aguarde `korda run approve`. Quando tudo estiver realmente pronto, encerre com `korda run finish \"resumo curto\"`. Se não puder concluir, use `korda run fail \"motivo\"`.",
    "Comece executando `korda run status`, liste suas conexões e distribua o trabalho necessário.",
  ].join("\n\n");
}

function workerProtocol(node) {
  const roleLabel = roles[node.data.role]?.label || "Agente";
  return [
    `[Korda · modo ${roleLabel}]`,
    `Você é ${node.data.agentName || node.data.title}. Papel: ${roleLabel}.`,
    node.data.objective || "Execute a tarefa recebida e devolva evidências.",
    "As cordas são conexões bidirecionais. Execute `korda self` e `korda list` para ver com quem você está conectado (ex.: o Orquestrador).",
    "Quando o status do canvas mostrar pedido recebido, leia com `korda inbox`.",
    "Execute a tarefa e responda com `korda reply PEDIDO \"sua resposta\"`. Texto multilinha: `printf '...' | korda reply PEDIDO --stdin`.",
    "Não espere que a mensagem chegue colada no terminal — a caixa de entrada é o `korda inbox`.",
    "Se houver browser conectado, opere o webview visível com `korda browser list` e os subcomandos disponíveis.",
    ...(node.data.role === "reviewer" ? ["Depois de revisar as evidências, aprove somente com `korda run approve \"parecer curto\"`."] : []),
    "Comece com `korda list` e fique atento a novos pedidos em `korda inbox`.",
  ].join("\n\n");
}

function requestNudge(sourceName) {
  // One line so Hermes/Grok TUIs submit with a single raw Enter (no multi-line paste lag).
  return `Pedido de ${sourceName || "outro agente"} na inbox. Rode agora: korda inbox; execute a tarefa; responda com korda reply PEDIDO "resposta".`;
}

function restoreCanvasNodes(source, cwd) {
  let orchestratorSeen = false;
  let firstAgentIndex = -1;
  const nodes = source.map((node, index) => {
    let data = { ...node.data };
    if (data.role && firstAgentIndex < 0) firstAgentIndex = index;
    if (data.role === "orchestrator") {
      if (orchestratorSeen) data = agentData(data, "executor");
      else orchestratorSeen = true;
    }
    if (data.terminal) {
      data = {
        ...data,
        cwd: cwd || undefined,
        status: "Pronto",
        statusTone: "ready",
        output: cwd ? `Pronto para iniciar ${data.command || "terminal"}` : "Canvas restaurado — reabra a pasta para ativar o PTY",
      };
    }
    return { ...node, selected: false, data };
  });
  if (!orchestratorSeen && firstAgentIndex >= 0) {
    const node = nodes[firstAgentIndex];
    nodes[firstAgentIndex] = { ...node, data: agentData(node.data, "orchestrator") };
  }
  const selectedId = nodes.find((node) => node.data.role === "orchestrator")?.id || nodes[0]?.id || null;
  return nodes.map((node) => ({ ...node, selected: node.id === selectedId }));
}

function readStartupCanvas() {
  return { nodes: [], edges: [], restored: false, selectedId: null, workspace: { name: "Sem workspace", root: null, tree: [] } };
}

function EmptyCanvas({ onOpenWorkspace, onAddAgent, onAddTerminal, onOpenGuide }) {
  return <section className="empty-canvas" aria-labelledby="empty-canvas-title"><span className="empty-kicker">SEU WORKSPACE VISUAL</span><span className="empty-icon" aria-hidden="true"><ShareNetwork size={28} weight="duotone" /></span><h1 id="empty-canvas-title">Monte seu primeiro fluxo</h1><p>Abra um projeto, escolha agentes locais e conecte quem pode trocar pedidos e respostas. Nada é enviado automaticamente.</p><div className="empty-actions"><button type="button" className="empty-primary" onClick={onOpenWorkspace}><FolderOpen size={17} />Abrir pasta</button><button type="button" onClick={onAddAgent}><Robot size={17} />Adicionar agente</button><button type="button" onClick={onAddTerminal}><TerminalWindow size={17} />Novo terminal</button></div><ol className="empty-steps" aria-label="Como começar"><li className="empty-step"><b>1. Abra uma pasta</b><span>Escolha o projeto local que dará contexto ao trabalho.</span></li><li className="empty-step"><b>2. Adicione um agente</b><span>Selecione uma CLI instalada e defina seu papel no fluxo.</span></li><li className="empty-step"><b>3. Conecte e trabalhe</b><span>Digite uma tarefa normal no Orquestrador; missão formal é opcional.</span></li></ol><button type="button" className="empty-guide-button" onClick={onOpenGuide}><Question size={15} />Ver guia de 1 minuto</button></section>;
}

function Rail({ active, onSelect, onHelp }) {
  const items = [[CirclesFour, "Canvas"], [TerminalWindow, "Terminais"], [Robot, "Agentes"], [Globe, "Navegador"], [FileCode, "Arquivos"], [Database, "Contexto"], [TreeStructure, "Orquestração"], [ChartLineUp, "Estatísticas"]];
  return <nav className="rail" aria-label="Ferramentas">{items.map(([Icon, label]) => <button key={label} className={active === label ? "active" : ""} onClick={() => onSelect(label)} title={label} aria-label={label}><Icon size={20} /></button>)}<span /><button onClick={onHelp} title="Ajuda e primeiros passos" aria-label="Ajuda e primeiros passos"><Question size={20} /></button><button className={active === "Configurações" ? "active" : ""} onClick={() => onSelect("Configurações")} title="Configurações" aria-label="Configurações"><SlidersHorizontal size={20} /></button></nav>;
}

function CanvasControls() {
  const { fitView } = useReactFlow();
  return <Controls showFitView={false} showInteractive={false}><ControlButton onClick={() => void fitView({ includeHiddenNodes: true, padding: { top: "6%", right: "8%", bottom: "110px", left: "8%" }, minZoom: 0.65, duration: 180 })} title="Enquadrar canvas" aria-label="Fit View"><CirclesFour size={14} /></ControlButton></Controls>;
}

function SizeInput({ nodeId, label, value, min, onChange }) {
  const [draft, setDraft] = useState(String(value));
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    if (!focused) setDraft(String(value));
  }, [focused, nodeId, value]);
  return <label>{label}<input type="number" min={min} step="10" value={draft} onFocus={() => setFocused(true)} onBlur={() => setFocused(false)} onChange={(event) => {
    setDraft(event.target.value);
    if (event.target.value !== "") onChange(event.target.value);
  }} onKeyDown={(event) => event.key === "Enter" && event.currentTarget.blur()} /></label>;
}

function Inspector({ node, onClose, onChange, onRoleChange, onResize, onRemove }) {
  if (!node) return <aside className="inspector empty"><header><b>Inspector</b><button onClick={onClose}><X size={16} /></button></header><p>Selecione um nó para inspecionar.</p></aside>;
  const data = node.data;
  const size = nodeSizes[node.type] || nodeSizes.agent;
  const width = Math.round(Number(node.style?.width) || size.width);
  const height = Math.round(Number(node.style?.height) || size.height);
  const typeLabel = node.type === "browser" ? "Browser" : node.type === "file" ? "Arquivo" : node.type === "note" ? data.variant === "text" ? "Texto" : "Nota" : data.role ? "Agente CLI" : "Terminal";
  return <aside className="inspector">
    <header><b>Inspector</b><button onClick={onClose} aria-label="Fechar inspector"><X size={16} /></button></header>
    <div className="inspector-title"><Brain size={18} weight="duotone" /><b>{data.title}</b></div>
    <section><h4>Geral</h4><dl><dt>ID</dt><dd>{node.id}</dd><dt>Tipo</dt><dd>{typeLabel}</dd>{data.agentName && <><dt>CLI</dt><dd>{data.agentName}</dd></>}<dt>Estado</dt><dd><i className="live-dot" />{data.status || "Conectado"}</dd></dl></section>
    <section className="node-size-section"><h4>Tamanho no canvas</h4><div className="size-controls"><SizeInput nodeId={node.id} label="Largura (px)" value={width} min={size.minWidth} onChange={(value) => onResize("width", value)} /><SizeInput nodeId={node.id} label="Altura (px)" value={height} min={size.minHeight} onChange={(value) => onResize("height", value)} /></div></section>
    {data.role && <section><h4>Papel do agente</h4><label className="role-picker"><span>Papel</span><select value={data.role} onChange={(event) => onRoleChange(event.target.value)}>{roleOrder.map((role) => <option key={role} value={role}>{roles[role].label}</option>)}</select></label></section>}
    {data.objective && <section><h4>Objetivo</h4><textarea value={data.objective} onChange={(event) => onChange({ objective: event.target.value })} /></section>}
    {data.role && <section><h4>Telemetria</h4><dl><dt>Tokens</dt><dd>Indisponível</dd><dt>Custo</dt><dd>Indisponível</dd><dt>Fonte</dt><dd>CLI local</dd></dl></section>}
    <button className="danger-button" onClick={() => onRemove(node.id)}>Remover do canvas</button>
  </aside>;
}

export function App() {
  const startup = useMemo(readStartupCanvas, []);
  const [nodes, setNodes, onNodesChange] = useNodesState(startup.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(startup.edges);
  const [selectedEdgeId, setSelectedEdgeId] = useState(null);
  const [drawerOpen, setDrawerOpen] = useState(!startsCompact);
  const [inspectorOpen, setInspectorOpen] = useState(!startsCompact && Boolean(startup.selectedId));
  const [selectedId, setSelectedId] = useState(startup.selectedId);
  const [workspace, setWorkspace] = useState(startup.workspace);
  const [workspaceReady, setWorkspaceReady] = useState(false);
  const [workspaceWatchError, setWorkspaceWatchError] = useState("");
  const [explorerWidth, setExplorerWidth] = useState(() => {
    const saved = Number(window.localStorage?.getItem("korda-explorer-width"));
    const maximum = Math.max(220, Math.min(560, window.innerWidth * .45));
    return Number.isFinite(saved) && saved >= 220 ? Math.min(maximum, saved) : 280;
  });
  const [openDocuments, setOpenDocuments] = useState([]);
  const [activeView, setActiveView] = useState("canvas");
  const [running, setRunning] = useState(false);
  const [edgeActivities, setEdgeActivities] = useState([]);
  const [activeTool, setActiveTool] = useState("Canvas");
  const [statsOpen, setStatsOpen] = useState(false);
  const [orchestrationOpen, setOrchestrationOpen] = useState(false);
  const [executionLedger, setExecutionLedger] = useState(() => readExecutionLedger());
  const [sessionRevision, setSessionRevision] = useState(0);
  const [localActivity, setLocalActivity] = useState(() => readLocalActivity());
  const [agentDialogOpen, setAgentDialogOpen] = useState(false);
  const [missionDialogOpen, setMissionDialogOpen] = useState(false);
  const [missionError, setMissionError] = useState("");
  const [missionSnapshot, setMissionSnapshot] = useState(null);
  const [onboardingOpen, setOnboardingOpen] = useState(() => shouldShowOnboarding());
  const [availableAgents, setAvailableAgents] = useState([]);
  const [agentsLoading, setAgentsLoading] = useState(false);
  const [agentError, setAgentError] = useState("");
  const [agentPreview, setAgentPreview] = useState(false);
  const [selectedAgentId, setSelectedAgentId] = useState("");
  const [selectedRole, setSelectedRole] = useState("executor");
  const [launchMode, setLaunchMode] = useState("agent");
  const [launchTitle, setLaunchTitle] = useState("");
  const [launchCommand, setLaunchCommand] = useState("");
  const [canvasTool, setCanvasTool] = useState("select");
  const [runtimeNotice, setRuntimeNotice] = useState(window.kordaDesktop?.isDesktop
    ? startup.restored ? `Canvas de ${startup.workspace.name} restaurado — reabra a pasta para ativar os PTYs` : "Abra uma pasta para ativar os terminais"
    : "Prévia web — terminais simulados; use npm run app para PTY real");
  const counter = useRef(0);
  const terminalSessions = useRef(new Map());
  const terminalReadyAt = useRef(new Map());
  const topologySignatures = useRef(new Map());
  const topologyTimers = useRef(new Map());
  const topologySyncRevision = useRef(0);
  const replyTimers = useRef(new Map());
  const activeRunId = useRef(null);
  const previousMissionState = useRef(null);
  const selected = nodes.find((node) => node.id === selectedId);
  const sessionBindings = useMemo(() => Object.fromEntries(terminalSessions.current), [sessionRevision]);
  const activeWorkspaceId = useMemo(() => workspaceScopeId(workspace), [workspace.name, workspace.root]);
  const commitLedger = useCallback((change) => setExecutionLedger(change), []);
  const appendMissionEvent = useCallback((event) => {
    const runId = activeRunId.current;
    if (!runId) return;
    setExecutionLedger((current) => {
      try { return appendExecutionEvent(current, runId, event); } catch { return current; }
    });
  }, []);

  useEffect(() => {
    if (!workspace.root) return undefined;
    const timer = window.setTimeout(() => {
      saveWorkspaceState(workspace, { nodes, edges });
    }, 250);
    return () => window.clearTimeout(timer);
  }, [edges, nodes, workspace.name, workspace.root]);

  useEffect(() => {
    window.localStorage?.setItem("korda-explorer-width", String(explorerWidth));
  }, [explorerWidth]);

  useEffect(() => {
    if (!openDocuments.some((document) => document.content !== document.savedContent)) return undefined;
    const preventUnsavedClose = (event) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", preventUnsavedClose);
    return () => window.removeEventListener("beforeunload", preventUnsavedClose);
  }, [openDocuments]);

  useEffect(() => {
    if (nodes.length > 0) return;
    setSelectedId(null);
    setInspectorOpen(false);
  }, [nodes.length]);

  useEffect(() => saveExecutionLedger(executionLedger), [executionLedger]);

  useEffect(() => {
    const api = window.kordaDesktop;
    if (!api?.syncContext) return;
    const contextNodes = nodes.map((node) => ({
      id: node.id,
      type: node.type,
      title: node.data.title,
      agentName: node.data.agentName,
      role: node.data.role,
      objective: node.data.objective,
      content: node.type === "note" ? node.data.text || "" : undefined,
      url: node.type === "browser" ? node.data.url || "" : undefined,
    }));
    const contextEdges = edges.map((edge) => ({ source: edge.source, target: edge.target, kind: edge.data?.kind || "context" }));
    const revision = ++topologySyncRevision.current;
    void api.syncContext({ nodes: contextNodes, edges: contextEdges }).then(() => {
      if (revision !== topologySyncRevision.current) return;
      for (const node of nodes) {
        const sessionId = terminalSessions.current.get(node.id);
        if (!sessionId || !node.data.role) continue;
        let snapshot;
        try { snapshot = agentTopologySnapshot({ nodeId: node.id, sessionId, nodes, edges }); }
        catch { continue; }
        if (topologySignatures.current.get(node.id) === snapshot.signature) continue;
        // OpenCode treats any text submitted to its TUI as a paid user turn. Its topology
        // remains available through the broker (`korda self/list`) and must not auto-run a model.
        if (!shouldAutoSeedAgent(node.data.agentId || node.data.kind)) {
          topologySignatures.current.set(node.id, snapshot.signature);
          continue;
        }
        const oldTimer = topologyTimers.current.get(node.id);
        if (oldTimer) window.clearTimeout(oldTimer);
        topologySignatures.current.set(node.id, snapshot.signature);
        const strategy = agentInputStrategy(node.data.agentId);
        const readyAge = Date.now() - (terminalReadyAt.current.get(node.id) || 0);
        const delay = Math.max(120, strategy.startupDelayMs - readyAge);
        topologyTimers.current.set(node.id, window.setTimeout(() => {
          topologyTimers.current.delete(node.id);
          if (terminalSessions.current.get(node.id) !== sessionId || topologySignatures.current.get(node.id) !== snapshot.signature) return;
          void pasteIntoTerminal(sessionId, snapshot.protocol, strategy).then((delivered) => {
            if (!delivered && topologySignatures.current.get(node.id) === snapshot.signature) topologySignatures.current.delete(node.id);
          });
        }, delay));
      }
    }).catch((error) => setRuntimeNotice(`Contexto Korda indisponível: ${error.message}`));
  }, [edges, nodes, sessionRevision]);

  useEffect(() => window.kordaDesktop?.onWorkspaceUpdate?.((payload) => {
    if (!payload?.root || payload.root !== workspace.root) return;
    if (payload.error) {
      setWorkspaceWatchError(payload.error);
      return;
    }
    setWorkspaceWatchError("");
    setWorkspace((current) => ({ ...current, name: payload.name || current.name, tree: Array.isArray(payload.tree) ? payload.tree : current.tree, truncated: Boolean(payload.truncated) }));
  }), [workspace.root]);

  useEffect(() => () => {
    for (const timer of replyTimers.current.values()) window.clearTimeout(timer);
    for (const timer of topologyTimers.current.values()) window.clearTimeout(timer);
    replyTimers.current.clear();
    topologyTimers.current.clear();
  }, []);

  useEffect(() => {
    setEdgeActivities((current) => {
      const next = pruneEdgeActivities(current, edges);
      return next.length === current.length ? current : next;
    });
  }, [edges]);

  useEffect(() => window.kordaDesktop?.onContextNote?.(({ id, text }) => {
    setNodes((current) => current.map((node) => node.id === id && node.type === "note"
      ? { ...node, data: { ...node.data, text } }
      : node));
  }), [setNodes]);

  useEffect(() => {
    const stopRequest = window.kordaDesktop?.onContextRequest?.(({ id, sourceId, targetId, sourceName }) => {
      const oldTimer = replyTimers.current.get(id);
      if (oldTimer) window.clearTimeout(oldTimer);
      replyTimers.current.delete(id);
      setEdgeActivities((current) => updateEdgeActivities(current, { type: "request", id, sourceId, targetId }));
      setNodes((current) => current.map((node) => node.id === targetId
        ? { ...node, data: { ...node.data, activity: `Pedido de ${sourceName} — execute korda inbox`, status: "Pedido recebido", statusTone: "waiting" } }
        : node));
      // Nudge only: never paste the ask body into the PTY (content stays in korda inbox).
      // Raw single-line + Enter so Hermes does not wait for a manual Enter.
      const sessionId = terminalSessions.current.get(targetId);
      const target = nodes.find((node) => node.id === targetId);
      if (sessionId) void pasteIntoTerminal(sessionId, requestNudge(sourceName), { mode: "raw", ...agentInputStrategy(target?.data.agentId) });
      appendMissionEvent({ nodeId: targetId, sourceId, targetId, result: "delivered", message: `Pedido entregue a ${targetId}` });
    });
    const stopReply = window.kordaDesktop?.onContextReply?.(({ id, sourceId, targetId }) => {
      setEdgeActivities((current) => updateEdgeActivities(current, { type: "reply", id, sourceId, targetId }));
      const oldTimer = replyTimers.current.get(id);
      if (oldTimer) window.clearTimeout(oldTimer);
      replyTimers.current.set(id, window.setTimeout(() => {
        setEdgeActivities((current) => updateEdgeActivities(current, { type: "remove", id, sourceId, targetId }));
        replyTimers.current.delete(id);
      }, 700));
      setNodes((current) => current.map((node) => node.id === sourceId
        ? { ...node, data: { ...node.data, activity: "Resposta pronta — execute korda wait ID", status: "Resposta pronta", statusTone: "ready" } }
        : node));
      appendMissionEvent({ nodeId: targetId, sourceId: targetId, targetId: sourceId, result: "delivered", message: `Resposta devolvida a ${sourceId}` });
    });
    return () => { stopRequest?.(); stopReply?.(); };
  }, [appendMissionEvent, nodes, setNodes]);

  useEffect(() => window.kordaDesktop?.onMissionUpdate?.((snapshot) => {
    setMissionSnapshot(snapshot);
    const active = ["preparing", "running", "reviewing"].includes(snapshot?.state);
    setRunning(active);
    setNodes((current) => current.map((node) => {
      if (!node.data.role) return node;
      if (!active) return { ...node, data: { ...node.data, activity: snapshot?.finalMessage || node.data.activity } };
      if (!terminalSessions.current.has(node.id)) return node;
      const reviewing = snapshot.state === "reviewing" && node.id === snapshot.reviewerId;
      return { ...node, data: { ...node.data, status: reviewing ? "Revisando" : node.id === snapshot.orchestratorId ? "Orquestrando" : "Em missão", statusTone: "running" } };
    }));
    if (!snapshot?.id || previousMissionState.current === snapshot.state) return;
    previousMissionState.current = snapshot.state;
    if (snapshot.state === "reviewing") appendMissionEvent({ nodeId: snapshot.reviewerId, result: "delivered", message: "Revisão aprovada" });
    if (!["completed", "failed", "cancelled", "timed_out"].includes(snapshot.state)) return;
    const runId = activeRunId.current;
    if (runId) {
      setExecutionLedger((current) => {
        try { return finishExecutionRun(current, runId, snapshot.state === "completed" ? "completed" : "failed", snapshot.state === "completed" ? "Missão concluída" : `Missão encerrada: ${snapshot.state}`); }
        catch { return current; }
      });
    }
    activeRunId.current = null;
    setRuntimeNotice(snapshot.finalMessage || (snapshot.state === "completed" ? "Missão concluída." : "Missão encerrada."));
  }), [appendMissionEvent, setNodes]);

  const onNodeDataChange = useCallback((nodeId, patch) => {
    if (!patch || typeof patch !== "object") return;
    setNodes((current) => current.map((node) => node.id === nodeId
      ? { ...node, data: { ...node.data, ...patch } }
      : node));
  }, [setNodes]);

  const removeNode = useCallback((id) => {
    if (running) {
      setRuntimeNotice("Aguarde a execução terminar antes de remover um bloco.");
      return;
    }
    terminalSessions.current.delete(id);
    terminalReadyAt.current.delete(id);
    topologySignatures.current.delete(id);
    const topologyTimer = topologyTimers.current.get(id);
    if (topologyTimer) window.clearTimeout(topologyTimer);
    topologyTimers.current.delete(id);
    setEdgeActivities((current) => clearNodeActivities(current, id));
    setSessionRevision((value) => value + 1);
    setNodes((current) => current.filter((node) => node.id !== id));
    setEdges((current) => current.filter((edge) => edge.source !== id && edge.target !== id));
    setSelectedId((current) => current === id ? null : current);
  }, [running, setEdges, setNodes]);

  const beforeDelete = useCallback(async () => {
    if (running) {
      setRuntimeNotice("Aguarde a execução terminar antes de remover um bloco.");
      return false;
    }
    return true;
  }, [running]);

  const removeSelectedEdge = useCallback(() => {
    if (!selectedEdgeId) return;
    if (running) {
      setRuntimeNotice("Aguarde a execução terminar antes de remover uma corda.");
      return;
    }
    setEdges((current) => current.filter((edge) => edge.id !== selectedEdgeId));
    setSelectedEdgeId(null);
  }, [running, selectedEdgeId, setEdges]);

  const removeEdge = useCallback((id) => {
    if (running) {
      setRuntimeNotice("Aguarde a execução terminar antes de remover uma corda.");
      return;
    }
    setEdges((current) => current.filter((edge) => edge.id !== id));
    setSelectedEdgeId((current) => current === id ? null : current);
  }, [running, setEdges]);

  const selectEdge = useCallback((id) => {
    setSelectedEdgeId(id);
    setSelectedId(null);
  }, []);

  const onTerminalSession = useCallback((nodeId, sessionId, detail) => {
    const previous = terminalSessions.current.get(nodeId);
    if (sessionId) {
      terminalSessions.current.set(nodeId, sessionId);
      terminalReadyAt.current.set(nodeId, Date.now());
    }
    else {
      terminalSessions.current.delete(nodeId);
      terminalReadyAt.current.delete(nodeId);
      topologySignatures.current.delete(nodeId);
      const topologyTimer = topologyTimers.current.get(nodeId);
      if (topologyTimer) window.clearTimeout(topologyTimer);
      topologyTimers.current.delete(nodeId);
      if (detail?.phase === "exit" || detail?.phase === "failed" || detail?.phase === "stopped") setEdgeActivities((current) => clearNodeActivities(current, nodeId));
    }
    if (previous !== sessionId) setSessionRevision((value) => value + 1);
    setNodes((current) => current.map((node) => {
      if (node.id !== nodeId) return node;
      let lifecycle = node.data.terminalLifecycle || createTerminalLifecycle();
      try {
        if (detail?.phase === "starting") lifecycle = transitionTerminalLifecycle(lifecycle, { type: "start" });
        else if (detail?.phase === "ready") lifecycle = transitionTerminalLifecycle(lifecycle, { type: "ready" });
        else if (detail?.phase === "exit" || detail?.phase === "failed") lifecycle = transitionTerminalLifecycle(lifecycle, { type: "exit", exitCode: detail?.exitCode });
      } catch { /* eventos atrasados de um PTY substituído não mudam o ciclo atual */ }
      if (sessionId) return { ...node, data: { ...node.data, terminalLifecycle: lifecycle, status: "PTY ativo", statusTone: "running", activity: "Processo local conectado" } };
      if (detail?.phase === "starting" || detail?.phase === "restarting") return { ...node, data: { ...node.data, terminalLifecycle: lifecycle, status: detail.phase === "restarting" ? "Reiniciando" : "Iniciando", statusTone: "waiting" } };
      if (detail?.phase === "stopped") return { ...node, data: { ...node.data, status: "Parado", statusTone: "idle", activity: "Processo parado pelo usuário" } };
      if (detail?.phase === "exit" || detail?.phase === "failed") return { ...node, data: { ...node.data, terminalLifecycle: lifecycle, status: lifecycle.status === "exited" ? "Encerrado" : "Falhou", statusTone: lifecycle.status === "exited" ? "idle" : "waiting", activity: detail?.reason === "blank-output" ? "A CLI abriu sem produzir uma tela legível" : detail?.exitCode == null ? "Processo encerrou sem código de saída" : `Processo encerrou com código ${detail.exitCode}` } };
      return node;
    }));
  }, [setNodes]);

  const restartTerminal = useCallback((nodeId) => {
    setNodes((current) => current.map((node) => {
      if (node.id !== nodeId || !node.data.terminal) return node;
      const fallback = terminalSessions.current.has(nodeId)
        ? Object.freeze({ status: "running", generation: 0, exitCode: null })
        : Object.freeze({ status: "exited", generation: 0, exitCode: 0 });
      let lifecycle;
      try { lifecycle = transitionTerminalLifecycle(node.data.terminalLifecycle || fallback, { type: "restart" }); }
      catch { return node; }
      return { ...node, data: { ...node.data, terminalEnabled: true, terminalLifecycle: lifecycle, status: "Reiniciando", statusTone: "waiting", activity: "Reabrindo processo local" } };
    }));
  }, [setNodes]);

  const stopTerminal = useCallback((nodeId) => {
    setNodes((current) => current.map((node) => {
      if (node.id !== nodeId || !node.data.terminal) return node;
      const fallback = terminalSessions.current.has(nodeId)
        ? Object.freeze({ status: "running", generation: 0, exitCode: null })
        : createTerminalLifecycle();
      let lifecycle = node.data.terminalLifecycle || fallback;
      try { lifecycle = transitionTerminalLifecycle(lifecycle, { type: "exit", exitCode: 0 }); } catch { /* já está parado */ }
      return { ...node, data: { ...node.data, terminalEnabled: false, terminalLifecycle: lifecycle, status: "Parando", statusTone: "waiting" } };
    }));
  }, [setNodes]);

  const closeAgentDialog = useCallback(() => setAgentDialogOpen(false), []);
  const dismissOnboarding = useCallback(() => {
    markOnboardingSeen();
    setOnboardingOpen(false);
  }, []);

  const openAgentDialog = useCallback(async (mode = "agent") => {
    const api = window.kordaDesktop;
    setLaunchMode(mode);
    setLaunchTitle(mode === "terminal" ? "Terminal" : "Novo agente");
    setLaunchCommand(mode === "terminal" ? (api?.defaultShell || "") : "");
    setAgentDialogOpen(true);
    setAgentError("");
    setSelectedRole(nodes.some((node) => node.data.role === "orchestrator") ? "executor" : "orchestrator");
    if (!api?.isDesktop) {
      setAgentPreview(true);
      setAvailableAgents(simulatedAgents);
      setSelectedAgentId(mode === "terminal" ? "shell" : simulatedAgents[0].id);
      setLaunchCommand(mode === "terminal" ? "" : simulatedAgents[0].command);
      setAgentsLoading(false);
      return;
    }
    setAgentPreview(false);
    setAvailableAgents([]);
    setSelectedAgentId("");
    setAgentsLoading(true);
    try {
      const result = await api.listAgents();
      const installed = Array.isArray(result) ? result.filter((agent) => agent && typeof agent.id === "string" && typeof agent.name === "string" && typeof agent.command === "string") : [];
      setAvailableAgents(installed);
      setSelectedAgentId(mode === "terminal" ? "shell" : installed[0]?.id || "");
      setLaunchCommand(mode === "terminal" ? "" : installed[0]?.command || "");
      if (mode === "agent" && !installed.length) setAgentError("Nenhuma CLI compatível foi encontrada no PATH do aplicativo.");
    } catch (error) {
      setAgentError(`Não foi possível listar as CLIs: ${error.message}`);
    } finally {
      setAgentsLoading(false);
    }
  }, [nodes]);

  const changeAgentRole = useCallback((nodeId, nextRole) => {
    if (running) {
      setRuntimeNotice("Aguarde a missão terminar antes de alterar papéis.");
      return;
    }
    if (!roles[nextRole]) return;
    const target = nodes.find((node) => node.id === nodeId && node.data.role);
    if (!target || target.data.role === nextRole) return;
    const oldOrchestrator = nodes.find((node) => node.data.role === "orchestrator");
    let swap = null;
    if (nextRole === "orchestrator") swap = oldOrchestrator;
    else if (target.data.role === "orchestrator") swap = nodes.find((node) => node.id !== nodeId && node.data.role === nextRole) || nodes.find((node) => node.id !== nodeId && node.data.role);
    const targetPreviousRole = target.data.role;
    setNodes((current) => current.map((node) => {
      if (node.id === target.id) return { ...node, data: agentData(node.data, nextRole) };
      if (node.id === swap?.id) return { ...node, data: agentData(node.data, targetPreviousRole === "orchestrator" ? "orchestrator" : targetPreviousRole) };
      return node;
    }));
    const newOrchestratorId = nextRole === "orchestrator" ? target.id : targetPreviousRole === "orchestrator" ? swap?.id : oldOrchestrator?.id;
    if (oldOrchestrator && newOrchestratorId && newOrchestratorId !== oldOrchestrator.id) {
      setEdges((current) => current.map((edge) => edge.source === oldOrchestrator.id ? { ...edge, source: newOrchestratorId } : edge).filter((edge) => edge.source !== edge.target));
      setRuntimeNotice(`${nodes.find((node) => node.id === newOrchestratorId)?.data.agentName || "Agente"} agora orquestra o fluxo.`);
    } else if (targetPreviousRole === "orchestrator" && !newOrchestratorId) {
      setRuntimeNotice("O fluxo ficou sem Orquestrador. Defina outro agente antes de executar.");
    }
  }, [nodes, running, setEdges, setNodes]);

  const renderedNodes = useMemo(() => nodes.map((node) => {
    const size = nodeSizes[node.type] || nodeSizes.agent;
    const width = Number(node.width) || Number(node.style?.width) || size.width;
    const height = Number(node.height) || Number(node.style?.height) || size.height;
    return {
      ...node,
      initialWidth: width,
      initialHeight: height,
      handles: buildNodeHandles({ type: node.type, width, height, ports: [] }),
      data: { ...node.data, onRemove: removeNode, onRestart: restartTerminal, onStop: stopTerminal, onTerminalSession, onDataChange: onNodeDataChange },
    };
  }), [nodes, onNodeDataChange, onTerminalSession, removeNode, restartTerminal, stopTerminal]);

  const renderedEdges = useMemo(() => edges.map((edge) => ({
    ...edge,
    type: "gravity",
    data: { ...edge.data, onRemove: removeEdge, onSelect: selectEdge, selected: edge.id === selectedEdgeId, activity: edgeActivity(edge, edgeActivities) },
  })), [edgeActivities, edges, removeEdge, selectEdge, selectedEdgeId]);

  const onConnect = useCallback((connection) => {
    if (running) {
      setRuntimeNotice("Aguarde a missão terminar antes de criar novas cordas.");
      return;
    }
    const kind = inferEdgeKind(connection, nodes);
    setEdges((current) => addEdge({ ...styledEdge(`edge-${Date.now()}`, connection.source, connection.target, kind, connection.sourceHandle), targetHandle: connection.targetHandle }, current));
  }, [nodes, running, setEdges]);

  const pickWorkspace = async () => {
    if (running) {
      setRuntimeNotice("Aguarde a execução terminar antes de trocar de workspace.");
      return;
    }
    const api = window.kordaDesktop;
    if (!api?.isDesktop) {
      setRuntimeNotice("Prévia web — terminais simulados; use npm run app para PTY real");
      return;
    }
    const unsavedCount = openDocuments.filter((document) => document.content !== document.savedContent).length;
    if (unsavedCount && !window.confirm(`${unsavedCount} arquivo${unsavedCount === 1 ? " possui" : "s possuem"} alterações não salvas. Descartar e trocar de workspace?`)) return;
    if (workspace.root) saveWorkspaceState(workspace, { nodes, edges });
    const result = await api.selectWorkspace();
    if (result) {
      const saved = readWorkspaceState(result);
      const nextNodes = saved ? restoreCanvasNodes(saved.nodes, result.root) : [];
      const nextEdges = saved?.edges || [];
      const nextSelectedId = nextNodes.find((node) => node.selected)?.id || nextNodes.find((node) => node.data.role === "orchestrator")?.id || nextNodes[0]?.id || null;
      terminalSessions.current.clear();
      terminalReadyAt.current.clear();
      topologySignatures.current.clear();
      for (const timer of topologyTimers.current.values()) window.clearTimeout(timer);
      topologyTimers.current.clear();
      for (const timer of replyTimers.current.values()) window.clearTimeout(timer);
      replyTimers.current.clear();
      setEdgeActivities([]);
      setSessionRevision((value) => value + 1);
      setWorkspace({ name: result.name, root: result.root, tree: Array.isArray(result.tree) ? result.tree : [] });
      setOpenDocuments([]);
      setActiveView("canvas");
      setWorkspaceWatchError("");
      setWorkspaceReady(true);
      setRuntimeNotice("");
      setNodes(nextNodes);
      setEdges(nextEdges);
      setSelectedId(nextSelectedId);
      setInspectorOpen(false);
      setStatsOpen(false);
      setOrchestrationOpen(false);
      setActiveTool("Canvas");
    }
  };

  const nextNodeId = (kind) => {
    let id;
    do {
      counter.current += 1;
      id = `${kind}-${counter.current}`;
    } while (nodes.some((node) => node.id === id));
    return id;
  };

  const nextNodePosition = (kind) => {
    const size = nodeSizes[kind] || nodeSizes.agent;
    const rects = nodes.map((node) => {
      const nodeSize = nodeSizes[node.type] || nodeSizes.agent;
      return {
        x: node.position.x,
        y: node.position.y,
        width: Number(node.width) || Number(node.style?.width) || nodeSize.width,
        height: Number(node.height) || Number(node.style?.height) || nodeSize.height,
      };
    });
    return findCanvasPosition(rects, size, startsCompact);
  };

  const addNode = (kind, options = {}) => {
    const id = nextNodeId(kind);
    const position = nextNodePosition(kind);
    let node;
    if (kind === "browser") node = { id, type: "browser", position, style: { width: 470, height: 321 }, data: { title: "Navegador · Chromium", url: "https://example.com" } };
    else if (kind === "file") node = { id, type: "file", position, data: { title: "contexto.md", path: `${workspace.name}/contexto.md`, meta: "arquivo de contexto" } };
    else if (kind === "group") node = { id, type: "note", position, style: { width: 340, height: 220 }, data: { title: "Grupo de execução", text: "", variant: "sticky" } };
    else if (kind === "text") node = { id, type: "note", position, style: { width: 360, height: 90 }, data: { title: "Texto", text: "", variant: "text", autoFocus: true } };
    else if (kind === "note") node = { id, type: "note", position, style: { width: 320, height: 220 }, data: { title: "Nota", text: "", variant: "sticky", autoFocus: true } };
    else node = { id, type: "agent", position, style: { width: nodeSizes.agent.width, height: nodeSizes.agent.height }, data: { title: options.title || "Terminal", kind: "terminal", terminal: true, command: options.command || undefined, cwd: workspaceReady ? workspace.root : undefined, status: "Pronto", statusTone: "ready", accent: "#5b6573", objective: "Executar comandos locais", output: "Sessão pronta" } };
    node = { ...node, selected: true };
    setNodes((current) => [...current.map((item) => ({ ...item, selected: false })), node]);
    setSelectedId(id);
    setInspectorOpen(false);
  };

  const confirmAgent = () => {
    if (launchMode === "terminal") {
      const command = selectedAgentId === "shell" ? undefined : availableAgents.find((item) => item.id === selectedAgentId)?.command;
      addNode("terminal", { title: launchTitle.trim() || "Terminal", command });
      setAgentDialogOpen(false);
      return;
    }
    const agent = availableAgents.find((item) => item.id === selectedAgentId);
    if (!agent || !roles[selectedRole]) return;
    const id = nextNodeId("agent");
    const node = {
      id,
      type: "agent",
      position: nextNodePosition("agent"),
      selected: true,
      style: { width: nodeSizes.agent.width, height: nodeSizes.agent.height },
      data: {
        ...agentData({ agentId: agent.id, agentName: agent.name, title: launchTitle.trim() || undefined, command: launchCommand.trim() || agent.command, kind: agent.id.replace(/-demo$/, "") }, selectedRole),
        terminal: true,
        cwd: workspaceReady ? workspace.root : undefined,
        status: "Pronto",
        statusTone: "ready",
        output: agent.simulated ? "Agente simulado na prévia web" : `Pronto para iniciar ${agent.command}`,
      },
    };
    const oldOrchestrator = nodes.find((item) => item.data.role === "orchestrator");
    setNodes((current) => [...current.map((item) => {
      const next = selectedRole === "orchestrator" && item.data.role === "orchestrator" ? { ...item, data: agentData(item.data, "executor") } : item;
      return { ...next, selected: false };
    }), node]);
    if (selectedRole === "orchestrator" && oldOrchestrator) {
      setEdges((current) => current.map((edge) => edge.source === oldOrchestrator.id ? { ...edge, source: id } : edge));
    }
    setSelectedId(id);
    setInspectorOpen(false);
    setStatsOpen(false);
    setOrchestrationOpen(false);
    setActiveTool("Agentes");
    setAgentDialogOpen(false);
  };

  const changeLaunchMode = (mode) => {
    setLaunchMode(mode);
    setLaunchTitle(mode === "terminal" ? "Terminal" : "Novo agente");
    setSelectedAgentId(mode === "terminal" ? "shell" : availableAgents[0]?.id || "");
    setLaunchCommand(mode === "terminal" ? "" : availableAgents[0]?.command || "");
  };

  const handleAdd = (kind) => {
    const tool = { terminal: "Terminais", agent: "Agentes", browser: "Navegador", note: "Contexto", text: "Canvas", file: "Arquivos", group: "Contexto" }[kind];
    if (tool) setActiveTool(tool);
    setStatsOpen(false);
    setOrchestrationOpen(false);
    if (kind === "agent" || kind === "terminal") void openAgentDialog(kind);
    else addNode(kind);
  };

  useEffect(() => {
    const onShortcut = (event) => {
      if (event.ctrlKey || event.metaKey || event.altKey || event.target.closest("input, textarea, select, [contenteditable='true'], [role='dialog']")) return;
      const kind = { t: "terminal", a: "agent", n: "note", x: "text", b: "browser" }[event.key.toLowerCase()];
      if (event.key.toLowerCase() === "v") {
        setCanvasTool("select");
        return;
      }
      if (!kind) return;
      event.preventDefault();
      handleAdd(kind);
      setCanvasTool("select");
    };
    window.addEventListener("keydown", onShortcut);
    return () => window.removeEventListener("keydown", onShortcut);
  });

  const handleTool = (tool) => {
    setActiveTool(tool);
    setStatsOpen(false);
    setOrchestrationOpen(false);
    if (tool === "Canvas") {
      setActiveView("canvas");
      setInspectorOpen(false);
      return;
    }
    if (tool === "Terminais") return void openAgentDialog("terminal");
    if (tool === "Agentes") return void openAgentDialog("agent");
    if (tool === "Navegador") return addNode("browser");
    if (tool === "Arquivos") {
      setDrawerOpen(true);
      setInspectorOpen(false);
      return;
    }
    if (tool === "Contexto") return addNode("note");
    if (tool === "Estatísticas") {
      setActiveView("canvas");
      setDrawerOpen(false);
      setInspectorOpen(false);
      setStatsOpen(true);
      return;
    }
    if (tool === "Orquestração") {
      setActiveView("canvas");
      const orchestrator = nodes.find((node) => node.data.role === "orchestrator");
      if (!orchestrator) {
        setRuntimeNotice("Nenhum Orquestrador foi definido no canvas.");
        return;
      }
      setDrawerOpen(false);
      setInspectorOpen(false);
      setOrchestrationOpen(true);
      return;
    }
    setRuntimeNotice("Configurações ainda não estão disponíveis neste protótipo.");
  };

  const startMission = async ({ objective, successCriteria, timeoutMs, reviewerId, participantIds }) => {
    if (running) return;
    const orchestrator = nodes.find((node) => node.data.role === "orchestrator");
    const chosen = new Set(participantIds || []);
    const participants = nodes.filter((node) => node.type === "agent" && node.data.role && (node.id === orchestrator?.id || chosen.has(node.id) || node.id === reviewerId));
    if (!orchestrator) return setRuntimeNotice("Defina um agente como Orquestrador antes de executar o fluxo.");
    const missing = participants.filter((node) => !terminalSessions.current.get(node.id));
    if (window.kordaDesktop?.isDesktop && missing.length) {
      setMissionError(`Abra a pasta e aguarde o PTY destes agentes: ${missing.map((node) => node.data.agentName || node.id).join(", ")}.`);
      return;
    }
    const runId = `run-${Date.now()}-${crypto.randomUUID().slice(0, 6)}`;
    setMissionDialogOpen(false);
    previousMissionState.current = null;
    activeRunId.current = runId;
    commitLedger((current) => startExecutionRun(current, {
      id: runId, workspace: workspace.name, workspaceId: activeWorkspaceId, orchestratorId: orchestrator.id,
      message: "Missão iniciada; aguardando conclusão explícita do Orquestrador",
    }));
    if (!window.kordaDesktop?.isDesktop) {
      appendMissionEvent({ nodeId: orchestrator.id, result: "simulated", message: "Missão simulada na prévia web" });
      commitLedger((current) => finishExecutionRun(current, runId, "completed", "Missão simulada na prévia web"));
      activeRunId.current = null;
      setRuntimeNotice("Missão simulada na prévia web; use o desktop para executar agentes reais.");
      return;
    }
    try {
      const snapshot = await window.kordaDesktop.startMission({
        id: runId,
        objective,
        successCriteria: successCriteria || "Objetivo concluído com evidências verificáveis.",
        timeoutMs,
        orchestratorId: orchestrator.id,
        reviewerId,
        participantIds: participants.map((node) => node.id),
      });
      setMissionSnapshot(snapshot);
      setRunning(true);
      for (const node of participants) {
        const sessionId = terminalSessions.current.get(node.id);
        const delivered = await pasteIntoTerminal(sessionId, node.id === orchestrator.id ? orchestratorProtocol(node) : workerProtocol(node), agentInputStrategy(node.data.agentId));
        if (!delivered) throw new Error(`Falha ao entregar protocolo a ${node.data.agentName || node.id}.`);
        await window.kordaDesktop.missionDelivered(node.id);
        appendMissionEvent({ nodeId: node.id, targetId: node.id, result: "delivered", message: `${node.data.agentName || node.id} recebeu o protocolo da missão` });
      }
      setRuntimeNotice("Missão em andamento. O Orquestrador deve concluir com korda run finish.");
      setLocalActivity((current) => {
        const next = recordLocalRun(current, 1);
        saveLocalActivity(next);
        return next;
      });
    } catch (error) {
      try { await window.kordaDesktop.cancelMission(error.message); } catch { /* coordenador pode não ter iniciado */ }
      commitLedger((current) => {
        try { return finishExecutionRun(current, runId, "failed", error.message); } catch { return current; }
      });
      activeRunId.current = null;
      setRunning(false);
      setRuntimeNotice(`A missão não iniciou: ${error.message}`);
    }
  };

  const cancelActiveMission = async () => {
    if (!running) return;
    try { await window.kordaDesktop?.cancelMission?.("Missão cancelada pelo usuário."); }
    catch (error) { setRuntimeNotice(`Não foi possível cancelar: ${error.message}`); }
  };

  const updateSelected = (patch) => setNodes((current) => current.map((node) => node.id === selectedId ? { ...node, data: { ...node.data, ...patch } } : node));
  const resizeSelected = (dimension, rawValue) => {
    const value = Number(rawValue);
    if (!selectedId || !Number.isFinite(value)) return;
    setNodes((current) => current.map((node) => {
      if (node.id !== selectedId) return node;
      const size = nodeSizes[node.type] || nodeSizes.agent;
      const minimum = dimension === "width" ? size.minWidth : size.minHeight;
      const nextValue = Math.max(minimum, Math.round(value));
      return { ...node, [dimension]: nextValue, style: { ...node.style, [dimension]: nextValue } };
    }));
  };
  const agentNodes = nodes.filter((node) => node.data.role);
  const agentPtys = agentNodes.filter((node) => terminalSessions.current.has(node.id)).length;
  const hasOrchestrator = agentNodes.some((node) => node.data.role === "orchestrator");

  const openWorkspaceFile = useCallback(async (item) => {
    const path = item?.path;
    if (!path) return;
    setActiveView(path);
    if (openDocuments.some((document) => document.path === path)) return;
    const editorId = crypto.randomUUID();
    setOpenDocuments((current) => current.some((document) => document.path === path)
      ? current
      : [...current, { editorId, path, name: item.name || path.split("/").pop(), content: "", savedContent: "", revision: null, loading: true, saving: false, saved: false, saveError: "" }]);
    try {
      const result = await window.kordaDesktop?.readWorkspaceFile?.(path);
      if (!result) throw new Error("Visualização disponível apenas no aplicativo desktop.");
      setOpenDocuments((current) => current.map((document) => document.path === path && document.editorId === editorId
        ? { ...document, ...result, content: result.content ?? "", savedContent: result.content ?? "", revision: result.revision ?? null, name: item.name || result.path.split("/").pop(), loading: false, saving: false, saved: false, error: "", saveError: "" }
        : document));
    } catch (error) {
      setOpenDocuments((current) => current.map((document) => document.path === path && document.editorId === editorId
        ? { ...document, loading: false, error: error.message || String(error) }
        : document));
    }
  }, [openDocuments]);

  const changeWorkspaceFile = useCallback((path, content) => {
    setOpenDocuments((current) => current.map((document) => document.path === path
      ? { ...document, content, saved: false }
      : document));
  }, []);

  const saveWorkspaceFile = useCallback(async (path) => {
    const document = openDocuments.find((item) => item.path === path);
    if (!document || document.loading || document.saving || document.content === document.savedContent) return;
    const contentToSave = document.content;
    const revisionToSave = document.revision;
    const editorId = document.editorId;
    setOpenDocuments((current) => current.map((item) => item.path === path ? { ...item, saving: true, saveError: "" } : item));
    try {
      const result = await window.kordaDesktop?.writeWorkspaceFile?.(path, contentToSave, revisionToSave);
      if (!result) throw new Error("Edição disponível apenas no aplicativo desktop.");
      setOpenDocuments((current) => current.map((item) => item.path === path && item.editorId === editorId ? {
        ...item,
        bytes: result.bytes,
        revision: result.revision,
        savedContent: contentToSave,
        saving: false,
        saved: item.content === contentToSave,
        saveError: "",
      } : item));
    } catch (error) {
      setOpenDocuments((current) => current.map((item) => item.path === path && item.editorId === editorId
        ? { ...item, saving: false, saved: false, saveError: error.message || String(error) }
        : item));
    }
  }, [openDocuments]);

  const reloadWorkspaceFile = useCallback(async (path) => {
    const document = openDocuments.find((item) => item.path === path);
    if (!document) return;
    const editorId = document.editorId;
    if (document.content !== document.savedContent && !window.confirm(`Descartar as alterações locais de ${document.name} e recarregar o arquivo?`)) return;
    setOpenDocuments((current) => current.map((item) => item.path === path ? { ...item, loading: true, saving: false, error: "", saveError: "" } : item));
    try {
      const result = await window.kordaDesktop?.readWorkspaceFile?.(path);
      if (!result) throw new Error("Edição disponível apenas no aplicativo desktop.");
      setOpenDocuments((current) => current.map((item) => item.path === path && item.editorId === editorId ? {
        ...item,
        ...result,
        content: result.content ?? "",
        savedContent: result.content ?? "",
        revision: result.revision ?? null,
        loading: false,
        saving: false,
        saved: false,
        error: "",
        saveError: "",
      } : item));
    } catch (error) {
      setOpenDocuments((current) => current.map((item) => item.path === path && item.editorId === editorId
        ? { ...item, loading: false, error: error.message || String(error) }
        : item));
    }
  }, [openDocuments]);

  const closeWorkspaceFile = useCallback((path) => {
    const document = openDocuments.find((item) => item.path === path);
    if (document && document.content !== document.savedContent && !window.confirm(`Fechar ${document.name} e descartar as alterações não salvas?`)) return;
    setOpenDocuments((current) => {
      const index = current.findIndex((document) => document.path === path);
      const next = current.filter((document) => document.path !== path);
      setActiveView((active) => active === path ? (next[Math.min(index, next.length - 1)]?.path || "canvas") : active);
      return next;
    });
  }, [openDocuments]);

  const resizeExplorer = useCallback((event) => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = explorerWidth;
    const onMove = (moveEvent) => {
      const maximum = Math.max(220, Math.min(560, window.innerWidth * .45));
      setExplorerWidth(Math.max(220, Math.min(maximum, startWidth + moveEvent.clientX - startX)));
    };
    const onEnd = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onEnd);
      window.removeEventListener("pointercancel", onEnd);
      window.removeEventListener("blur", onEnd);
      document.body.classList.remove("is-resizing-explorer");
    };
    document.body.classList.add("is-resizing-explorer");
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onEnd, { once: true });
    window.addEventListener("pointercancel", onEnd, { once: true });
    window.addEventListener("blur", onEnd, { once: true });
  }, [explorerWidth]);

  return <main className="app-shell">
    <header className="topbar">
      <div className="brand" aria-label="Korda">
        <span className="brand-mark" aria-hidden="true"><img src="./brand/korda-mark.png" alt="" /></span>
        <span className="brand-wordmark"><b>Korda</b></span>
        <span className="brand-local" title="Execução somente nesta máquina"><i />LOCAL</span>
      </div>
      <div className="topbar-context">
        <button className="project-button" onClick={pickWorkspace} disabled={running} title={workspace.root || workspace.name}><FolderOpen size={15} /><span>{workspace.name}</span><CaretDown size={12} /></button>
        <span className="branch-meta"><i />{workspaceWatchError ? "Atualização pausada" : workspaceReady ? "Pasta ao vivo" : "Sem pasta"}</span>
      </div>
      <div className="topbar-actions">
        <div className="run-metrics" aria-label="Resumo do workspace">
          <span title={`${agentPtys} agentes com terminal ativo`}><Robot size={14} /><b className="green-text">{agentPtys}</b><small>agentes</small></span>
          <span title={`${terminalSessions.current.size} terminais ativos`}><TerminalWindow size={14} /><b>{terminalSessions.current.size}</b><small>PTYs</small></span>
          <span title={`${edges.length} cordas no canvas`}><ShareNetwork size={14} /><b className="orange-text">{edges.length}</b><small>cordas</small></span>
          <span title={`${localActivity.runs} execuções locais`}><ChartLineUp size={14} /><b className="blue-text">{localActivity.runs}</b><small>execuções</small></span>
        </div>
        <button className={`run-button ${running ? "danger" : ""}`} onClick={running ? cancelActiveMission : () => { setMissionError(""); setMissionDialogOpen(true); }} disabled={!running && !hasOrchestrator} title={!hasOrchestrator ? "Adicione um agente e defina-o como Orquestrador" : running ? `Cancelar missão ${missionSnapshot?.id || "ativa"}` : "Configurar e iniciar missão"}>{running ? <X size={15} /> : <Play size={15} weight="fill" />}{running ? "Cancelar missão" : "Iniciar missão"}</button>
        <button className="top-icon" onClick={() => void openAgentDialog("agent")} aria-label="Novo agente" title="Novo agente"><Plus size={18} /></button>
        <button className="top-icon" onClick={() => setOnboardingOpen(true)} aria-label="Ajuda e primeiros passos" title="Ajuda e primeiros passos"><Question size={18} /></button>
        <span className="avatar" title="Korda">K</span>
      </div>
    </header>
    <div className={`workbench ${drawerOpen ? "drawer-open" : ""} ${inspectorOpen ? "inspector-open" : ""}`} style={{ "--explorer-width": `${explorerWidth}px` }}>
      <Rail active={activeTool} onSelect={handleTool} onHelp={() => setOnboardingOpen(true)} />
      {drawerOpen && <WorkspaceExplorer name={workspace.name} root={workspace.root} ready={workspaceReady} tree={workspace.tree} watchError={workspaceWatchError} activePath={activeView} onPick={pickWorkspace} onOpenFile={openWorkspaceFile} onResizeStart={resizeExplorer} />}
      <WorkbenchDeck documents={openDocuments} activeView={activeView} onActivate={(view) => { setActiveView(view); if (view === "canvas") setActiveTool("Canvas"); }} onClose={closeWorkspaceFile} onChange={changeWorkspaceFile} onSave={saveWorkspaceFile} onReload={reloadWorkspaceFile} canvas={<section className="canvas-shell"><button className="drawer-toggle" onClick={() => setDrawerOpen((value) => !value)} title="Alternar workspace" aria-label="Alternar painel do workspace"><SidebarSimple size={17} /></button>{runtimeNotice && <span role="status" style={{ position: "absolute", zIndex: 12, top: 62, right: 14, maxWidth: 380, padding: "7px 10px", border: "1px solid #fed7aa", borderRadius: 6, background: "#fff7ed", color: "#9a3412", fontSize: 11, boxShadow: "0 2px 8px rgba(20, 26, 33, .06)" }}>{runtimeNotice}</span>}{selectedEdgeId && edges.some((edge) => edge.id === selectedEdgeId) && <button type="button" className="remove-cord" onClick={removeSelectedEdge} disabled={running} aria-label="Remover corda selecionada"><X size={13} />Remover corda</button>}<CanvasToolbar activeTool={canvasTool} onSelect={setCanvasTool} onAdd={(kind) => { handleAdd(kind); setCanvasTool("select"); }} /><ReactFlow nodes={renderedNodes} edges={renderedEdges} nodeTypes={nodeTypes} edgeTypes={edgeTypes} onNodesChange={onNodesChange} onEdgesChange={onEdgesChange} onConnect={onConnect} onInit={(instance) => { if (nodes.length > 0) window.setTimeout(() => void instance.fitView({ includeHiddenNodes: true, padding: { top: "8%", right: "8%", bottom: "8%", left: "8%" }, minZoom: 0.65 }), 0); }} connectionMode={ConnectionMode.Loose} selectionOnDrag panOnDrag={[1, 2]} isValidConnection={({ source, target }) => source !== target} onNodeClick={(_, node) => { setSelectedEdgeId(null); setSelectedId(node.id); setStatsOpen(false); setOrchestrationOpen(false); setInspectorOpen(true); setActiveTool("Canvas"); }} onEdgeClick={(_, edge) => { setSelectedEdgeId(edge.id); setSelectedId(null); }} onPaneClick={() => { setSelectedEdgeId(null); setSelectedId(null); }} onBeforeDelete={beforeDelete} onNodesDelete={(deleted) => deleted.forEach((node) => removeNode(node.id))} defaultViewport={startsCompact ? { x: 0, y: 0, zoom: 1 } : undefined} minZoom={0.35} maxZoom={1.6} deleteKeyCode={["Backspace", "Delete"]} connectionLineStyle={{ stroke: "#8d939a", strokeWidth: 1.7, strokeDasharray: "7 6" }}><Background variant={BackgroundVariant.Lines} gap={20} size={1} color="#e4e8ed" /><CanvasControls /></ReactFlow>{statsOpen && <MetricsView nodes={nodes} edges={edges} sessionBindings={sessionBindings} activity={localActivity} workspaceName={workspace.name} workspaceRoot={workspace.root} preview={!window.kordaDesktop?.isDesktop} onClose={() => { setStatsOpen(false); setActiveTool("Canvas"); }} />}{orchestrationOpen && <OrchestrationView ledger={executionLedger} workspaceId={activeWorkspaceId} workspaceName={workspace.name} preview={!window.kordaDesktop?.isDesktop} onClose={() => { setOrchestrationOpen(false); setActiveTool("Canvas"); }} />}{nodes.length === 0 && !statsOpen && !orchestrationOpen && !agentDialogOpen && !inspectorOpen && <EmptyCanvas onOpenWorkspace={pickWorkspace} onAddAgent={() => void openAgentDialog("agent")} onAddTerminal={() => void openAgentDialog("terminal")} onOpenGuide={() => setOnboardingOpen(true)} />}</section>} />
      {inspectorOpen && <Inspector node={selected} onClose={() => setInspectorOpen(false)} onChange={updateSelected} onRoleChange={(role) => selectedId && changeAgentRole(selectedId, role)} onResize={resizeSelected} onRemove={removeNode} />}
    </div>
    <QuickStartDialog open={agentDialogOpen} mode={launchMode} agents={availableAgents} loading={agentsLoading} error={agentError} preview={agentPreview} selectedAgentId={selectedAgentId} selectedRole={selectedRole} command={launchCommand} title={launchTitle} onSelectAgent={setSelectedAgentId} onSelectRole={setSelectedRole} onCommandChange={setLaunchCommand} onTitleChange={setLaunchTitle} onModeChange={changeLaunchMode} onClose={closeAgentDialog} onConfirm={confirmAgent} />
    <MissionDialog open={missionDialogOpen} error={missionError} agents={agentNodes.map((node) => ({ id: node.id, title: node.data.agentName || node.data.title, role: node.data.role, roleLabel: node.data.roleLabel }))} onClose={() => setMissionDialogOpen(false)} onStart={startMission} />
    <OnboardingGuide open={onboardingOpen} onDismiss={dismissOnboarding} onOpenWorkspace={() => { dismissOnboarding(); void pickWorkspace(); }} onAddAgent={() => { dismissOnboarding(); void openAgentDialog("agent"); }} onAddTerminal={() => { dismissOnboarding(); void openAgentDialog("terminal"); }} />
  </main>;
}
