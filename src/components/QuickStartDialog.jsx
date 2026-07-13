import { useEffect, useId, useRef, useState } from "react";
import { Check, PaintBrush, Robot, TerminalWindow, X } from "@phosphor-icons/react";

const roles = [
  ["orchestrator", "Orquestrador"],
  ["executor", "Executor"],
  ["reviewer", "Revisor"],
  ["researcher", "Pesquisador"],
];

export function QuickStartDialog({
  open,
  mode = "agent",
  agents = [],
  loading = false,
  error = "",
  preview = false,
  selectedAgentId = "",
  selectedRole = "executor",
  command = "",
  title = "",
  onSelectAgent,
  onSelectRole,
  onCommandChange,
  onTitleChange,
  onModeChange,
  onClose,
  onConfirm,
}) {
  const dialogRef = useRef(null);
  const titleId = useId();
  const [tab, setTab] = useState("details");

  useEffect(() => {
    if (!open) return undefined;
    setTab("details");
    const previousFocus = document.activeElement;
    const dialog = dialogRef.current;
    dialog?.querySelector("[data-autofocus]")?.focus();
    const onKeyDown = (event) => {
      if (event.key === "Escape") return onClose?.();
      if (event.key !== "Tab" || !dialog) return;
      const focusable = [...dialog.querySelectorAll("button:not(:disabled), input:not(:disabled), select:not(:disabled), [tabindex]:not([tabindex='-1'])")];
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      previousFocus?.focus?.();
    };
  }, [open, onClose]);

  if (!open) return null;
  const choices = mode === "terminal"
    ? [{ id: "shell", name: "Shell", command: "", shell: true }, ...agents]
    : agents;
  const canCreate = !loading && Boolean(selectedAgentId);
  const choose = (choice) => {
    onSelectAgent?.(choice.id);
    onCommandChange?.(choice.command || "");
  };

  return (
    <div className="quick-start-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose?.()}>
      <section ref={dialogRef} className="quick-start-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <header className="quick-start-header">
          <span className="quick-start-heading-icon" aria-hidden="true">{mode === "agent" ? <Robot size={20} weight="duotone" /> : <TerminalWindow size={20} />}</span>
          <div className="quick-start-heading">
            <span className="quick-start-kicker">Korda Quick Start</span>
            <h2 id={titleId}>{mode === "agent" ? "Novo agente" : "Novo terminal"}</h2>
            <p>{mode === "agent" ? "Escolha a CLI e o papel no fluxo." : "Abra um shell ou uma CLI no canvas."}</p>
          </div>
          <button type="button" className="quick-start-icon-button" onClick={onClose} aria-label="Fechar"><X size={16} /></button>
        </header>

        <div className="quick-start-mode" aria-label="Tipo de bloco">
          <button data-autofocus type="button" className={mode === "agent" ? "active" : ""} aria-pressed={mode === "agent"} onClick={() => onModeChange?.("agent")}><Robot size={15} />Agente</button>
          <button type="button" className={mode === "terminal" ? "active" : ""} aria-pressed={mode === "terminal"} onClick={() => onModeChange?.("terminal")}><TerminalWindow size={15} />Terminal</button>
        </div>

        <div className="quick-start-tabs" role="tablist" aria-label="Configuração">
          <button type="button" role="tab" aria-selected={tab === "details"} className={tab === "details" ? "active" : ""} onClick={() => setTab("details")}>Detalhes</button>
          <button type="button" role="tab" aria-selected={tab === "appearance"} className={tab === "appearance" ? "active" : ""} onClick={() => setTab("appearance")}>Aparência</button>
        </div>

        {tab === "details" ? <form className="quick-start-body" onSubmit={(event) => { event.preventDefault(); if (canCreate) onConfirm?.(); }}>
          <div className="quick-start-section-title"><b>{mode === "agent" ? "CLI disponível" : "Sessão inicial"}</b><span>{preview ? "Prévia local" : "Detectado neste computador"}</span></div>
          <div className="quick-start-grid" role="radiogroup" aria-label={mode === "agent" ? "CLI do agente" : "Comando inicial"}>
            {loading && <p className="quick-start-state" role="status">Procurando CLIs instaladas…</p>}
            {!loading && choices.map((choice) => {
              const selected = selectedAgentId === choice.id;
              return <button key={choice.id} type="button" role="radio" aria-checked={selected} className={`quick-start-choice ${selected ? "selected" : ""}`} onClick={() => choose(choice)}>
                <span className="quick-start-choice-icon">{choice.shell ? <TerminalWindow size={18} /> : <Robot size={18} />}</span>
                <b>{choice.name}</b>
                <small title={choice.command || "Shell padrão"}>{choice.command || "Shell padrão"}{choice.simulated ? " · simulado" : ""}</small>
                {selected && <Check className="quick-start-check" size={14} weight="bold" aria-hidden="true" />}
              </button>;
            })}
            {!loading && !choices.length && <p className="quick-start-state">Nenhuma CLI compatível encontrada no PATH.</p>}
          </div>
          {error && <p className="quick-start-error" role="alert">{error}</p>}

          <div className="quick-start-fields">
            <label><span>Nome</span><input value={title} onChange={(event) => onTitleChange?.(event.target.value)} placeholder={mode === "agent" ? "Ex.: Revisor do projeto" : "Ex.: Terminal principal"} /></label>
            <label><span>Comando</span><input value={command} onChange={(event) => onCommandChange?.(event.target.value)} placeholder={mode === "agent" ? "Selecione uma CLI" : "Shell padrão"} spellCheck="false" readOnly={mode === "terminal" && selectedAgentId === "shell"} /></label>
            {mode === "agent" && <label><span>Papel</span><select value={selectedRole} onChange={(event) => onSelectRole?.(event.target.value)}>{roles.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>}
          </div>

          <footer className="quick-start-actions">
            <button type="button" onClick={onClose}>Cancelar</button>
            <button type="submit" className="primary" disabled={!canCreate}>Criar</button>
          </footer>
        </form> : <div className="quick-start-appearance" role="tabpanel">
          <span><PaintBrush size={22} /></span>
          <b>Aparência integrada</b>
          <p>Este bloco seguirá automaticamente o tema claro do Korda e manterá o terminal interno em alto contraste.</p>
          <footer className="quick-start-actions"><button type="button" onClick={() => setTab("details")}>Voltar aos detalhes</button></footer>
        </div>}
      </section>
    </div>
  );
}

export default QuickStartDialog;
