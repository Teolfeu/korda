export function findCanvasPosition(rects, size, compact = false) {
  const margin = 32;
  const columns = compact ? 1 : 2;
  const stepX = compact ? 0 : 800;
  const stepY = 520;
  const startX = compact ? 50 : 120;
  const startY = 110;
  // ponytail: first-fit grid is enough for local canvases; use a spatial index only if hundreds of nodes become common.
  for (let row = 0; row < 100; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const candidate = { x: startX + column * stepX, y: startY + row * stepY };
      const free = rects.every((rect) => (
        candidate.x + size.width + margin <= rect.x
        || rect.x + rect.width + margin <= candidate.x
        || candidate.y + size.height + margin <= rect.y
        || rect.y + rect.height + margin <= candidate.y
      ));
      if (free) return candidate;
    }
  }
  return { x: startX, y: startY + rects.length * stepY };
}
