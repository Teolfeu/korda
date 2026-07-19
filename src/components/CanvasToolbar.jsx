import {
  Compass,
  CursorClick,
  NotePencil,
  Robot,
  Terminal,
  TextT,
} from "@phosphor-icons/react";

const tools = [
  { id: "select", label: "Selecionar", shortcut: "V", Icon: CursorClick },
  { id: "terminal", label: "Terminal", shortcut: "T", Icon: Terminal },
  { id: "agent", label: "Agente", shortcut: "A", Icon: Robot },
  { id: "note", label: "Nota", shortcut: "N", Icon: NotePencil },
  { id: "text", label: "Texto", shortcut: "X", Icon: TextT },
  { id: "browser", label: "Browser", shortcut: "B", Icon: Compass },
];

export function CanvasToolbar({ activeTool = "select", onSelect, onAdd }) {
  return (
    <nav
      className="canvas-toolbar"
      aria-label="Ferramentas do canvas"
    >
      {tools.map(({ id, label, shortcut, Icon }) => {
        const active = activeTool === id;
        return (
          <button
            key={id}
            type="button"
            className={`canvas-tool ${active ? "active" : ""}`}
            aria-label={`${label}. Atalho ${shortcut}`}
            aria-pressed={active}
            title={`${label} (${shortcut})`}
            onClick={() => {
              onSelect?.(id);
              if (id !== "select") onAdd?.(id);
            }}
          >
            <Icon size={19} weight={active ? "fill" : "regular"} aria-hidden="true" />
            <span className="canvas-tool-label">{label}</span>
            <kbd aria-hidden="true">{shortcut}</kbd>
          </button>
        );
      })}
    </nav>
  );
}
