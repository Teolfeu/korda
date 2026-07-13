import { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle,
  FolderOpen,
  Robot,
  ShareNetwork,
  TerminalWindow,
  X,
} from "@phosphor-icons/react";

const steps = [
  {
    icon: ShareNetwork,
    eyebrow: "Bem-vindo",
    title: "Seu trabalho, agentes e contexto no mesmo canvas",
    description: "O Korda reúne terminais, agentes, navegador, notas e arquivos em um espaço visual local. Cada bloco continua sendo uma ferramenta real.",
    points: ["Organize livremente no canvas", "Acompanhe atividade sem esconder os terminais", "O contexto permanece na sua máquina"],
  },
  {
    icon: FolderOpen,
    eyebrow: "Workspace",
    title: "Abra uma pasta e trabalhe nos arquivos",
    description: "O Explorer acompanha a pasta local ao vivo. Abra um arquivo em uma aba, edite e salve sem sair do Korda.",
    points: ["Árvore de arquivos atualizada ao vivo", "Editor com revisão e proteção contra conflitos", "Alterações não salvas ficam sinalizadas"],
    action: "workspace",
  },
  {
    icon: Robot,
    eyebrow: "Agentes",
    title: "Adicione as CLIs instaladas e defina seus papéis",
    description: "Escolha um agente detectado na máquina e diga se ele será Orquestrador, Executor, Pesquisador ou Revisor. Um terminal comum também pode fazer parte do trabalho.",
    points: ["Orquestrador coordena o fluxo", "Executores e pesquisadores recebem tarefas", "Revisor valida quando estiver conectado"],
    action: "agents",
  },
  {
    icon: ShareNetwork,
    eyebrow: "Cordas",
    title: "Conecte os blocos para autorizar a colaboração",
    description: "Arraste uma corda entre as bordas dos agentes. A topologia informa automaticamente quem pode conversar e qual papel cada participante exerce.",
    points: ["Cordas definem permissões de comunicação", "Pedidos e respostas animam o fluxo real", "Conexões podem ser removidas diretamente no canvas"],
  },
  {
    icon: CheckCircle,
    eyebrow: "Comece",
    title: "Escreva uma tarefa normal no Orquestrador",
    description: "Com os papéis conectados, descreva o que precisa no terminal do Orquestrador. Ele pode delegar, aguardar respostas e consolidar o resultado sem você citar comandos internos.",
    points: ["Use tarefas normais para o trabalho cotidiano", "Iniciar missão é opcional para prazo, revisão e conclusão formal", "Acompanhe o fluxo pelas cordas e pelo histórico operacional"],
  },
];

export function OnboardingGuide({ open = false, onDismiss, onOpenWorkspace, onAddAgent, onAddTerminal }) {
  const [stepIndex, setStepIndex] = useState(0);
  const dialogRef = useRef(null);
  const closeRef = useRef(null);
  const dismissRef = useRef(onDismiss);

  useEffect(() => {
    dismissRef.current = onDismiss;
  }, [onDismiss]);

  useEffect(() => {
    if (!open) return undefined;
    const previousFocus = document.activeElement;
    setStepIndex(0);
    const frame = window.requestAnimationFrame(() => closeRef.current?.focus());
    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        dismissRef.current?.();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = [...(dialogRef.current?.querySelectorAll('button:not(:disabled), [href], input:not(:disabled), [tabindex]:not([tabindex="-1"])') || [])];
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener("keydown", handleKeyDown);
      previousFocus?.focus?.();
    };
  }, [open]);

  if (!open) return null;
  const step = steps[stepIndex];
  const StepIcon = step.icon;
  const lastStep = stepIndex === steps.length - 1;

  return <div className="onboarding-backdrop" role="presentation">
    <section ref={dialogRef} className="onboarding-dialog" role="dialog" aria-modal="true" aria-labelledby="onboarding-title" aria-describedby="onboarding-description">
      <header className="onboarding-header">
        <div className="onboarding-brand"><span aria-hidden="true">K</span><b>Korda</b></div>
        <span className="onboarding-counter">Passo {stepIndex + 1} de {steps.length}</span>
        <button ref={closeRef} type="button" className="onboarding-close" onClick={onDismiss} aria-label="Fechar guia" title="Fechar guia"><X size={16} /></button>
      </header>

      <div className="onboarding-progress" aria-label={`Progresso: ${stepIndex + 1} de ${steps.length}`}>
        {steps.map((item, index) => <span key={item.eyebrow} className={index <= stepIndex ? "complete" : ""} aria-current={index === stepIndex ? "step" : undefined} />)}
      </div>

      <div className="onboarding-body">
        <div className="onboarding-visual" aria-hidden="true"><StepIcon size={34} weight="duotone" /><i /><i /><i /></div>
        <div className="onboarding-copy">
          <span className="onboarding-eyebrow">{step.eyebrow}</span>
          <h2 id="onboarding-title">{step.title}</h2>
          <p id="onboarding-description">{step.description}</p>
          <ul>{step.points.map((point) => <li key={point}><CheckCircle size={15} weight="fill" />{point}</li>)}</ul>
          {step.action === "workspace" && <div className="onboarding-context-actions"><button type="button" className="primary" onClick={onOpenWorkspace}><FolderOpen size={15} />Abrir pasta</button></div>}
          {step.action === "agents" && <div className="onboarding-context-actions"><button type="button" className="primary" onClick={onAddAgent}><Robot size={15} />Adicionar agente</button><button type="button" onClick={onAddTerminal}><TerminalWindow size={15} />Novo terminal</button></div>}
        </div>
      </div>

      <footer className="onboarding-footer">
        <button type="button" className="onboarding-skip" onClick={onDismiss}>Pular guia</button>
        <div>
          <button type="button" onClick={() => setStepIndex((value) => Math.max(0, value - 1))} disabled={stepIndex === 0}><ArrowLeft size={14} />Voltar</button>
          <button type="button" className="primary" onClick={() => lastStep ? onDismiss?.() : setStepIndex((value) => Math.min(steps.length - 1, value + 1))}>{lastStep ? <CheckCircle size={15} weight="fill" /> : null}{lastStep ? "Concluir" : "Próximo"}{!lastStep && <ArrowRight size={14} />}</button>
        </div>
      </footer>
    </section>
  </div>;
}

export default OnboardingGuide;
