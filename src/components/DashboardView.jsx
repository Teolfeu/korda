import { useEffect, useMemo, useState } from "react";
import {
  ArrowClockwise,
  Brain,
  Clock,
  Code,
  Coins,
  Crosshair,
  Cube,
  DownloadSimple,
  FileCode,
  FlagBanner,
  FolderOpen,
  Globe,
  Lightning,
  Note,
  PaperPlaneTilt,
  Planet,
  Plus,
  Robot,
  Sparkle,
  SquaresFour,
  Stop,
  TerminalWindow,
  UploadSimple,
} from "@phosphor-icons/react";

// Cores de destaque por tipo de agente — manter em sincronia com os nós do canvas.
const AGENT_COLORS = {
  codex: "#7c3aed",
  claude: "#c2410c",
  opencode: "#059669",
  kimi: "#2563eb",
  gemini: "#0891b2",
  hermes: "#db2777",
  grok: "#334155",
  terminal: "#64748b",
  shell: "#64748b",
  browser: "#0d9488",
  file: "#4d7c0f",
  note: "#ca8a04",
};

const KIND_ICONS = {
  codex: Cube,
  claude: Robot,
  opencode: Code,
  kimi: Sparkle,
  gemini: Planet,
  hermes: PaperPlaneTilt,
  grok: Lightning,
  terminal: TerminalWindow,
  shell: TerminalWindow,
  browser: Globe,
  file: FileCode,
  note: Note,
};

const MISSION_STATES = {
  preparing: "Preparando",
  running: "Em execução",
  reviewing: "Em revisão",
  completed: "Concluída",
  failed: "Falhou",
  cancelled: "Cancelada",
  timed_out: "Tempo esgotado",
};
const MISSION_ACTIVE = new Set(["preparing", "running", "reviewing"]);
const MISSION_ERROR = new Set(["failed", "timed_out"]);

function resolveKind(node) {
  if (node.type === "browser") return "browser";
  if (node.type === "file") return "file";
  if (node.type === "note") return "note";
  const data = node.data || {};
  const commandName = typeof data.command === "string" ? data.command.trim().split(/\s+/)[0]?.split("/").pop() : "";
  for (const raw of [data.kind, data.agentId, commandName]) {
    const key = String(raw || "").toLowerCase().replace(/-demo$/, "").replace(/-code$/, "");
    if (!key) continue;
    if (AGENT_COLORS[key]) return key;
    const hit = Object.keys(AGENT_COLORS).find((name) => key.startsWith(`${name}-`) || key.endsWith(`-${name}`));
    if (hit) return hit;
  }
  return data.role ? "agent" : "terminal";
}

function deriveStatus(node, metric, hasSession) {
  const data = node.data || {};
  if (metric?.closed) return { key: "closed", label: "Fechado", tone: "gray" };
  if (metric?.exited) return { key: "exited", label: "Encerrado", tone: "gray" };
  const lifecycle = data.terminalLifecycle?.status;
  if (lifecycle === "failed") return { key: "failed", label: "Falhou", tone: "red" };
  if (lifecycle === "exited") return { key: "exited", label: "Encerrado", tone: "gray" };
  if (data.terminalEnabled === false) return { key: "stopped", label: "Parado", tone: "gray" };
  if (lifecycle === "starting" || lifecycle === "restarting") return { key: "starting", label: "Iniciando", tone: "amber" };
  if (lifecycle === "running" || hasSession) return { key: "running", label: "Rodando", tone: "green" };
  return { key: "idle", label: "Inativo", tone: "amber" };
}

function lastFeedLine(feed) {
  if (typeof feed !== "string" || !feed.trim()) return "";
  const lines = feed.replace(/\r/g, "\n").split("\n").map((line) => line.trim()).filter(Boolean);
  return lines[lines.length - 1] || "";
}

function formatBytes(value) {
  const bytes = Number(value) || 0;
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let size = bytes;
  let unit = "B";
  for (const next of units) {
    if (size < 1024) break;
    size /= 1024;
    unit = next;
  }
  return `${size.toLocaleString("pt-BR", { maximumFractionDigits: 1 })} ${unit}`;
}

function formatTokens(value) {
  const tokens = Number(value) || 0;
  return Intl.NumberFormat("pt-BR", { notation: "compact", maximumFractionDigits: 1 }).format(tokens);
}

function formatRelative(timestamp, now) {
  if (!Number.isFinite(timestamp)) return "—";
  const diff = Math.max(0, now - timestamp);
  if (diff < 5_000) return "agora";
  if (diff < 60_000) return `há ${Math.round(diff / 1000)} s`;
  if (diff < 3_600_000) return `há ${Math.round(diff / 60_000)} min`;
  if (diff < 86_400_000) return `há ${Math.round(diff / 3_600_000)} h`;
  return `há ${Math.round(diff / 86_400_000)} d`;
}

