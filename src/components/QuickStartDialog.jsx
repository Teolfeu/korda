import { useEffect, useId, useRef, useState } from "react";
import {
  BracketsCurly,
  Check,
  Command,
  Crown,
  Cube,
  Hammer,
  Lightning,
  MagnifyingGlass,
  Moon,
  PaintBrush,
  PaperPlaneTilt,
  Robot,
  SealCheck,
  Sparkle,
  StarFour,
  Terminal,
  WarningCircle,
  Wrench,
  X,
} from "@phosphor-icons/react";

const roles = [
  ["orchestrator", "Orquestrador", Crown, "planeja e delega"],
  ["executor", "Executor", Hammer, "executa a tarefa"],
  ["reviewer", "Revisor", SealCheck, "valida o resultado"],
  ["researcher", "Pesquisador", MagnifyingGlass, "busca evidências"],
];

// Versão mínima do mapeamento de WorkbenchNodes.jsx (ícone + cor por CLI),
// duplicada para o diálogo não depender do módulo dos nós. As cores seguem
// os tokens --agent-* definidos em styles.css.
const cliVisuals = [
  ["codex", Cube, "#7c3aed"],
  ["claude", Sparkle, "#c2410c"],
  ["opencode", BracketsCurly, "#059669"],
  ["kimi", Moon, "#2563eb"],
  ["gemini", StarFour, "#0891b2"],
  ["hermes", PaperPlaneTilt, "#db2777"],
  ["grok", Lightning, "#334155"],
  ["aider", Wrench, "#57534e"],
];

function choiceVisual(choice) {
  if (choice.shell) return { Icon: Terminal, color: "#64748b", badge: "padrão" };
  const haystack = `${choice.id || ""} ${choice.command || ""}`.toLowerCase();
  const match = cliVisuals.find(([key]) => haystack.includes(key));
  const [, Icon = Command, color = "#2868d8"] = match || [];
  return { Icon, color, badge: choice.simulated ? "simulado" : "instalado" };
}

