import { useEffect, useId, useRef, useState } from "react";
import { Check, Crosshair, Play, Robot, ShieldCheck, X } from "@phosphor-icons/react";
import "../mission-polish.css";

export function MissionDialog({ open, agents = [], error = "", onClose, onStart }) {
  const dialogRef = useRef(null);
  const titleId = useId();
  const [objective, setObjective] = useState("");
  const [successCriteria, setSuccessCriteria] = useState("");
  const [timeoutMinutes, setTimeoutMinutes] = useState(15);
  const reviewers = agents.filter((agent) => agent.role === "reviewer");
  const [reviewerId, setReviewerId] = useState("");
  const [selectedIds, setSelectedIds] = useState([]);
  const closeCallback = useRef(onClose);

  useEffect(() => {
    closeCallback.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!open) return undefined;
    setObjective("");
    setSuccessCriteria("");
    setTimeoutMinutes(15);
    setReviewerId(reviewers[0]?.id || "");
    setSelectedIds(agents.map((agent) => agent.id));
    const previousFocus = document.activeElement;
    dialogRef.current?.querySelector("textarea")?.focus();
    const onKeyDown = (event) => event.key === "Escape" && closeCallback.current?.();
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      previousFocus?.focus?.();
    };
  }, [open]);

  if (!open) return null;
  const canStart = objective.trim().length > 0;
  return <div className="quick-start-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose?.()}>
    <section ref={dialogRef} className="quick-start-dialog mission-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId}>
      <header className="quick-start-header"><span className="mission-mark" aria-hidden="true"><Crosshair size={19} weight="duotone" /></span><div><span className="quick-start-kicker">Korda Run</span><h2 id={titleId}>Configurar missão</h2></div><span className="mission-local"><ShieldCheck size={13} weight="fill" />Contexto local</span><button type="button" className="quick-start-icon-button" onClick={onClose} aria-label="Fechar"><X size={16} /></button></header>
      <form className="mission-body" onSubmit={(event) => {
        event.preventDefault();
        if (!canStart) return;
        onStart?.({ objective: objective.trim(), successCriteria: successCriteria.trim(), timeoutMs: timeoutMinutes * 60_000, reviewerId: reviewerId || null, participantIds: selectedIds });
      }}>
        <label><span>Objetivo</span><textarea value={objective} onChange={(event) => setObjective(event.target.value)} maxLength={4_000} placeholder="O que o Orquestrador deve entregar?" /></label>
        <label><span>Critério de conclusão</span><textarea value={successCriteria} onChange={(event) => setSuccessCriteria(event.target.value)} maxLength={2_000} placeholder="Ex.: testes passando e revisão aprovada" /></label>
        <div className="mission-options"><label><span>Prazo máximo</span><select value={timeoutMinutes} onChange={(event) => setTimeoutMinutes(Number(event.target.value))}><option value="5">5 minutos</option><option value="15">15 minutos</option><option value="30">30 minutos</option><option value="60">1 hora</option></select></label><label><span>Revisão</span><select value={reviewerId} onChange={(event) => { const value = event.target.value; setReviewerId(value); if (value) setSelectedIds((current) => [...new Set([...current, value])]); }}><option value="">Sem aprovação obrigatória</option>{reviewers.map((reviewer) => <option key={reviewer.id} value={reviewer.id}>{reviewer.title}</option>)}</select><small>{reviewerId ? "A conclusão exigirá aprovação" : "O Orquestrador poderá concluir diretamente"}</small></label></div>
        <div className="mission-agents"><span>AGENTES DA MISSÃO</span>{agents.map((agent) => { const selected = selectedIds.includes(agent.id); const locked = agent.role === "orchestrator" || agent.id === reviewerId; return <button type="button" aria-pressed={selected} className={selected ? "selected" : ""} key={agent.id} onClick={() => !locked && setSelectedIds((current) => current.includes(agent.id) ? current.filter((id) => id !== agent.id) : [...current, agent.id])}><Robot size={15} weight="duotone" /><b>{agent.title}</b><small>{agent.roleLabel || agent.role}{locked ? " · obrigatório" : ""}</small>{selected && <Check className="mission-check" size={12} weight="bold" aria-hidden="true" />}</button>; })}</div>
        {error && <p className="quick-start-error" role="alert">{error}</p>}
        <footer className="quick-start-actions"><button type="button" onClick={onClose}>Cancelar</button><button type="submit" className="primary" disabled={!canStart}><Play size={13} weight="fill" />Iniciar missão</button></footer>
      </form>
    </section>
  </div>;
}

export default MissionDialog;
