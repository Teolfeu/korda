const clean = (value) => typeof value === "string" ? value : "";

export function updateEdgeActivities(current, event, at = Date.now()) {
  const list = Array.isArray(current) ? current : [];
  const id = clean(event?.id);
  const sourceId = clean(event?.sourceId);
  const targetId = clean(event?.targetId);
  if (!id || !sourceId || !targetId || sourceId === targetId) return list;
  if (event.type === "remove") return list.filter((item) => item.id !== id);
  const phase = event.type === "reply" ? "returning" : "working";
  return [...list.filter((item) => item.id !== id), { id, sourceId, targetId, phase, at }];
}

export function clearNodeActivities(current, nodeId) {
  return (Array.isArray(current) ? current : []).filter((item) => item.sourceId !== nodeId && item.targetId !== nodeId);
}

export function pruneEdgeActivities(current, edges) {
  const pairs = new Set((Array.isArray(edges) ? edges : []).flatMap((edge) => {
    if (!edge?.source || !edge?.target) return [];
    return [`${edge.source}\u0000${edge.target}`, `${edge.target}\u0000${edge.source}`];
  }));
  return (Array.isArray(current) ? current : []).filter((item) => pairs.has(`${item.sourceId}\u0000${item.targetId}`));
}

export function edgeActivity(edge, current) {
  const matches = (Array.isArray(current) ? current : []).filter((item) => (
    (item.sourceId === edge.source && item.targetId === edge.target)
    || (item.sourceId === edge.target && item.targetId === edge.source)
  ));
  if (!matches.length) return null;
  const latest = matches.reduce((found, item) => item.at >= found.at ? item : found);
  const from = latest.phase === "returning" ? latest.targetId : latest.sourceId;
  return {
    active: true,
    phase: latest.phase,
    direction: from === edge.source ? "forward" : "reverse",
    pending: matches.filter((item) => item.phase === "working").length,
  };
}
