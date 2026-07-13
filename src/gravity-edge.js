const SEMANTIC_KINDS = new Set(["delegate", "validate", "browser", "context"]);

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

export function getGravityPath({ sourceX, sourceY, targetX, targetY }) {
  const dx = targetX - sourceX;
  const dy = targetY - sourceY;
  const distance = Math.hypot(dx, dy);
  const sag = clamp(22 + distance * 0.12, 28, 120);
  let control1X;
  let control1Y;
  let control2X;
  let control2Y;

  if (Math.abs(dy) > Math.abs(dx) * 0.35) {
    const sourceIsHigher = sourceY < targetY;
    control1X = sourceIsHigher ? sourceX : sourceX + dx * 0.45;
    control1Y = sourceIsHigher ? sourceY + dy * 0.72 : sourceY;
    control2X = sourceIsHigher ? targetX - dx * 0.45 : targetX;
    control2Y = sourceIsHigher ? targetY : targetY - dy * 0.72;
  } else {
    const floor = Math.max(sourceY, targetY) + sag;
    control1X = sourceX + dx * 0.25;
    control1Y = floor;
    control2X = sourceX + dx * 0.75;
    control2Y = floor;
  }

  const path = `M ${sourceX} ${sourceY} C ${control1X} ${control1Y}, ${control2X} ${control2Y}, ${targetX} ${targetY}`;

  return {
    path,
    sag,
    labelX: (sourceX + 3 * control1X + 3 * control2X + targetX) / 8,
    labelY: (sourceY + 3 * control1Y + 3 * control2Y + targetY) / 8,
  };
}

export function inferEdgeKind(connection, nodes = []) {
  const explicitKind = [connection.sourceHandle, connection.targetHandle]
    .find((handle) => SEMANTIC_KINDS.has(handle));
  if (explicitKind) return explicitKind;

  const source = nodes.find(({ id }) => id === connection.source);
  const target = nodes.find(({ id }) => id === connection.target);
  const endpoints = [source, target].filter(Boolean);

  if (endpoints.some(({ type }) => type === "browser")) return "browser";
  if (endpoints.some(({ type }) => type === "note" || type === "file")) return "context";
  if (endpoints.some(({ type, data }) => type === "agent" && data?.role === "reviewer")) return "validate";
  if (source?.type === "agent" && target?.type === "agent") return "delegate";
  return "context";
}