// Encurta o prefixo da pasta pessoal para o caminho caber no card.
function displayPath(path) {
  return typeof path === "string" ? path.replace(/^\/home\/[^/]+/, "~") : "";
}

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
  const commandHintId = useId();
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
  const commandReadOnly = mode === "terminal" && selectedAgentId === "shell";
  const choose = (choice) => {
    onSelectAgent?.(choice.id);
    onCommandChange?.(choice.command || "");
  };

  return (
    <div className="quick-start-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose?.()}>
      <section ref={dialogRef} className="quick-start-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <header className="quick-start-header">
          <span className="quick-start-heading-icon" aria-hidden="true">{mode === "agent" ? <Robot size={20} weight="duotone" /> : <Terminal size={20} weight="duotone" />}</span>
          <div className="quick-start-heading">
            <span className="quick-start-kicker">Korda Quick Start</span>
            <h2 id={titleId}>{mode === "agent" ? "Novo agente" : "Novo terminal"}</h2>
            <p>{mode === "agent" ? "Escolha a CLI, o papel e o nome do bloco." : "Abra um shell ou uma CLI no canvas."}</p>
          </div>
          <button type="button" className="quick-start-icon-button" onClick={onClose} aria-label="Fechar"><X size={16} /></button>
        </header>

        <div className="quick-start-mode" aria-label="Tipo de bloco">
          <button data-autofocus type="button" className={mode === "agent" ? "active" : ""} aria-pressed={mode === "agent"} onClick={() => onModeChange?.("agent")}><Robot size={15} weight={mode === "agent" ? "duotone" : "regular"} />Agente</button>
          <button type="button" className={mode === "terminal" ? "active" : ""} aria-pressed={mode === "terminal"} onClick={() => onModeChange?.("terminal")}><Terminal size={15} weight={mode === "terminal" ? "duotone" : "regular"} />Terminal</button>
        </div>

        <div className="quick-start-tabs" role="tablist" aria-label="Configuração">
          <button type="button" role="tab" aria-selected={tab === "details"} className={tab === "details" ? "active" : ""} onClick={() => setTab("details")}>Detalhes</button>
          <button type="button" role="tab" aria-selected={tab === "appearance"} className={tab === "appearance" ? "active" : ""} onClick={() => setTab("appearance")}>Aparência</button>
        </div>

        {tab === "details" ? <form className="quick-start-body" onSubmit={(event) => { event.preventDefault(); if (canCreate) onConfirm?.(); }}>
          <div className="quick-start-section-title"><b><i className="quick-start-step" aria-hidden="true">1</i>{mode === "agent" ? "Escolha a CLI" : "Escolha a sessão inicial"}</b><span>{preview ? "Prévia local" : "Detectado neste computador"}</span></div>
          <div className="quick-start-grid" role="radiogroup" aria-label={mode === "agent" ? "CLI do agente" : "Comando inicial"}>
            {loading && (
              <>
                <p className="quick-start-state quick-start-loading" role="status"><span className="quick-start-spinner" aria-hidden="true" />Procurando CLIs instaladas…</p>
                {["sk-a", "sk-b", "sk-c", "sk-d"].map((key) => <span key={key} className="quick-start-skeleton" aria-hidden="true" />)}
              </>
            )}
            {!loading && choices.map((choice) => {
              const selected = selectedAgentId === choice.id;
              const { Icon, color, badge } = choiceVisual(choice);
              const path = displayPath(choice.path);
              return <button key={choice.id} type="button" role="radio" aria-checked={selected} className={`quick-start-choice ${selected ? "selected" : ""}`} style={{ "--agent-color": color }} onClick={() => choose(choice)}>
                <span className="quick-start-choice-icon" aria-hidden="true"><Icon size={17} weight="duotone" /></span>
                <b><span className="quick-start-choice-name">{choice.name}</span><em className="quick-start-badge">{badge}</em></b>
                <small className="quick-start-choice-command" title={choice.command || "Shell padrão"}>{choice.command || "Shell padrão"}</small>
                {path && <small className="quick-start-choice-path" title={choice.path}>{path}</small>}
                {selected && <Check className="quick-start-check" size={14} weight="bold" aria-hidden="true" />}
              </button>;
            })}
            {!loading && !choices.length && (
              <div className="quick-start-empty" role="status">
                <b>Nenhuma CLI compatível foi encontrada no PATH.</b>
                <p>Instale uma CLI como Codex, Claude Code, OpenCode, Hermes ou Grok e reabra este diálogo — ela aparece aqui automaticamente.</p>
              </div>
            )}
          </div>
          {error && (
            <div className="quick-start-error" role="alert">
              <WarningCircle size={15} weight="fill" aria-hidden="true" />
              <span>{error}<small>Confirme que o executável está instalado e acessível no PATH do sistema e reabra o diálogo para detectar de novo.</small></span>
            </div>
          )}

          {mode === "agent" && (
            <>
              <div className="quick-start-section-title"><b><i className="quick-start-step" aria-hidden="true">2</i>Defina o papel</b><span>Como o bloco participa do fluxo</span></div>
              <div className="quick-start-roles" role="radiogroup" aria-label="Papel do agente">
                {roles.map(([value, label, RoleIcon, hint]) => {
                  const active = selectedRole === value;
                  return <button key={value} type="button" role="radio" aria-checked={active} className={active ? "selected" : ""} onClick={() => onSelectRole?.(value)}>
                    <RoleIcon size={15} weight={active ? "duotone" : "regular"} aria-hidden="true" />
                    <b>{label}</b>
                    <small>{hint}</small>
                  </button>;
                })}
              </div>
            </>
          )}

          <div className="quick-start-section-title"><b><i className="quick-start-step" aria-hidden="true">{mode === "agent" ? 3 : 2}</i>Nome e comando</b><span>Como o bloco aparece no canvas</span></div>
          <div className="quick-start-fields">
            <label><span>Nome</span><input value={title} onChange={(event) => onTitleChange?.(event.target.value)} placeholder={mode === "agent" ? "Ex.: Revisor do projeto" : "Ex.: Terminal principal"} /></label>
            <label className="quick-start-command-field"><span>Comando</span><input value={command} onChange={(event) => onCommandChange?.(event.target.value)} placeholder={mode === "agent" ? "Selecione uma CLI" : "Shell padrão"} spellCheck="false" readOnly={commandReadOnly} aria-describedby={commandHintId} /><small className="quick-start-hint" id={commandHintId}>{commandReadOnly ? "Shell padrão do sistema (somente leitura)." : "Aceita qualquer executável do seu PATH, ex.: kimi."}</small></label>
          </div>

          <footer className="quick-start-actions">
            <button type="button" onClick={onClose}>Cancelar</button>
            <button type="submit" className="primary" disabled={!canCreate}>Criar</button>
          </footer>
        </form> : <div className="quick-start-appearance" role="tabpanel">
          <span><PaintBrush size={22} /></span>
          <b>Aparência integrada</b>
          <p>Cada bloco ganha automaticamente o ícone e a cor da CLI escolhida, sempre sobre o tema claro do Korda e com o terminal interno em alto contraste.</p>
          <footer className="quick-start-actions"><button type="button" onClick={() => setTab("details")}>Voltar aos detalhes</button></footer>
        </div>}
      </section>
    </div>
  );
}

export default QuickStartDialog;
