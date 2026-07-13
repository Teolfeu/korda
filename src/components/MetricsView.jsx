import { useEffect, useMemo, useState } from "react";
import {
  ArrowsLeftRight,
  ClockCountdown,
  Coins,
  GitBranch,
  Pulse,
  Robot,
  TerminalWindow,
  X,
} from "@phosphor-icons/react";
import { formatBytes, formatDuration, summarizeSession } from "../session-metrics.js";
import "../metrics.css";

const roleNames = { orchestrator: "Orquestrador", executor: "Executor", reviewer: "Revisor", researcher: "Pesquisador" };
const compact = new Intl.NumberFormat("pt-BR", { notation: "compact", maximumFractionDigits: 1 });

function formatTokens(value) {
  return `${compact.format(Math.max(0, Number(value) || 0))} tokens`;
}

function costLabel(provider) {
  if (provider.costStatus === "included") return "incluído no plano";
  if (provider.costStatus === "actual") return `US$ ${Number(provider.costUsd || 0).toFixed(2)} real`;
  if (provider.costStatus === "estimated") return `US$ ${Number(provider.costUsd || 0).toFixed(2)} estimado`;
  return "custo indisponível";
}

function resetLabel(window) {
  if (window.resetIn) return `reinicia em ${window.resetIn}`;
  if (!window.resetAt) return "reset indisponível";
  const date = new Date(window.resetAt);
  return Number.isNaN(date.getTime()) ? "reset indisponível" : `reinicia ${date.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}`;
}

function planLabel(value) {
  return ({ prolite: "Pro Lite", live: "ao vivo", fallback: "histórico local", observed: "dados locais", partial: "parcial", unavailable: "indisponível" })[value] || value;
}

function planDetails(plan) {
  if (plan.resetCreditsAvailable) return `${plan.resetCreditsAvailable} créditos de reset`;
  if (plan.credits?.unlimited) return "créditos ilimitados";
  if (plan.credits?.hasCredits && plan.credits.balance != null) return `saldo ${plan.credits.balance} créditos`;
  if (plan.observedAt) return `atualizado ${new Date(plan.observedAt).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}`;
  return "";
}

function Metric({ icon: Icon, label, value, detail, tone = "blue" }) {
  return <article className={`metric-card metric-${tone}`}><span><Icon size={17} weight="duotone" /></span><div><small>{label}</small><strong>{value}</strong><p>{detail}</p></div></article>;
}

function Heatmap({ days }) {
  const peak = Math.max(1, ...days.map((day) => day.count));
  return <div className="activity-map" aria-label="Execuções locais nos últimos 84 dias">{days.map((day) => {
    const level = day.count ? Math.max(1, Math.ceil((day.count / peak) * 4)) : 0;
    return <i key={day.key} data-level={level} title={`${day.label}: ${day.count} execução${day.count === 1 ? "" : "ões"}`} aria-label={`${day.label}: ${day.count}`} />;
  })}</div>;
}

