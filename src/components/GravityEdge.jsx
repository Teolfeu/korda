import { useState } from "react";
import { useReactFlow } from "@xyflow/react";
import { getGravityPath } from "../gravity-edge.js";
import "../maestri-cords.css";

const RELEASE_DISTANCE = 55;

export function GravityEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  data,
  selected,
}) {
  const { screenToFlowPosition } = useReactFlow();
  const [pull, setPull] = useState(null);
  const pulledSource = pull?.end === "source" ? pull : null;
  const pulledTarget = pull?.end === "target" ? pull : null;
  const activity = data?.activity;
  const { path } = getGravityPath({
    sourceX: pulledSource?.x ?? sourceX,
    sourceY: pulledSource?.y ?? sourceY,
    targetX: pulledTarget?.x ?? targetX,
    targetY: pulledTarget?.y ?? targetY,
  });

  const startPull = (event) => {
    if (event.button !== 0) return;
    const point = screenToFlowPosition({ x: event.clientX, y: event.clientY });
    const sourceDistance = Math.hypot(point.x - sourceX, point.y - sourceY);
    const targetDistance = Math.hypot(point.x - targetX, point.y - targetY);
    event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();
    event.stopPropagation();
    setPull({
      end: sourceDistance < targetDistance ? "source" : "target",
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      x: point.x,
      y: point.y,
    });
  };

  const movePull = (event) => {
    if (!pull || event.pointerId !== pull.pointerId) return;
    const point = screenToFlowPosition({ x: event.clientX, y: event.clientY });
    setPull((current) => current && { ...current, x: point.x, y: point.y });
  };

  const finishPull = (event) => {
    if (!pull || event.pointerId !== pull.pointerId) return;
    const distance = Math.hypot(
      event.clientX - pull.startClientX,
      event.clientY - pull.startClientY,
    );
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    setPull(null);
    if (distance >= RELEASE_DISTANCE) data?.onRemove?.(id);
    else data?.onSelect?.(id);
  };

  const removeWithKeyboard = (event) => {
    if (event.key !== "Delete" && event.key !== "Backspace") return;
    event.preventDefault();
    data?.onRemove?.(id);
  };

  return (
    <g
      className={`gravity-edge maestri-cord${selected || data?.selected ? " is-selected" : ""}${pull ? " is-pulling" : ""}${activity?.active ? ` is-active is-${activity.direction}` : ""}`}
    >
      <path className="gravity-edge-cable" d={path} />
      {activity?.active && <path className="gravity-edge-flow" d={path} />}
      <circle className="gravity-edge-endpoint" cx={pulledSource?.x ?? sourceX} cy={pulledSource?.y ?? sourceY} r="2.7" />
      <circle className="gravity-edge-endpoint" cx={pulledTarget?.x ?? targetX} cy={pulledTarget?.y ?? targetY} r="2.7" />
      <path
        className="gravity-edge-hit"
        d={path}
        role="button"
        tabIndex={0}
        focusable="true"
        aria-label={activity?.active ? `Corda com comunicação em andamento, fluxo ${activity.direction === "forward" ? "da origem ao destino" : "do destino à origem"}.` : "Corda entre nós. Arraste para soltar ou pressione Delete ou Backspace."}
        onClick={(event) => event.stopPropagation()}
        onPointerDown={startPull}
        onPointerMove={movePull}
        onPointerUp={finishPull}
        onPointerCancel={() => setPull(null)}
        onKeyDown={removeWithKeyboard}
      />
    </g>
  );
}
