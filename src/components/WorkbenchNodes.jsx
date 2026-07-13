import { useEffect, useRef, useState } from "react";
import {
  ArrowClockwise,
  Brain,
  Browser,
  CheckCircle,
  DotsSixVertical,
  FileTs,
  Robot,
  Stop,
  TerminalWindow,
  X,
} from "@phosphor-icons/react";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import { Handle, NodeResizer, Position, useUpdateNodeInternals } from "@xyflow/react";
import { shouldInterceptTerminalSelection, terminalCellFromPointer, terminalPointerInsideRect, terminalSelectionRange } from "../terminal-selection.js";
import { sanitizeClipboardText, sanitizeTerminalPaste, terminalClipboardShortcut } from "../terminal-clipboard.js";
import { createTerminalStartupTracker } from "../terminal-startup.js";
import { createTerminalVisualOutputTracker, hasTerminalVisualOutput } from "../terminal-visual-output.js";
import {
  claimTerminalSession,
  forgetTerminalSession,
  releaseTerminalSession,
  retainTerminalSession,
} from "../terminal-session-registry.js";
import "@xterm/xterm/css/xterm.css";

const tone = { running: "green", waiting: "amber", ready: "blue", idle: "gray" };

function NodeClose({ onRemove }) {
  return (
    <button
      className="node-close nodrag"
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => {
        event.stopPropagation();
        onRemove();
      }}
      aria-label="Fechar nó"
      title="Fechar nó"
    >
      <X size={14} />
    </button>
  );
}

function NodeDragHandle({ label }) {
  return <span className="node-drag-handle" title={label}><DotsSixVertical size={16} weight="bold" /></span>;
}

function Status({ value = "Pronto", statusTone = "ready" }) {
  return <span className={`node-status ${tone[statusTone] || "gray"}`} title={`Estado: ${value}`}><i />{value}</span>;
}

function NodeIcon({ kind }) {
  if (kind === "claude") return <Robot size={18} weight="duotone" />;
  if (kind === "terminal") return <TerminalWindow size={18} />;
  return <Brain size={18} weight="duotone" />;
}