function AgentCard({ card, onFocusNode, onRestart, onStop }) {
  const { node, kind, accent, status, metric, feedLine, lastActivityAt, now } = card;
  const data = node.data || {};
  const Icon = KIND_ICONS[kind] || Brain;
  const title = data.title || data.agentName || "Terminal";
  const subtitle = data.agentName ? `${data.agentName} · ${kind}` : kind === "terminal" || kind === "shell" ? "Terminal local" : kind;
  return <article className="kdb-card" style={{ "--kdb-accent": accent }}>
    <header>
      <span className="kdb-card-icon" aria-hidden="true"><Icon size={19} weight="duotone" /></span>
      <div className="kdb-card-title"><b title={title}>{title}</b><small>{subtitle}</small></div>
      <span className={`kdb-status ${status.tone}`} title={data.activity || status.label}><i />{status.label}</span>
    </header>
    {data.role && <span className="kdb-role">{data.roleLabel || data.role}</span>}
    <dl>
      <div><dt>Comando</dt><dd title={data.command || undefined}>{data.command || "padrão do shell"}</dd></div>
      <div><dt>Pasta</dt><dd title={data.cwd || undefined}>{data.cwd || "sem pasta aberta"}</dd></div>
    </dl>
    <div className="kdb-card-metrics" aria-label="Métricas da sessão">
      <span title="Bytes enviados ao processo"><DownloadSimple size={11} />in <b>{metric ? formatBytes(metric.bytesIn) : "—"}</b></span>
      <span title="Bytes produzidos pelo processo"><UploadSimple size={11} />out <b>{metric ? formatBytes(metric.bytesOut) : "—"}</b></span>
      <span title="Última atividade registrada"><Clock size={11} /><b>{metric ? formatRelative(lastActivityAt, now) : "sem sessão"}</b></span>
    </div>
    {feedLine && <p className="kdb-card-feed" title={feedLine}><TerminalWindow size={12} /><span>{feedLine}</span></p>}
    <div className="kdb-card-actions">
      <button type="button" className="kdb-focus" onClick={() => onFocusNode(node.id)} title="Voltar ao canvas com este nó selecionado"><Crosshair size={13} />Focar no canvas</button>
      <span />
      <button type="button" onClick={() => onRestart(node.id)} disabled={!data.terminal} title="Reiniciar o processo local"><ArrowClockwise size={13} />Reiniciar</button>
      <button type="button" className="kdb-stop" onClick={() => onStop(node.id)} disabled={!data.terminal || data.terminalEnabled === false} title="Parar o processo do terminal"><Stop size={12} weight="fill" />Parar</button>
    </div>
  </article>;
}

function MissionPanel({ mission, nodes }) {
  const state = mission?.state;
  const tone = MISSION_ACTIVE.has(state) ? "active" : MISSION_ERROR.has(state) ? "error" : "done";
  const nameOf = (id) => nodes.find((node) => node.id === id)?.data?.agentName || nodes.find((node) => node.id === id)?.data?.title || id;
  const participants = Array.isArray(mission?.participantIds) ? mission.participantIds : [];
  return <section className="kdb-panel" aria-label="Missão">
    <header>
      <h2><FlagBanner size={15} />Missão</h2>
      <span className={`kdb-mission-state ${tone}`}><i />{MISSION_STATES[state] || state || "—"}</span>
    </header>
    <div className="kdb-mission-grid">
      <div><b>{participants.length}</b><small>participantes</small></div>
      <div><b>{mission?.requestCount ?? 0}</b><small>pedidos</small></div>
      <div><b>{mission?.pendingCount ?? 0}</b><small>pendentes</small></div>
      <div><b>{mission?.replyCount ?? 0}</b><small>respostas</small></div>
    </div>
    {participants.length > 0 && <p className="kdb-panel-note">{participants.map(nameOf).join(" · ")}</p>}
    {mission?.finalMessage && <p className="kdb-mission-final">{mission.finalMessage}</p>}
  </section>;
}

function UsagePanel({ usage }) {
  const providers = Array.isArray(usage?.providers) ? usage.providers : [];
  const available = providers.filter((provider) => provider.available);
  return <section className="kdb-panel" aria-label="Uso local">
    <header>
      <h2><Coins size={15} />Uso local</h2>
      <small>{usage?.days ? `últimos ${usage.days} dias` : "período indisponível"}</small>
    </header>
    {available.length ? <div className="kdb-usage-list">
      {available.map((provider) => <div className="kdb-usage-row" key={provider.id}>
        <span><i style={{ background: AGENT_COLORS[provider.id] || "#64748b" }} />{provider.label}</span>
        <span><b>{formatTokens(provider.totalTokens)}</b><small>tokens</small></span>
      </div>)}
    </div> : <p className="kdb-usage-empty">Nenhum histórico de consumo das CLIs encontrado nesta máquina.</p>}
  </section>;
}

