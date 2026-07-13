import { useMemo } from "react";
import {
  ArrowRight,
  CheckCircle,
  ClockCountdown,
  GitBranch,
  Play,
  Prohibit,
  WarningCircle,
  X,
} from "@phosphor-icons/react";
import { normalizeExecutionLedger, summarizeExecutionLedger } from "../execution-ledger.js";
import "../orchestration-view.css";

const resultMeta = {
  started: { label: "Iniciada", tone: "running", icon: Play },
  delivered: { label: "Entregue", tone: "delivered", icon: CheckCircle },
  blocked: { label: "Bloqueada", tone: "blocked", icon: Prohibit },
  simulated: { label: "Simulada", tone: "simulated", icon: Play },
  skipped: { label: "Ignorada", tone: "skipped", icon: ArrowRight },
  completed: { label: "Concluída", tone: "delivered", icon: CheckCircle },
  failed: { label: "Falhou", tone: "blocked", icon: WarningCircle },
};

const statusLabel = { running: "Em execução", completed: "Concluída", failed: "Falhou" };

function clock(value) {
  return new Date(value).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function route(event) {
  if (event.sourceId && event.targetId) return `${event.sourceId} → ${event.targetId}`;
  return event.nodeId || event.edgeId || "Execução";
}

export function OrchestrationView({ ledger, workspaceId, workspaceName, preview = false, onClose }) {
  const normalized = useMemo(() => normalizeExecutionLedger(ledger), [ledger]);
  const scoped = useMemo(() => ({
    ...normalized,
    runs: workspaceId ? normalized.runs.filter((run) => run.workspaceId ? run.workspaceId === workspaceId : run.workspace === workspaceName) : normalized.runs,
  }), [normalized, workspaceId, workspaceName]);
  const summary = useMemo(() => summarizeExecutionLedger(scoped), [scoped]);
  const current = summary.latestRun;

  return <section className="orchestration-view" aria-labelledby="orchestration-title">
    <header className="orchestration-header">
      <div><span>LEDGER LOCAL · {preview ? "PRÉVIA WEB" : "DESKTOP"}</span><h1 id="orchestration-title">Orquestração auditável</h1><p>{workspaceName || "Workspace local"} · somente eventos operacionais curtos</p></div>
      <button onClick={onClose} aria-label="Fechar orquestração" title="Voltar ao canvas"><X size={18} /></button>
    </header>

    <div className="orchestration-summary" aria-label="Resumo da orquestração">
      <article><ClockCountdown size={18} /><span>ESTADO ATUAL<strong className={`ledger-${current?.status || "idle"}`}>{current ? statusLabel[current.status] : "Sem execução"}</strong></span></article>
      <article><CheckCircle size={18} /><span>ENTREGUES<strong>{summary.delivered}</strong></span></article>
      <article><Prohibit size={18} /><span>BLOQUEADAS<strong>{summary.blocked}</strong></span></article>
      <article><Play size={18} /><span>SIMULADAS<strong>{summary.simulated}</strong></span></article>
      <article><GitBranch size={18} /><span>EXECUÇÕES<strong>{summary.runs}</strong></span></article>
    </div>

    <div className="orchestration-layout">
      <article className="ledger-surface timeline-surface">
        <header><div><h2>Timeline {current ? `· ${current.id}` : ""}</h2><p>{current ? `${current.events.length} eventos registrados` : "Execute o fluxo para criar o primeiro registro"}</p></div>{current && <span className={`ledger-pill ledger-${current.status}`}>{statusLabel[current.status]}</span>}</header>
        <div className="ledger-timeline" role="list" aria-label="Eventos da execução mais recente">
          {current?.events.map((event) => {
            const meta = resultMeta[event.result] || resultMeta.skipped;
            const Icon = meta.icon;
            return <div className={`ledger-event ledger-${meta.tone}`} role="listitem" key={event.id}><i><Icon size={14} weight="fill" /></i><time dateTime={new Date(event.at).toISOString()}>{clock(event.at)}</time><div><b>{meta.label} · {route(event)}</b><p>{event.message || "Sem observação adicional"}</p>{event.kind && <small>corda: {event.kind}{event.edgeId ? ` · ${event.edgeId}` : ""}</small>}</div></div>;
          })}
          {!current && <p className="ledger-empty">Nenhuma execução registrada neste dispositivo.</p>}
        </div>
      </article>

      <article className="ledger-surface runs-surface">
        <header><div><h2>Execuções recentes</h2><p>Até 25 registros locais</p></div><span>{summary.completed} concluídas · {summary.failed} falhas</span></header>
        <div className="ledger-runs">
          {scoped.runs.slice(0, 8).map((run) => <div key={run.id}><i className={`ledger-dot ledger-${run.status}`} /><span><b>{run.id}</b><small>{run.workspace || "Workspace local"} · {clock(run.startedAt)}</small></span><em>{statusLabel[run.status]}</em></div>)}
          {!scoped.runs.length && <p className="ledger-empty">O histórico aparecerá aqui após uma execução.</p>}
        </div>
      </article>
    </div>
    <p className="orchestration-footnote">O ledger não armazena prompts, contexto completo, saída do terminal, ambiente ou credenciais.</p>
  </section>;
}