function TerminalPane({ nodeId, feed = "", cwd, command, enabled = true, restartKey = 0, onTerminalSession }) {
  const hostRef = useRef(null);
  const termRef = useRef(null);
  const backendId = useRef(null);
  const demoLine = useRef("");
  const sessionCallback = useRef(onTerminalSession);
  const clipboardActions = useRef(null);
  const [startupLabel, setStartupLabel] = useState("");
  const [contextMenu, setContextMenu] = useState(null);

  useEffect(() => {
    sessionCallback.current = onTerminalSession;
  }, [onTerminalSession]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const terminal = new Terminal({
      allowTransparency: false,
      cursorStyle: "block",
      cursorBlink: true,
      convertEol: false,
      drawBoldTextInBrightColors: true,
      fontFamily: '"JetBrains Mono", "Noto Sans Mono", "Liberation Mono", monospace',
      fontSize: 14,
      fontWeight: "400",
      fontWeightBold: "700",
      letterSpacing: 0,
      lineHeight: 1.25,
      minimumContrastRatio: 7,
      scrollback: 5000,
      scrollOnUserInput: true,
      theme: {
        background: "#0c0e12",
        foreground: "#e6edf3",
        cursor: "#f0f6fc",
        cursorAccent: "#0c0e12",
        selectionBackground: "#264f78",
        selectionForeground: "#ffffff",
        black: "#1f242c",
        red: "#ff7b72",
        green: "#7ee787",
        yellow: "#e3b341",
        blue: "#79c0ff",
        magenta: "#d2a8ff",
        cyan: "#56d4dd",
        white: "#e6edf3",
        brightBlack: "#8b949e",
        brightRed: "#ffa198",
        brightGreen: "#aff5b4",
        brightYellow: "#f2cc60",
        brightBlue: "#a5d6ff",
        brightMagenta: "#e2c5ff",
        brightCyan: "#b3f0ff",
        brightWhite: "#ffffff",
      },
    });
    const fit = new FitAddon();
    terminal.loadAddon(fit);
    terminal.open(host);
    try { fit.fit(); } catch { /* the node can still be hidden during layout */ }
    termRef.current = terminal;
    const api = window.kordaDesktop;
    const copySelection = async () => {
      const selected = sanitizeClipboardText(terminal.getSelection());
      if (!selected) return false;
      if (api?.isDesktop && typeof api.writeClipboardText === "function") {
        await api.writeClipboardText(selected);
      } else if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(selected);
      } else {
        throw new Error("Área de transferência indisponível neste navegador.");
      }
      return true;
    };
    const pasteClipboard = async () => {
      let text;
      if (api?.isDesktop && typeof api.readClipboardText === "function") {
        text = await api.readClipboardText();
      } else if (navigator.clipboard?.readText) {
        text = await navigator.clipboard.readText();
      } else {
        throw new Error("Área de transferência indisponível neste navegador.");
      }
      const paste = sanitizeTerminalPaste(text);
      if (!paste) return false;
      // A API pública do xterm aplica bracketed paste quando o TUI o habilita
      // e entrega o resultado pelo onData já conectado ao PTY.
      terminal.paste(paste);
      terminal.focus();
      return true;
    };
    const selectAll = () => {
      terminal.selectAll();
      terminal.focus();
      return true;
    };
    const reportClipboardError = (error) => {
      terminal.writeln(`\r\nFalha na área de transferência: ${error?.message || String(error)}`);
    };
    clipboardActions.current = {
      copy: () => copySelection().catch(reportClipboardError),
      paste: () => pasteClipboard().catch(reportClipboardError),
      selectAll,
    };
    terminal.attachCustomKeyEventHandler((event) => {
      const action = terminalClipboardShortcut(event);
      if (!action) return true;
      event.preventDefault();
      event.stopPropagation();
      void clipboardActions.current?.[action]?.();
      return false;
    });
    let unsubscribe;
    let unsubscribeExit;
    let cancelled = false;
    let startupSessionId = null;
    let readySent = false;
    let sessionResolved = false;
    let blankTimedOut = false;
    let startupTimer;
    const liveVisualOutput = createTerminalVisualOutputTracker();
    let sawVisualOutput = false;
    let pendingEvents = [];
    let fallbackMode = api?.isDesktop ? "conectando" : "simulado";
    const showFallback = (mode, message) => {
      fallbackMode = mode;
      setStartupLabel("");
      terminal.write("\u001b[2J\u001b[3J\u001b[H");
      terminal.writeln(message);
      if (command) terminal.writeln(`Comando configurado: ${command}`);
      terminal.write(`${mode}> `);
    };
    const start = async () => {
      if (!api?.isDesktop) {
        showFallback("simulado", "SIMULADO — nada é executado aqui.");
        sessionCallback.current?.(nodeId, null);
        return;
      }
      if (!enabled) {
        const previous = forgetTerminalSession(nodeId);
        if (previous) await api.closeTerminal(previous.id).catch(() => {});
        showFallback("parado", "Processo parado pelo usuário.");
        sessionCallback.current?.(nodeId, null, { phase: "stopped" });
        return;
      }
      if (!cwd) {
        showFallback("inativo", "Terminal inativo — abra uma pasta para iniciar o PTY.");
        sessionCallback.current?.(nodeId, null);
        return;
      }
      setStartupLabel(command ? `Iniciando ${command}…` : "Iniciando terminal…");
      startupTimer = window.setTimeout(() => {
        if (cancelled || readySent || !backendId.current) return;
        blankTimedOut = true;
        const blankSessionId = backendId.current;
        backendId.current = null;
        forgetTerminalSession(nodeId, blankSessionId);
        unsubscribe?.();
        unsubscribeExit?.();
        unsubscribe = undefined;
        unsubscribeExit = undefined;
        showFallback("falha", `${command || "O processo"} iniciou, mas não produziu uma tela legível em 15 segundos.`);
        sessionCallback.current?.(nodeId, null, { phase: "failed", reason: "blank-output" });
        void api.closeTerminal(blankSessionId).catch(() => {});
      }, 15_000);
      const retained = claimTerminalSession(nodeId, { cwd, command: command || null, restartKey });
      if (retained) {
        backendId.current = retained.id;
        startupSessionId = retained.id;
        unsubscribe = api.onTerminalData((payload) => {
          if (payload?.id !== retained.id) return;
          const frameVisible = liveVisualOutput.push(payload.data);
          if (frameVisible) sawVisualOutput = true;
          if (!sessionResolved) pendingEvents.push(payload);
          else {
            terminal.write(payload.data);
            if (frameVisible && !readySent) {
              readySent = true;
              setStartupLabel("");
              sessionCallback.current?.(nodeId, retained.id, { phase: "ready", reattached: true });
            }
          }
        });
        unsubscribeExit = api.onTerminalExit?.((payload) => {
          if (payload?.id !== retained.id) return;
          forgetTerminalSession(nodeId, retained.id);
          if (backendId.current === payload.id) backendId.current = null;
          setStartupLabel("");
          sessionCallback.current?.(nodeId, null, { phase: "exit", exitCode: payload.exitCode });
        });
        try {
          const snapshot = await api.terminalSnapshot(retained.id);
          if (cancelled) return;
          if (snapshot?.data) {
            if (hasTerminalVisualOutput(snapshot.data)) sawVisualOutput = true;
            terminal.write(snapshot.data);
          }
          const revision = Number(snapshot?.sequence) || 0;
          for (const payload of pendingEvents) {
            if ((Number(payload.sequence) || 0) > revision) terminal.write(payload.data);
          }
          pendingEvents = [];
          sessionResolved = true;
          if (snapshot?.exited) {
            forgetTerminalSession(nodeId, retained.id);
            backendId.current = null;
            setStartupLabel("");
            sessionCallback.current?.(nodeId, null, { phase: "exit", exitCode: snapshot.exitCode });
            return;
          }
          if (sawVisualOutput && !readySent) {
            readySent = true;
            setStartupLabel("");
            sessionCallback.current?.(nodeId, retained.id, { phase: "ready", reattached: true });
          }
          return;
        } catch {
          unsubscribe?.();
          unsubscribeExit?.();
          unsubscribe = undefined;
          unsubscribeExit = undefined;
          forgetTerminalSession(nodeId, retained.id);
          await api.closeTerminal(retained.id).catch(() => {});
          backendId.current = null;
        }
      }
      sessionCallback.current?.(nodeId, null, { phase: restartKey > 0 ? "restarting" : "starting" });
      const stale = forgetTerminalSession(nodeId);
      if (stale) await api.closeTerminal(stale.id).catch(() => {});
      const sessionId = `${nodeId}-${crypto.randomUUID().slice(0, 8)}`;
      startupSessionId = sessionId;
      const startup = createTerminalStartupTracker(sessionId);
      // xterm pode responder a consultas do processo (por exemplo, DSR/CSI 6n)
      // antes de o invoke de criação voltar. O OpenCode depende dessas respostas
      // durante o primeiro desenho; roteie-as para o ID reservado desde já.
      backendId.current = sessionId;
      terminal.clear();
      unsubscribe = api.onTerminalData(({ id, data }) => {
        if (!startup.accepts({ id })) return;
        const frameVisible = liveVisualOutput.push(data);
        if (frameVisible) sawVisualOutput = true;
        terminal.write(data);
        if (sessionResolved && frameVisible && !readySent && backendId.current === id) {
          readySent = true;
          setStartupLabel("");
          sessionCallback.current?.(nodeId, id, { phase: "ready" });
        }
      });
      unsubscribeExit = api.onTerminalExit?.((payload) => {
        if (!startup.recordExit(payload)) return;
        forgetTerminalSession(nodeId, payload.id);
        if (backendId.current === payload.id) backendId.current = null;
        setStartupLabel("");
        sessionCallback.current?.(nodeId, null, { phase: "exit", exitCode: payload.exitCode });
      });
      const session = await api.createTerminal({
        id: sessionId,
        nodeId,
        cwd,
        command,
        cols: Math.min(500, terminal.cols),
        rows: Math.min(200, terminal.rows),
      });
      if (blankTimedOut) {
        await api.closeTerminal(session.id).catch(() => {});
        return;
      }
      const startupResult = startup.complete(session);
      if (cancelled) {
        await api.closeTerminal(session.id);
        return;
      }
      if (!startupResult.ready) {
        if (backendId.current === sessionId) backendId.current = null;
        return;
      }
      backendId.current = session.id;
      retainTerminalSession(nodeId, { id: session.id, cwd, command: command || null, restartKey });
      sessionResolved = true;
      if (sawVisualOutput && !readySent) {
        readySent = true;
        setStartupLabel("");
        sessionCallback.current?.(nodeId, session.id, { phase: "ready" });
      }
    };
    start().catch((error) => {
      if (backendId.current === startupSessionId) backendId.current = null;
      forgetTerminalSession(nodeId, startupSessionId);
      setStartupLabel("");
      sessionCallback.current?.(nodeId, null, { phase: "failed" });
      if (!cancelled) terminal.writeln(`\r\nFalha ao abrir PTY: ${error.message}`);
    });
    const inputDisposable = terminal.onData((data) => {
      if (backendId.current) {
        void api.writeTerminal(backendId.current, data).catch((error) => {
          terminal.writeln(`\r\nFalha ao enviar comando: ${error.message}`);
        });
        return;
      }
      if (data === "\r") {
        terminal.write(`\r\n[${fallbackMode}] nada foi executado\r\n${fallbackMode}> `);
        demoLine.current = "";
      } else if (data === "\u007f") {
        if (demoLine.current) {
          demoLine.current = demoLine.current.slice(0, -1);
          terminal.write("\b \b");
        }
      } else {
        demoLine.current += data;
        terminal.write(data);
      }
    });
    let resizeFrame;
    const resize = new ResizeObserver(() => {
      window.cancelAnimationFrame(resizeFrame);
      resizeFrame = window.requestAnimationFrame(() => {
        try {
          fit.fit();
          terminal.refresh(0, Math.max(0, terminal.rows - 1));
          if (backendId.current) {
            void api.resizeTerminal(
              backendId.current,
              Math.min(500, terminal.cols),
              Math.min(200, terminal.rows),
            ).catch(() => {});
          }
        } catch { /* hidden node during layout */ }
      });
    });
    resize.observe(host);
    let selectionAnchor = null;
    let selectionPointerId = null;
    let selectionActive = false;
    let previousUserSelect = "";
    const screenRect = () => host.querySelector(".xterm-screen")?.getBoundingClientRect();
    const pointerCell = (event) => terminalCellFromPointer({
      clientX: event.clientX,
      clientY: event.clientY,
      rect: screenRect(),
      cols: terminal.cols,
      rows: terminal.rows,
      viewportY: terminal.buffer.active.viewportY,
    });
    const updateSelection = (event) => {
      if (!selectionActive || selectionAnchor === null || event.pointerId !== selectionPointerId) return;
      event.preventDefault();
      event.stopPropagation();
      const focus = pointerCell(event);
      const range = terminalSelectionRange(selectionAnchor, focus, terminal.cols);
      if (range) terminal.select(range.column, range.row, range.length);
      else terminal.clearSelection();
    };
    const finishSelection = (event, update = true) => {
      if (!selectionActive || event.pointerId !== selectionPointerId) return;
      if (update) updateSelection(event);
      event.preventDefault?.();
      event.stopPropagation?.();
      const completedPointerId = selectionPointerId;
      host.style.userSelect = previousUserSelect;
      selectionActive = false;
      selectionAnchor = null;
      selectionPointerId = null;
      if (host.hasPointerCapture?.(completedPointerId)) {
        try { host.releasePointerCapture(completedPointerId); } catch { /* captura já liberada */ }
      }
      terminal.focus();
    };
    const beginSelection = (event) => {
      const rect = screenRect();
      if (!shouldInterceptTerminalSelection({
        button: event.button,
        insideScreen: terminalPointerInsideRect({ clientX: event.clientX, clientY: event.clientY, rect }),
        mouseTrackingMode: terminal.modes.mouseTrackingMode,
        shiftKey: event.shiftKey,
      })) return;
      const anchor = terminalCellFromPointer({
        clientX: event.clientX,
        clientY: event.clientY,
        rect,
        cols: terminal.cols,
        rows: terminal.rows,
        viewportY: terminal.buffer.active.viewportY,
      });
      if (!anchor) return;
      event.preventDefault();
      event.stopPropagation();
      // A seleção é inteiramente calculada em coordenadas visuais. Capturar o
      // ponteiro mantém o arraste no terminal mesmo fora da tela e impede o
      // React Flow / DOM de iniciar uma seleção no cabeçalho do bloco.
      previousUserSelect = host.style.userSelect;
      host.style.userSelect = "none";
      document.getSelection()?.removeAllRanges();
      selectionAnchor = anchor;
      selectionPointerId = event.pointerId;
      selectionActive = true;
      try { host.setPointerCapture(event.pointerId); } catch { /* fallback usa os eventos do host */ }
      // A click positions the caret only; selection begins after actual movement.
      terminal.clearSelection();
    };
    // xterm starts its built-in selection from a native `mousedown`. Its
    // coordinate mapper uses untransformed cell dimensions, so under React
    // Flow's scale it races this pointer-based mapper and replaces the correct
    // selection with an offset one. Stop only that native selection path; TUI
    // mouse reporting still reaches xterm unless Shift explicitly overrides it.
    const suppressUnscaledXtermSelection = (event) => {
      if (!selectionActive) return;
      event.preventDefault();
      event.stopImmediatePropagation();
    };
    host.addEventListener("pointerdown", beginSelection, true);
    host.addEventListener("pointermove", updateSelection, true);
    host.addEventListener("pointerup", finishSelection, true);
    host.addEventListener("pointercancel", finishSelection, true);
    host.addEventListener("mousedown", suppressUnscaledXtermSelection, true);
    const lostPointerCapture = (event) => finishSelection(event, false);
    host.addEventListener("lostpointercapture", lostPointerCapture, true);
    return () => {
      cancelled = true;
      window.clearTimeout(startupTimer);
      window.cancelAnimationFrame(resizeFrame);
      resize.disconnect();
      host.removeEventListener("pointerdown", beginSelection, true);
      host.removeEventListener("pointermove", updateSelection, true);
      host.removeEventListener("pointerup", finishSelection, true);
      host.removeEventListener("pointercancel", finishSelection, true);
      host.removeEventListener("lostpointercapture", lostPointerCapture, true);
      host.removeEventListener("mousedown", suppressUnscaledXtermSelection, true);
      host.style.userSelect = previousUserSelect;
      inputDisposable.dispose();
      unsubscribe?.();
      unsubscribeExit?.();
      if (backendId.current) releaseTerminalSession(nodeId, (id) => api.closeTerminal(id), 2_000, backendId.current);
      terminal.dispose();
      termRef.current = null;
      clipboardActions.current = null;
    };
  }, [command, cwd, enabled, nodeId, restartKey]);

  useEffect(() => {
    if (feed && termRef.current) termRef.current.writeln(`\r\n${feed}`);
  }, [feed]);

  const containCanvasEvent = (event) => event.stopPropagation();
  const runClipboardAction = (action) => {
    setContextMenu(null);
    void clipboardActions.current?.[action]?.();
  };
  return (
    <div style={{ position: "relative", minWidth: 0, minHeight: 0, flex: "1 1 105px", display: "flex" }}>
      <div
        ref={hostRef}
        className="terminal-pane nodrag nowheel"
        aria-label="Terminal interativo"
        onPointerDown={(event) => {
          containCanvasEvent(event);
          if (event.button !== 2) setContextMenu(null);
        }}
        onMouseDown={containCanvasEvent}
        onClick={(event) => {
          event.stopPropagation();
          termRef.current?.focus();
        }}
        onDoubleClick={containCanvasEvent}
        onContextMenu={(event) => {
          event.preventDefault();
          event.stopPropagation();
          const bounds = event.currentTarget.getBoundingClientRect();
          setContextMenu({
            x: Math.max(4, Math.min(event.clientX - bounds.left, bounds.width - 160)),
            y: Math.max(4, Math.min(event.clientY - bounds.top, bounds.height - 112)),
          });
        }}
      />
      {contextMenu && (
        <div
          role="menu"
          aria-label="Ações do terminal"
          className="nodrag nowheel"
          onPointerDown={containCanvasEvent}
          onMouseDown={containCanvasEvent}
          onContextMenu={(event) => { event.preventDefault(); event.stopPropagation(); }}
          style={{ position: "absolute", zIndex: 40, left: contextMenu.x, top: contextMenu.y, width: 156, padding: 4, border: "1px solid #394351", borderRadius: 7, background: "#161a20", boxShadow: "0 10px 28px rgba(0,0,0,.42)", color: "#e6edf3", font: '500 12px/1.2 "Inter", sans-serif' }}
        >
          {[["copy", "Copiar", "Ctrl+Shift+C"], ["paste", "Colar", "Ctrl+Shift+V"], ["selectAll", "Selecionar tudo", ""]].map(([action, label, hint]) => (
            <button
              key={action}
              type="button"
              role="menuitem"
              onClick={() => runClipboardAction(action)}
              style={{ display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%", padding: "7px 8px", border: 0, borderRadius: 4, background: "transparent", color: "inherit", font: "inherit", textAlign: "left", cursor: "pointer" }}
            >
              <span>{label}</span><small style={{ color: "#8b949e", fontSize: 9 }}>{hint}</small>
            </button>
          ))}
        </div>
      )}
      {startupLabel && <div role="status" aria-live="polite" style={{ position: "absolute", inset: "6px 9px 9px", display: "grid", placeItems: "center", border: "1px solid #303844", borderRadius: 7, color: "#c9d7e8", background: "#0c0e12", fontFamily: '"JetBrains Mono", monospace', fontSize: 13, pointerEvents: "none" }}>{startupLabel}</div>}
    </div>
  );
}

const perimeterStops = [8, 20, 32, 44, 56, 68, 80, 92];
const perimeterSides = [
  ["top", Position.Top, "superior"],
  ["right", Position.Right, "direita"],
  ["bottom", Position.Bottom, "inferior"],
  ["left", Position.Left, "esquerda"],
];

function PerimeterHandles({ id, label }) {
  const updateNodeInternals = useUpdateNodeInternals();
  useEffect(() => {
    const timer = window.setTimeout(() => updateNodeInternals(id), 0);
    return () => window.clearTimeout(timer);
  }, [id, updateNodeInternals]);
  return perimeterSides.flatMap(([side, position, sideLabel]) => perimeterStops.map((stop, index) => {
    const pointLabel = `Conectar corda na borda ${sideLabel} de ${label}, ponto ${index + 1}`;
    const keyboardHandle = index === 3;
    return (
      <Handle
        key={`${side}-${stop}`}
        id={`borda-${side}-${stop}`}
        type="source"
        position={position}
        className={`rope-handle rope-handle-${side}`}
        style={side === "top" || side === "bottom" ? { left: `${stop}%` } : { top: `${stop}%` }}
        aria-label={keyboardHandle ? pointLabel : undefined}
        aria-hidden={keyboardHandle ? undefined : true}
        role={keyboardHandle ? "button" : undefined}
        title={pointLabel}
        tabIndex={keyboardHandle ? 0 : -1}
        onKeyDown={keyboardHandle ? (event) => {
          if (event.key !== "Enter" && event.key !== " ") return;
          event.preventDefault();
          event.currentTarget.click();
        } : undefined}
      />
    );
  }));
}

function ResizeHandles({ selected, minWidth, minHeight }) {
  return <NodeResizer isVisible={selected} minWidth={minWidth} minHeight={minHeight} color="#2868d8" handleClassName="node-resize-handle" lineClassName="node-resize-line" />;
}

export function AgentNode({ id, data, selected }) {
  return (
    <article className={`flow-node agent-node ${selected ? "selected" : ""}`} style={{ "--accent": data.accent || "#1677ff" }}>
      <ResizeHandles selected={selected} minWidth={560} minHeight={380} />
      <PerimeterHandles id={id} label={data.terminal ? "terminal" : "agente"} />
      <Handle id="input" type="target" position={Position.Top} />
      <header>
        <span className="node-title"><NodeIcon kind={data.kind} /><span>{data.title}</span>{data.roleLabel && <small className="node-role" title={`Papel: ${data.roleLabel}`}>{data.roleLabel}</small>}</span>
        <Status value={data.status} statusTone={data.statusTone} />
        {data.terminal && data.cwd && <span className="node-process-actions nodrag" aria-label="Controles do processo"><button type="button" onClick={(event) => { event.stopPropagation(); data.onRestart?.(id); }} aria-label="Reiniciar processo" title="Reiniciar processo"><ArrowClockwise size={13} /></button><button type="button" onClick={(event) => { event.stopPropagation(); data.onStop?.(id); }} aria-label="Parar processo" title="Parar processo"><Stop size={12} weight="fill" /></button></span>}
        <NodeClose onRemove={() => data.onRemove(id)} />
      </header>
      <p className="objective"><b>Objetivo:</b> {data.objective}</p>
      {data.progress != null && <div className="progress-row"><span>Progresso</span><b>{data.progress} / 3</b><div><i style={{ width: `${data.progress * 33.333}%` }} /></div></div>}
      {data.terminal ? <TerminalPane nodeId={id} feed={data.feed} cwd={data.cwd} command={data.command} enabled={data.terminalEnabled !== false} restartKey={data.terminalLifecycle?.generation || 0} onTerminalSession={data.onTerminalSession} /> : <pre className="agent-log">{data.output}</pre>}
      {data.activity && <div className="node-activity"><CheckCircle size={13} weight="fill" />{data.activity}</div>}
    </article>
  );
}

export function FileNode({ id, data, selected }) {
  return (
    <article className={`flow-node file-node ${selected ? "selected" : ""}`}>
      <PerimeterHandles id={id} label="arquivo" />
      <Handle id="input" type="target" position={Position.Left} />
      <FileTs size={22} weight="fill" />
      <div><b>{data.title}</b><span>{data.path}</span><small>{data.meta}</small></div>
      <NodeClose onRemove={() => data.onRemove(id)} />
    </article>
  );
}

export function NoteNode({ id, data, selected }) {
  if (data.variant === "text") return <TextNode id={id} data={data} selected={selected} />;
  return (
    <article
      className={`flow-node note-node ${selected ? "selected" : ""}`}
      style={{ position: "relative", border: 0, borderRadius: 4, background: data.color || "#fff3a8", boxShadow: "0 4px 14px rgba(68, 55, 12, .14)" }}
    >
      <ResizeHandles selected={selected} minWidth={180} minHeight={120} />
      <PerimeterHandles id={id} label="nota" />
      <Handle id="input" type="target" position={Position.Top} style={{ opacity: 0 }} />
      <NodeDragHandle label="Arrastar nota" />
      <div style={{ position: "absolute", zIndex: 10, top: 5, right: 5 }}><NodeClose onRemove={() => data.onRemove(id)} /></div>
      <textarea
        className="nodrag nowheel"
        value={data.text ?? ""}
        onChange={(event) => data.onDataChange?.(id, { text: event.target.value })}
        placeholder={data.title || "Escreva uma nota…"}
        aria-label="Conteúdo da nota"
        style={{ width: "100%", height: "100%", margin: 0, padding: "32px 34px 18px 18px", border: 0, borderRadius: 4, outline: 0, resize: "none", background: "transparent", color: "#2e2a1f", font: '500 14px/1.55 "Inter", sans-serif', boxSizing: "border-box" }}
      />
    </article>
  );
}

export function TextNode({ id, data, selected }) {
  const editorRef = useRef(null);
  useEffect(() => {
    if (!data.autoFocus) return undefined;
    const frame = window.requestAnimationFrame(() => {
      editorRef.current?.focus();
      editorRef.current?.select();
      data.onDataChange?.(id, { autoFocus: false });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [data.autoFocus, data.onDataChange, id]);

  return (
    <div
      className={`flow-node text-node ${selected ? "selected" : ""}`}
      style={{ position: "relative", width: "100%", height: "100%", minWidth: 140, minHeight: 56 }}
    >
      <ResizeHandles selected={selected} minWidth={140} minHeight={56} />
      <PerimeterHandles id={id} label="texto" />
      <Handle id="input" type="target" position={Position.Top} style={{ width: 1, height: 1, border: 0, opacity: 0 }} />
      <div className="text-node-controls">
        <NodeDragHandle label="Arrastar texto" />
        <NodeClose onRemove={() => data.onRemove(id)} />
      </div>
      <textarea
        ref={editorRef}
        className="nodrag nowheel"
        value={data.text ?? ""}
        onChange={(event) => data.onDataChange?.(id, { text: event.target.value })}
        placeholder="Digite no canvas…"
        aria-label="Texto livre do canvas"
        style={{ display: "block", width: "100%", height: "100%", padding: 2, border: 0, outline: 0, resize: "none", overflow: "hidden", background: "transparent", color: data.color || "#20242a", font: `${data.fontWeight || 600} ${data.fontSize || 28}px/1.2 "Inter", sans-serif`, boxSizing: "border-box" }}
      />
    </div>
  );
}

function BrowserFallback() {
  return (
    <div className="browser-fallback">
      <h3>Checkout</h3>
      <div className="checkout-steps"><span>1. Carrinho</span><span>2. Entrega</span><b>3. Pagamento</b><span>4. Revisão</span></div>
      <div className="checkout-body"><section><b>Pagamento</b><label>Número do cartão<input value="1234 5678 9012 3456" readOnly /></label><div><label>Validade<input value="MM / AA" readOnly /></label><label>CVC<input value="123" readOnly /></label></div></section><aside><b>Resumo do pedido</b><p>Subtotal <span>R$ 249,90</span></p><p>Frete <span>R$ 15,00</span></p><strong>Total <span>R$ 264,90</span></strong><button>Finalizar pagamento</button></aside></div>
    </div>
  );
}

const defaultBrowserUrl = "http://localhost:5173/checkout";
const internalBrowserFixture = new URL("./browser-fixture.html", window.location.href).href;

function normalizeUrl(value) {
  const trimmed = value.trim();
  if (!trimmed) throw new Error("Informe uma URL HTTP(S).");
  const parsed = new URL(/^[a-z][a-z\d+.-]*:/i.test(trimmed) ? trimmed : `${/^(localhost|127\.0\.0\.1)/i.test(trimmed) ? "http" : "https"}://${trimmed}`);
  if (parsed.href === internalBrowserFixture) return parsed.href;
  if (!["http:", "https:"].includes(parsed.protocol)) throw new Error("O navegador aceita somente URLs HTTP(S).");
  if (parsed.username || parsed.password) throw new Error("Credenciais não são permitidas na URL.");
  return parsed.href;
}

export function BrowserNode({ id, data, selected }) {
  const webviewRef = useRef(null);
  const initialInput = data.url || defaultBrowserUrl;
  let initialUrl = window.kordaDesktop?.isDesktop && initialInput === defaultBrowserUrl ? internalBrowserFixture : initialInput;
  let initialState = window.kordaDesktop?.isDesktop ? "connecting" : "ready";
  try { initialUrl = normalizeUrl(initialUrl); } catch { initialUrl = internalBrowserFixture; initialState = "error"; }
  const [input, setInput] = useState(initialInput);
  const [url, setUrl] = useState(initialUrl);
  const [browserState, setBrowserState] = useState(initialState);
  const dataUrlRef = useRef(data.url);
  useEffect(() => {
    if (data.url === dataUrlRef.current) return;
    dataUrlRef.current = data.url;
    const next = data.url || defaultBrowserUrl;
    setInput(next);
    try {
      setUrl(normalizeUrl(next));
      setBrowserState("loading");
    } catch {
      setBrowserState("error");
    }
  }, [data.url]);
  useEffect(() => {
    const api = window.kordaDesktop;
    const guest = webviewRef.current;
    if (!api?.isDesktop || !guest || !api.registerBrowser) return undefined;
    let guestId;
    const register = () => {
      try {
        guestId = guest.getWebContentsId();
        setBrowserState("connecting");
        void api.registerBrowser(id, guestId).then(() => setBrowserState((current) => current === "loading" ? current : "ready")).catch(() => setBrowserState("error"));
      } catch { /* guest is not ready yet */ }
    };
    const syncUrl = (event) => {
      const next = event.url || guest.getURL?.();
      if (!next) return;
      setInput(next);
      setUrl(next);
      dataUrlRef.current = next;
      data.onDataChange?.(id, { url: next });
    };
    const loading = () => setBrowserState("loading");
    const ready = () => setBrowserState("ready");
    const failed = () => setBrowserState("error");
    const detached = () => setBrowserState("detached");
    guest.addEventListener("did-attach", register);
    guest.addEventListener("did-navigate", syncUrl);
    guest.addEventListener("did-navigate-in-page", syncUrl);
    guest.addEventListener("did-start-loading", loading);
    guest.addEventListener("did-stop-loading", ready);
    guest.addEventListener("did-fail-load", failed);
    guest.addEventListener("destroyed", detached);
    register();
    return () => {
      guest.removeEventListener("did-attach", register);
      guest.removeEventListener("did-navigate", syncUrl);
      guest.removeEventListener("did-navigate-in-page", syncUrl);
      guest.removeEventListener("did-start-loading", loading);
      guest.removeEventListener("did-stop-loading", ready);
      guest.removeEventListener("did-fail-load", failed);
      guest.removeEventListener("destroyed", detached);
      if (guestId !== undefined) void api.unregisterBrowser?.(id, guestId).catch(() => {});
    };
  }, [data.onDataChange, id]);
  const editUrl = (value) => {
    setInput(value);
  };
  const navigate = () => {
    try {
      const next = normalizeUrl(input);
      setInput(next);
      setUrl(next);
      setBrowserState("loading");
      dataUrlRef.current = next;
      data.onDataChange?.(id, { url: next });
    } catch {
      setBrowserState("error");
    }
  };
  const status = {
    connecting: ["Conectando", "waiting"], loading: ["Carregando", "waiting"], ready: [window.kordaDesktop?.isDesktop ? "Conectado" : "Prévia", "running"], error: ["Erro", "idle"], detached: ["Desconectado", "idle"],
  }[browserState];
  return (
    <article className={`flow-node browser-node ${selected ? "selected" : ""}`}>
      <ResizeHandles selected={selected} minWidth={340} minHeight={260} />
      <PerimeterHandles id={id} label="navegador" />
      <Handle id="input" type="target" position={Position.Top} />
      <header><span className="node-title"><Browser size={19} />{data.title}</span><Status value={status[0]} statusTone={status[1]} /><NodeClose onRemove={() => data.onRemove(id)} /></header>
      <div className="browser-bar nodrag nowheel"><input value={input} onChange={(event) => editUrl(event.target.value)} onKeyDown={(event) => event.key === "Enter" && navigate()} aria-label="URL do navegador" /><button onClick={navigate} title="Navegar" aria-label="Navegar"><ArrowClockwise size={15} /></button></div>
      <div className="browser-viewport nodrag nowheel" onPointerDown={(event) => event.stopPropagation()}>
        {window.kordaDesktop?.isDesktop ? <webview ref={webviewRef} src={url} /> : <BrowserFallback />}
      </div>
      <footer className={`browser-footer ${browserState}`}><span><i /> {status[0]}</span><span>Controle local <i /></span></footer>
    </article>
  );
}