export function DashboardView({
  nodes,
  sessionBindings = {},
  mission = null,
  workspaceName = "Sem workspace",
  preview = false,
  onFocusNode,
  onRestart,
  onStop,
  onAddAgent,
  onAddTerminal,
  onOpenWorkspace,
}) {
  const [metrics, setMetrics] = useState(null);
  const [missionPoll, setMissionPoll] = useState(undefined);

  // Polling de métricas/missão só enquanto o dashboard está montado (visível).
  useEffect(() => {
    const api = window.kordaDesktop;
    if (!api?.isDesktop) return undefined;
    let cancelled = false;
    const poll = async () => {
      try {
        const [snapshot, missionSnapshot] = await Promise.all([api.metricsSnapshot?.(), api.missionSnapshot?.()]);
        if (cancelled) return;
        if (snapshot && Array.isArray(snapshot.terminals)) setMetrics(snapshot);
        if (missionSnapshot !== undefined) setMissionPoll(missionSnapshot ?? null);
      } catch { /* mantém o último snapshot válido */ }
    };
    void poll();
    const timer = window.setInterval(poll, 2500);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, []);

  const now = metrics?.now || Date.now();
  const terminalsById = useMemo(() => new Map((metrics?.terminals || []).map((terminal) => [terminal.id, terminal])), [metrics]);
  // No desktop o snapshot consultado é a fonte mais fresca; na prévia web vale o estado do App.
  const liveMission = preview ? mission : missionPoll !== undefined ? missionPoll : mission;

  const cards = useMemo(() => nodes
    .filter((node) => node.type === "agent")
    .map((node) => {
      const kind = resolveKind(node);
      const sessionId = sessionBindings[node.id];
      const metric = sessionId ? terminalsById.get(sessionId) : undefined;
      return {
        node,
        kind,
        accent: AGENT_COLORS[kind] || AGENT_COLORS.terminal,
        status: deriveStatus(node, metric, Boolean(sessionId)),
        metric,
        lastActivityAt: metric?.lastActivityAt,
        feedLine: lastFeedLine(node.data?.feed) || node.data?.activity || node.data?.output || "",
      };
    })
    .sort((a, b) => (b.lastActivityAt || 0) - (a.lastActivityAt || 0)
      || Number(b.status.key === "running") - Number(a.status.key === "running")
      || String(a.node.data?.title || "").localeCompare(String(b.node.data?.title || ""), "pt-BR")),
  [nodes, sessionBindings, terminalsById]);

  const activeCount = cards.filter((card) => card.status.key === "running" || card.status.key === "starting").length;

  return <section className="kdb-overlay" aria-label="Dashboard de agentes">
    <div className="kdb-shell">
      <header className="kdb-header">
        <div>
          <h1><SquaresFour size={21} weight="duotone" />Dashboard</h1>
          <p><b>{workspaceName}</b> · {activeCount} de {cards.length} {cards.length === 1 ? "agente ativo" : "agentes ativos"}{preview ? " · prévia web (dados simulados)" : ""}</p>
        </div>
        <div className="kdb-header-actions">
          <button type="button" className="kdb-button" onClick={onAddTerminal}><TerminalWindow size={15} />Novo terminal</button>
          <button type="button" className="kdb-button primary" onClick={onAddAgent}><Plus size={15} weight="bold" />Novo agente</button>
        </div>
      </header>

      {(liveMission || metrics?.usage) && <div className="kdb-panels">
        {liveMission && <MissionPanel mission={liveMission} nodes={nodes} />}
        {metrics?.usage && <UsagePanel usage={metrics.usage} />}
      </div>}

      {cards.length === 0 ? <div className="kdb-empty">
        <span className="kdb-empty-icon" aria-hidden="true"><Robot size={26} weight="duotone" /></span>
        <b>Nenhum agente no workspace</b>
        <p>Abra uma pasta local para ativar os terminais e adicione agentes ao fluxo. Cada agente adicionado aparece aqui como um card com status e métricas em tempo real.</p>
        <div className="kdb-empty-actions">
          <button type="button" className="kdb-button primary" onClick={onOpenWorkspace}><FolderOpen size={15} />Abrir pasta</button>
          <button type="button" className="kdb-button" onClick={onAddAgent}><Robot size={15} />Adicionar agente</button>
          <button type="button" className="kdb-button" onClick={onAddTerminal}><TerminalWindow size={15} />Novo terminal</button>
        </div>
      </div> : <div className="kdb-grid">
        {cards.map((card) => <AgentCard key={card.node.id} card={{ ...card, now }} onFocusNode={onFocusNode} onRestart={onRestart} onStop={onStop} />)}
      </div>}
    </div>
  </section>;
}
