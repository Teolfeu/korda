const STOPS = [8, 20, 32, 44, 56, 68, 80, 92];

function perimeterHandles(width, height) {
  const horizontalWidth = width * 0.13;
  const verticalHeight = height * 0.13;
  return STOPS.flatMap((stop) => [
    { id: `borda-top-${stop}`, type: "source", position: "top", x: width * stop / 100 - horizontalWidth / 2, y: -6, width: horizontalWidth, height: 12 },
    { id: `borda-right-${stop}`, type: "source", position: "right", x: width - 6, y: height * stop / 100 - verticalHeight / 2, width: 12, height: verticalHeight },
    { id: `borda-bottom-${stop}`, type: "source", position: "bottom", x: width * stop / 100 - horizontalWidth / 2, y: height - 6, width: horizontalWidth, height: 12 },
    { id: `borda-left-${stop}`, type: "source", position: "left", x: -6, y: height * stop / 100 - verticalHeight / 2, width: 12, height: verticalHeight },
  ]);
}

export function buildNodeHandles({ type, width, height, ports = [] }) {
  const safeWidth = Math.max(1, Number(width) || 1);
  const safeHeight = Math.max(1, Number(height) || 1);
  const target = type === "file"
    ? { id: "input", type: "target", position: "left", x: -4.5, y: safeHeight / 2 - 4.5, width: 9, height: 9 }
    : { id: "input", type: "target", position: "top", x: safeWidth / 2 - 3, y: -3, width: 6, height: 6 };
  const semanticPorts = type === "note" ? [{ id: "context" }] : ports;
  const semantic = semanticPorts.map((port, index) => ({
    id: port.id,
    type: "source",
    position: "bottom",
    x: safeWidth * ((index + 1) / (semanticPorts.length + 1)) - 4.5,
    y: safeHeight + 1,
    width: 9,
    height: 9,
  }));
  return [...perimeterHandles(safeWidth, safeHeight), target, ...semantic];
}