export function MetricsView({ nodes, edges, sessionBindings, activity, workspaceName, workspaceRoot, preview, onClose }) {
  const [snapshot, setSnapshot] = useState({ now: Date.now(), terminals: [] });
  const [error, setError] = useState("");

  useEffect(() => {
    let mounted = true;
    let timer;
    const refresh = async () => {
      try {
        const result = await window.kordaDesktop?.metricsSnapshot?.();
        if (mounted) {
          setSnapshot(result && Array.isArray(result.terminals) ? result : { now: Date.now(), terminals: [] });
          setError("");
        }
      } catch {
        if (mounted) setError("A telemetria do PTY não respondeu.");
      } finally {
        if (mounted) timer = window.setTimeout(refresh, 1000);
      }
    };
    void refresh();
    return () => {
      mounted = false;
      window.clearTimeout(timer);
    };
  }, []);

  const metrics = useMemo(() => summarizeSession({ snapshot, nodes, edges, sessionBindings, activity, workspaceRoot }), [activity, edges, nodes, sessionBindings, snapshot, workspaceRoot]);
  const traffic = metrics.bytesIn + metrics.bytesOut;
  const usage = metrics.usage || {};
  const providers = Array.isArray(usage.providers) ? usage.providers : [];
  const plans = Array.isArray(usage.plans) ? usage.plans : [];
  const availableProviders = providers.filter((provider) => provider.available);
  const totalTokens = availableProviders.reduce((total, provider) => total + Number(provider.totalTokens || 0), 0);
  const updatedAt = new Date(metrics.measuredAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });

  return <section className="metrics-view" aria-labelledby="metrics-title">
    <header className="metrics-header"><div><span>TELEMETRIA LOCAL · {preview ? "PRÉVIA WEB" : "DESKTOP"}</span><h1 id="metrics-title">Operação da sessão</h1><p>{workspaceName} · atualizado às {updatedAt}</p></div><button onClick={onClose} aria-label="Fechar estatísticas" title="Voltar ao canvas"><X size={18} /></button></header>
    {error && <p className="metrics-error" role="alert">{error}</p>}
    <div className="metric-cards">
      <Metric icon={ClockCountdown} label="TEMPO DA SESSÃO" value={formatDuration(metrics.sessionDuration)} detail={metrics.terminals ? "desde o primeiro PTY local" : "abra um terminal para medir"} />
      <Metric icon={Robot} label="AGENTES ATIVOS" value={`${metrics.activeAgents} / ${metrics.configuredAgents}`} detail="PTYs vinculados a agentes" tone="green" />
      <Metric icon={TerminalWindow} label="TERMINAIS" value={`${metrics.activeTerminals} ativos`} detail={`${metrics.terminals} sessões registradas`} tone="orange" />
      <Metric icon={ArrowsLeftRight} label="TRÁFEGO LOCAL" value={formatBytes(traffic)} detail={`${formatBytes(metrics.bytesIn)} entrada · ${formatBytes(metrics.bytesOut)} saída`} tone="cyan" />
      <Metric icon={GitBranch} label="CONTEXTO ENTREGUE" value={`${metrics.packets} pacotes`} detail={`${metrics.cords} cordas no canvas · histórico local`} tone="purple" />
      <Metric icon={Pulse} label="EXECUÇÕES REGISTRADAS" value={`${metrics.runs} locais`} detail={`${metrics.windowRuns} nas últimas 12 semanas · ${metrics.inputEvents} entradas PTY`} tone="blue" />
    </div>


    <section className="plan-section" aria-labelledby="plans-title">
      <header><div><span>ASSINATURAS</span><h2 id="plans-title">Planos e limites</h2><p>Janelas de uso informadas pelas suas contas conectadas</p></div><span>{plans.filter((plan) => plan.available).length} disponíveis</span></header>
      <div className="plan-grid">
        {plans.map((plan) => <article className={`plan-card ${plan.available ? "" : "unavailable"}`} key={plan.id || plan.provider}>
          <header><div className="plan-provider"><span aria-hidden="true"><Robot size={15} weight="duotone" /></span><div><h3>{plan.label || plan.id || plan.provider}</h3>{plan.plan && <small>{planLabel(plan.plan)}</small>}</div></div>{plan.status && <span className="plan-status">{planLabel(plan.status)}</span>}</header>
          {!plan.available ? <p className="plan-message">{plan.reason || "Dados do plano indisponíveis."}</p> : Array.isArray(plan.windows) && plan.windows.length ? <div className="plan-windows">{plan.windows.map((window, index) => {
            const rawUsed = Number(window.usedPercent);
            const hasUsage = window.usedPercent !== null && window.usedPercent !== "" && window.usedPercent !== undefined && Number.isFinite(rawUsed);
            const used = Math.min(100, Math.max(0, rawUsed));
            return <div className="plan-window" key={`${window.label || "janela"}-${index}`}><div><span>{window.label || "Uso"}</span><strong>{hasUsage ? `${used}%` : "indisponível"}</strong></div>{hasUsage && <div className="plan-progress" role="progressbar" aria-label={`${window.label || "Uso"}: ${used}% consumido`} aria-valuemin="0" aria-valuemax="100" aria-valuenow={used}><i style={{ width: `${used}%` }} /></div>}<small>{resetLabel(window)}</small></div>;
          })}{planDetails(plan) && <small className="plan-details">{planDetails(plan)}</small>}</div> : <p className="plan-message">Esta conta não expõe limites de uso.</p>}
        </article>)}
        {!plans.length && <article className="plan-empty"><Coins size={20} /><div><strong>Nenhum limite de assinatura disponível</strong><p>Conecte uma conta compatível para acompanhar as janelas do plano.</p></div></article>}
      </div>
    </section>

    <div className="metrics-layout">
      <article className="metrics-surface activity-surface"><header><div><h2>Atividade local</h2><p>Execuções iniciadas neste Korda nos últimos 84 dias</p></div><span>{metrics.windowRuns} na janela</span></header><Heatmap days={metrics.activity} /><footer><span>menos</span><i data-level="0" /><i data-level="1" /><i data-level="2" /><i data-level="3" /><i data-level="4" /><span>mais</span></footer></article>
      <article className="metrics-surface telemetry-surface"><header><div><h2>Consumo local por CLI e modelo</h2><p>{usage.days ? `Últimos ${usage.days} dias` : "Período indisponível"} · histórico salvo nesta máquina</p></div><Coins size={19} /></header><strong>{availableProviders.length ? formatTokens(totalTokens) : "Indisponível"}</strong>
        <div className="provider-usage-list">{providers.map((provider) => <div className={`provider-usage ${provider.available ? "" : "unavailable"}`} key={provider.id}><div className="provider-usage-summary"><span><b>{provider.label}</b><small>{provider.scope}</small></span><span><b>{provider.available ? formatTokens(provider.totalTokens) : "Sem dados"}</b><small>{provider.available ? costLabel(provider) : "fonte local ausente"}</small></span></div>{provider.models?.length > 0 && <div className="model-usage-list">{provider.models.map((model) => <div key={model.model}><span>{model.model}</span><span>{formatTokens(model.totalTokens)} · {costLabel(model)}</span></div>)}</div>}</div>)}</div>
        {!providers.length && <p>Nenhuma fonte de uso foi encontrada. Nenhum valor é estimado ou inventado.</p>}
      </article>
      <article className="metrics-surface agents-surface"><header><div><h2>Por agente</h2><p>Papel, sessão PTY e tráfego medido</p></div><span>{metrics.configuredAgents} configurados</span></header>
        <div className="agent-metrics-table" role="table" aria-label="Métricas por agente">
          <div className="agent-metrics-head" role="row"><span>Agente</span><span>Papel</span><span>Estado</span><span>Tempo</span><span>Entrada / saída</span></div>
          {metrics.agents.map((agent) => <div className="agent-metrics-row" role="row" key={agent.id}><span><Robot size={16} weight="duotone" /><b>{agent.title}</b><small>{agent.command}</small></span><span>{roleNames[agent.role] || agent.role}</span><span className={`session-state ${agent.state}`}><i />{agent.state === "active" ? "Ativo" : agent.state === "ended" ? "Encerrado" : "Sem PTY"}</span><span>{formatDuration(agent.duration)}</span><span>{formatBytes(agent.bytesIn)} / {formatBytes(agent.bytesOut)}</span></div>)}
          {!metrics.agents.length && <p className="metrics-empty">Adicione um agente ao canvas para acompanhar sua sessão.</p>}
        </div>
      </article>
    </div>
    <p className="metrics-footnote">Limites: contas conectadas. PTY, tráfego e consumo das CLIs: dados locais{usage.days ? ` dos últimos ${usage.days} dias` : ""}. Custos estimados e planos incluídos nunca são apresentados como cobrança real.</p>
  </section>;
}
